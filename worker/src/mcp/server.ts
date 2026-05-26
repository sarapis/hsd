/**
 * MCP Server for the Mutual Aid NYC Directory.
 *
 * Exposes 5 tools for AI agents to search and browse service data.
 * Uses McpAgent (Durable Object) with McpServer from the MCP SDK.
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { searchServices, getRecord, getTableCount } from "../db/queries";
import { mapServiceSummary, mapOrganizationSummary, mapOrganization, mapService, mapPhone } from "../mapper";

/**
 * MCP Agent that exposes directory tools.
 * Each session is a Durable Object with D1 access via env bindings.
 */
export class DirectoryMcpAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "Mutual Aid NYC Directory",
    version: "1.0.0",
  });

  async init() {
    // Tool: search_services
    this.server.tool(
      "search_services",
      "Search community services by keyword. Returns matching services with names, descriptions, and contact info.",
      {
        query: z.string().describe("Search term (e.g., 'food', 'housing', 'mental health')"),
        page: z.number().optional().default(1).describe("Page number"),
        per_page: z.number().optional().default(10).describe("Results per page (max 20)"),
      },
      async ({ query, page, per_page }: { query: string; page: number; per_page: number }) => {
        const db = this.env.DB;
        const perPage = Math.min(20, per_page || 10);
        const [records, total] = await searchServices(db, query, {
          page: page || 1,
          perPage,
          statusFilter: this.env.PUBLISHED_STATUS_VALUE,
        });

        const services = records.map((r: Record<string, unknown>) => {
          const orgId = (r._organization_id as string) || "unknown";
          return mapServiceSummary(r, orgId);
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                total,
                page: page || 1,
                per_page: perPage,
                services,
              }, null, 2),
            },
          ],
        };
      },
    );

    // Tool: get_service
    this.server.tool(
      "get_service",
      "Get full details for a specific service by ID. Returns org, locations, phones, contacts.",
      {
        id: z.string().describe("Service ID"),
      },
      async ({ id }: { id: string }) => {
        const db = this.env.DB;
        const row = await db
          .prepare("SELECT id, organization_id, data FROM services WHERE id = ?1 OR airtable_id = ?1")
          .bind(id)
          .first<{ id: string; organization_id: string; data: string }>();

        if (!row) {
          return { content: [{ type: "text" as const, text: "Service not found" }] };
        }

        const data = JSON.parse(row.data) as Record<string, unknown>;
        data.id = row.id;

        let orgSummary;
        if (row.organization_id) {
          const orgRow = await db
            .prepare("SELECT data FROM organizations WHERE id = ?1 OR airtable_id = ?1")
            .bind(row.organization_id)
            .first<{ data: string }>();
          if (orgRow) {
            orgSummary = mapOrganizationSummary(JSON.parse(orgRow.data));
          }
        }

        const phones = [];
        for (const phoneId of ((data.phones as string[]) || []).slice(0, 3)) {
          const pRow = await db.prepare("SELECT data FROM phones WHERE id = ?1 OR airtable_id = ?1").bind(phoneId).first<{ data: string }>();
          if (pRow) phones.push(mapPhone(JSON.parse(pRow.data)));
        }

        const service = mapService(data, row.organization_id || "unknown", {
          organization: orgSummary,
          phones,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(service, null, 2) }],
        };
      },
    );

    // Tool: list_organizations
    this.server.tool(
      "list_organizations",
      "Browse organizations in the directory. Can search by name.",
      {
        search: z.string().optional().describe("Search term for org name"),
        page: z.number().optional().default(1),
        per_page: z.number().optional().default(10),
      },
      async ({ search, page, per_page }: { search?: string; page: number; per_page: number }) => {
        const db = this.env.DB;
        const perPage = Math.min(20, per_page || 10);

        let query = "SELECT id, data FROM organizations";
        const params: unknown[] = [];
        if (search) {
          query += " WHERE json_extract(data, '$.name') LIKE ?1";
          params.push(`%${search}%`);
        }
        query += " ORDER BY json_extract(data, '$.name')";

        const { results } = await db.prepare(query).bind(...params).all<{ id: string; data: string }>();
        const orgs = results.map((row: { id: string; data: string }) => {
          const d = JSON.parse(row.data) as Record<string, unknown>;
          d.id = row.id;
          return mapOrganizationSummary(d);
        });

        const start = ((page || 1) - 1) * perPage;
        const pageItems = orgs.slice(start, start + perPage);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ total: orgs.length, organizations: pageItems }, null, 2) }],
        };
      },
    );

    // Tool: get_organization
    this.server.tool(
      "get_organization",
      "Get full details for an organization by ID.",
      {
        id: z.string().describe("Organization ID"),
      },
      async ({ id }: { id: string }) => {
        const db = this.env.DB;
        const data = await getRecord(db, "organizations", id);
        if (!data) {
          return { content: [{ type: "text" as const, text: "Organization not found" }] };
        }
        const org = mapOrganization(data);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(org, null, 2) }],
        };
      },
    );

    // Tool: get_directory_stats
    this.server.tool(
      "get_directory_stats",
      "Get summary statistics about the directory: total services, organizations, locations, and available categories.",
      {},
      async () => {
        const db = this.env.DB;
        const [svcCount, orgCount, locCount] = await Promise.all([
          getTableCount(db, "services"),
          getTableCount(db, "organizations"),
          getTableCount(db, "locations"),
        ]);

        const { results } = await db
          .prepare("SELECT DISTINCT json_extract(data, '$.needFocus') as nf FROM services WHERE json_extract(data, '$.needFocus') IS NOT NULL")
          .all<{ nf: string }>();

        const categories = new Set<string>();
        for (const row of results) {
          try {
            const arr = JSON.parse(row.nf) as string[];
            arr.forEach((c: string) => categories.add(c));
          } catch {
            // skip malformed
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              total_services: svcCount,
              total_organizations: orgCount,
              total_locations: locCount,
              categories: [...categories].sort(),
            }, null, 2),
          }],
        };
      },
    );
  }
}
