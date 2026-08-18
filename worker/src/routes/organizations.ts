/**
 * Organizations API endpoints.
 *
 * Ports routes/organizations.py — now serving from D1 cache instead of Airtable.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import {
  mapOrganizationSummary, mapOrganization, mapServiceSummary, mapLocation, mapAddress, mapPhone, mapContact, mapProgram, mapFunding, paginate,
} from "../mapper";
import { parsePage, parsePerPage } from "../utils/pagination";
import { resolveRecordId } from "../db/queries";

const organizations = new Hono<{ Bindings: Env }>();

/**
 * GET /organizations — paginated list with service counts.
 */
organizations.get("/", async (c) => {
  const db = c.env.DB;
  const publishedStatus = c.env.PUBLISHED_STATUS_VALUE;

  const page = parsePage(c.req.query("page"));
  const perPage = parsePerPage(c.req.query("per_page"));
  const search = c.req.query("search");
  const full = c.req.query("full") === "true";

  // Get service counts per org (only published services)
  const serviceCountQuery = publishedStatus
    ? `SELECT organization_id, COUNT(*) as cnt FROM services WHERE json_extract(data, '$.status') = ?1 GROUP BY organization_id`
    : `SELECT organization_id, COUNT(*) as cnt FROM services GROUP BY organization_id`;

  const { results: countRows } = publishedStatus
    ? await db.prepare(serviceCountQuery).bind(publishedStatus).all<{ organization_id: string; cnt: number }>()
    : await db.prepare(serviceCountQuery).all<{ organization_id: string; cnt: number }>();

  const orgServiceCounts = new Map<string, number>();
  const orgsWithPublishedServices = new Set<string>();
  for (const row of countRows) {
    if (row.organization_id) {
      orgServiceCounts.set(row.organization_id, row.cnt);
      orgsWithPublishedServices.add(row.organization_id);
    }
  }

  // Fetch all organizations
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (search) {
    whereClauses.push(
      `(json_extract(data, '$.name') LIKE ?${paramIndex} OR json_extract(data, '$.description') LIKE ?${paramIndex + 1})`,
    );
    params.push(`%${search}%`, `%${search}%`);
    paramIndex += 2;
  }

  const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
  const { results: orgRows } = await db
    .prepare(`SELECT id, airtable_id, data FROM organizations${whereStr}`)
    .bind(...params)
    .all<{ id: string; airtable_id: string; data: string }>();

  // Map and filter
  const allOrgs = [];
  for (const row of orgRows) {
    // Skip orgs without published services
    if (publishedStatus && !orgsWithPublishedServices.has(row.id) && !orgsWithPublishedServices.has(row.airtable_id)) {
      continue;
    }

    const data = JSON.parse(row.data) as Record<string, unknown>;
    data.id = row.id;

    let orgDict: Record<string, unknown>;
    if (full) {
      const org = await buildFullOrganization(db, row.id, data);
      orgDict = org as unknown as Record<string, unknown>;
    } else {
      orgDict = mapOrganizationSummary(data) as unknown as Record<string, unknown>;
    }

    // Add service count
    const svcCount = orgServiceCounts.get(row.id) ?? orgServiceCounts.get(row.airtable_id) ?? 0;
    orgDict.service_count = svcCount;
    allOrgs.push(orgDict);
  }

  // Sort by name (case-insensitive)
  allOrgs.sort((a, b) => {
    const nameA = ((a.name as string) || "").toLowerCase();
    const nameB = ((b.name as string) || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Paginate
  const start = (page - 1) * perPage;
  const pageItems = allOrgs.slice(start, start + perPage);
  return c.json(paginate(pageItems, allOrgs.length, page, perPage));
});

/**
 * GET /organizations/:id/services — services for an organization.
 */
organizations.get("/:id/services", async (c) => {
  const db = c.env.DB;
  const publishedStatus = c.env.PUBLISHED_STATUS_VALUE;
  const orgId = c.req.param("id");

  const page = parsePage(c.req.query("page"));
  const perPage = parsePerPage(c.req.query("per_page"), 100);

  // services.organization_id holds the raw Airtable id, but every link into this
  // route comes from a response that publishes uuids — so filtering on the
  // caller's id directly matched nothing and org pages showed no services at all.
  const resolvedOrgId = await resolveRecordId(db, "organizations", orgId);
  if (!resolvedOrgId) return c.json({ detail: "Organization not found" }, 404);

  const whereClauses = ["(organization_id = ?1)"];
  const params: unknown[] = [resolvedOrgId];
  let paramIndex = 2;

  if (publishedStatus) {
    whereClauses.push(`json_extract(data, '$.status') = ?${paramIndex}`);
    params.push(publishedStatus);
    paramIndex++;
  }

  const whereStr = ` WHERE ${whereClauses.join(" AND ")}`;

  const countResult = await db
    .prepare(`SELECT COUNT(*) as cnt FROM services${whereStr}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countResult?.cnt ?? 0;

  const offset = (page - 1) * perPage;
  params.push(perPage, offset);
  const { results: svcRows } = await db
    .prepare(`SELECT id, data FROM services${whereStr} ORDER BY json_extract(data, '$.name') LIMIT ?${paramIndex} OFFSET ?${paramIndex + 1}`)
    .bind(...params)
    .all<{ id: string; data: string }>();

  const items = svcRows.map((row) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    data.id = row.id;
    return mapServiceSummary(data, resolvedOrgId);
  });

  return c.json(paginate(items, total, page, perPage));
});

/**
 * GET /organizations/:id — single organization detail.
 */
organizations.get("/:id", async (c) => {
  const db = c.env.DB;
  const orgId = c.req.param("id");
  let row = await db
    .prepare("SELECT id, data FROM organizations WHERE id = ?1 OR airtable_id = ?1")
    .bind(orgId)
    .first<{ id: string; data: string }>();

  // Not a raw id — resolve the published uuid against the indexed column.
  if (!row) {
    const resolvedId = await resolveRecordId(db, "organizations", orgId);
    if (resolvedId) {
      row = await db
        .prepare("SELECT id, data FROM organizations WHERE id = ?1")
        .bind(resolvedId)
        .first<{ id: string; data: string }>();
    }
  }

  if (!row) return c.json({ detail: "Organization not found" }, 404);

  const data = JSON.parse(row.data) as Record<string, unknown>;
  data.id = row.id;

  const org = await buildFullOrganization(db, row.id, data);
  return c.json(org);
});

// ============================================================================
// Helpers
// ============================================================================

async function buildFullOrganization(
  db: D1Database,
  orgId: string,
  data: Record<string, unknown>,
) {
  // Phones
  const phones = [];
  for (const phoneId of ((data.phones as string[]) || []).slice(0, 5)) {
    const row = await db.prepare("SELECT data FROM phones WHERE id = ?1 OR airtable_id = ?1").bind(phoneId).first<{ data: string }>();
    if (row) {
      const d = JSON.parse(row.data) as Record<string, unknown>;
      d.id = phoneId;
      phones.push(mapPhone(d));
    }
  }

  // Contacts
  const contacts = [];
  for (const contactId of ((data.contacts as string[]) || []).slice(0, 5)) {
    const row = await db.prepare("SELECT data FROM contacts WHERE id = ?1 OR airtable_id = ?1").bind(contactId).first<{ data: string }>();
    if (row) {
      const d = JSON.parse(row.data) as Record<string, unknown>;
      d.id = contactId;
      contacts.push(mapContact(d));
    }
  }

  // Locations with addresses
  const locations = [];
  for (const locId of ((data.locations as string[]) || []).slice(0, 10)) {
    const locRow = await db.prepare("SELECT data FROM locations WHERE id = ?1 OR airtable_id = ?1").bind(locId).first<{ data: string }>();
    if (locRow) {
      const locData = JSON.parse(locRow.data) as Record<string, unknown>;
      locData.id = locId;

      const addresses = [];
      for (const addrId of ((locData.addresses as string[]) || []).slice(0, 3)) {
        const addrRow = await db.prepare("SELECT data FROM addresses WHERE id = ?1 OR airtable_id = ?1").bind(addrId).first<{ data: string }>();
        if (addrRow) {
          const addrData = JSON.parse(addrRow.data) as Record<string, unknown>;
          addrData.id = addrId;
          addresses.push(mapAddress(addrData));
        }
      }

      locations.push(mapLocation(locData, { addresses }));
    }
  }

  // Programs
  const programs = [];
  for (const progId of ((data.programs as string[]) || []).slice(0, 5)) {
    const row = await db.prepare("SELECT data FROM programs WHERE id = ?1 OR airtable_id = ?1").bind(progId).first<{ data: string }>();
    if (row) {
      const d = JSON.parse(row.data) as Record<string, unknown>;
      d.id = progId;
      programs.push(mapProgram(d));
    }
  }

  // Funding
  const funding = [];
  for (const fundId of ((data.funding as string[]) || []).slice(0, 5)) {
    const row = await db.prepare("SELECT data FROM funding WHERE id = ?1 OR airtable_id = ?1").bind(fundId).first<{ data: string }>();
    if (row) {
      const d = JSON.parse(row.data) as Record<string, unknown>;
      d.id = fundId;
      funding.push(mapFunding(d));
    }
  }

  return mapOrganization(data, { phones, contacts, locations, programs, funding });
}

export { organizations };
