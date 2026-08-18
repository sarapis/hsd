/**
 * Services API endpoints.
 *
 * Ports routes/services.py — the core HSDS endpoints.
 * All data served from D1 cache (never Airtable directly).
 */
import { Hono } from "hono";
import type { Env } from "../env";
import { searchServices, resolveRecordId } from "../db/queries";
import {
  mapServiceSummary, mapService, mapOrganizationSummary, mapOrganization, mapLocation, mapAddress, mapPhone, mapContact, mapLanguage, mapServiceAtLocation, paginate,
} from "../mapper";
import { parsePage, parsePerPage } from "../utils/pagination";

const services = new Hono<{ Bindings: Env }>();

/**
 * GET /services — paginated service list with search/filter.
 */
services.get("/", async (c) => {
  const db = c.env.DB;
  const publishedStatus = c.env.PUBLISHED_STATUS_VALUE;

  const page = parsePage(c.req.query("page"));
  const perPage = parsePerPage(c.req.query("per_page"));
  const search = c.req.query("search");
  const organizationId = c.req.query("organization_id");
  const full = c.req.query("full") === "true";
  const minimal = c.req.query("minimal") === "true";

  const whereClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Filter by published status
  if (publishedStatus) {
    whereClauses.push(`json_extract(data, '$.status') = ?${paramIndex}`);
    params.push(publishedStatus);
    paramIndex++;
  }

  // Filter by organization
  if (organizationId) {
    whereClauses.push(`organization_id = ?${paramIndex}`);
    params.push(organizationId);
    paramIndex++;
  }

  // Text search — delegate to token-based searchServices if search param provided
  if (search && !organizationId) {
    // Use the optimized token search (handles stemming, ranking)
    const [searchResults, searchTotal] = await searchServices(db, search, {
      page,
      perPage,
      statusFilter: publishedStatus,
    });

    const items = [];
    for (const data of searchResults) {
      const orgId = (data as Record<string, unknown>)._organization_id as string || "unknown";
      if (minimal) {
        items.push({ id: (data as Record<string, unknown>)._id, last_modified: (data as Record<string, unknown>).lastUpdated });
      } else if (full) {
        const service = await buildFullService(db, (data as Record<string, unknown>)._id as string, data as Record<string, unknown>, orgId);
        items.push(service);
      } else {
        let orgSummary;
        if (orgId !== "unknown") {
          orgSummary = await lookupOrgSummary(db, orgId);
        }
        items.push(mapServiceSummary(data as Record<string, unknown>, orgId, orgSummary));
      }
    }
    return c.json(paginate(items, searchTotal, page, perPage));
  }

  // Fallback LIKE search when combined with org filter
  if (search) {
    whereClauses.push(
      `(json_extract(data, '$.name') LIKE ?${paramIndex} OR json_extract(data, '$.description') LIKE ?${paramIndex + 1})`,
    );
    params.push(`%${search}%`, `%${search}%`);
    paramIndex += 2;
  }

  const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";

  // Get total count
  const countResult = await db
    .prepare(`SELECT COUNT(*) as cnt FROM services${whereStr}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countResult?.cnt ?? 0;

  // Fetch page
  const offset = (page - 1) * perPage;
  const dataParams = [...params, perPage, offset];
  const dataQuery = `SELECT id, airtable_id, organization_id, data FROM services${whereStr} ORDER BY json_extract(data, '$.name') LIMIT ?${paramIndex} OFFSET ?${paramIndex + 1}`;
  const { results: rows } = await db.prepare(dataQuery).bind(...dataParams).all<{
    id: string;
    airtable_id: string;
    organization_id: string;
    data: string;
  }>();

  const items = [];
  for (const row of rows) {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    data.id = row.id;
    const orgId = row.organization_id || "unknown";

    if (minimal) {
      items.push({ id: row.id, last_modified: data.lastUpdated });
    } else if (full) {
      const service = await buildFullService(db, row.id, data, orgId);
      items.push(service);
    } else {
      // Summary with org lookup
      let orgSummary;
      if (orgId !== "unknown") {
        orgSummary = await lookupOrgSummary(db, orgId);
      }
      items.push(mapServiceSummary(data, orgId, orgSummary));
    }
  }

  return c.json(paginate(items, total, page, perPage));
});

/**
 * GET /services/:id — fully nested service detail.
 */
services.get("/:id", async (c) => {
  const db = c.env.DB;
  const publishedStatus = c.env.PUBLISHED_STATUS_VALUE;
  const serviceId = c.req.param("id");

  let row = await db
    .prepare("SELECT id, airtable_id, organization_id, data FROM services WHERE id = ?1 OR airtable_id = ?1")
    .bind(serviceId)
    .first<{ id: string; airtable_id: string; organization_id: string; data: string }>();

  // Not a raw id — the caller is using the uuid we publish (every link in our
  // own responses does). Resolve it against the indexed uuid column.
  if (!row) {
    const resolvedId = await resolveRecordId(db, "services", serviceId);
    if (resolvedId) {
      row = await db
        .prepare("SELECT id, airtable_id, organization_id, data FROM services WHERE id = ?1")
        .bind(resolvedId)
        .first<{ id: string; airtable_id: string; organization_id: string; data: string }>();
    }
  }

  if (!row) return c.json({ detail: "Service not found" }, 404);

  const data = JSON.parse(row.data) as Record<string, unknown>;
  data.id = row.id;

  // Check published status
  if (publishedStatus && data.status !== publishedStatus) {
    return c.json({ detail: "Service not found" }, 404);
  }

  const service = await buildFullService(db, row.id, data, row.organization_id || "unknown");
  return c.json(service);
});

// ============================================================================
// Helpers
// ============================================================================

/** Look up an organization summary from D1. */
async function lookupOrgSummary(db: D1Database, orgId: string) {
  const orgRow = await db
    .prepare("SELECT data FROM organizations WHERE id = ?1 OR airtable_id = ?1")
    .bind(orgId)
    .first<{ data: string }>();
  if (!orgRow) return undefined;
  const orgData = JSON.parse(orgRow.data) as Record<string, unknown>;
  return mapOrganizationSummary(orgData);
}

/**
 * Build a fully nested Service from D1 cache.
 * Mirrors _get_full_service_from_cache() in routes/services.py.
 */
async function buildFullService(
  db: D1Database,
  serviceId: string,
  data: Record<string, unknown>,
  orgId: string,
) {
  // Organization
  let organization;
  if (orgId !== "unknown") {
    const orgRow = await db
      .prepare("SELECT data FROM organizations WHERE id = ?1 OR airtable_id = ?1")
      .bind(orgId)
      .first<{ data: string }>();
    if (orgRow) {
      const orgData = JSON.parse(orgRow.data) as Record<string, unknown>;
      orgData.id = orgId;
      organization = mapOrganization(orgData);
    }
  }

  // Service at locations → location → addresses
  const { results: salRows } = await db
    .prepare("SELECT id, location_id, data FROM service_at_locations WHERE service_id = ?1")
    .bind(serviceId)
    .all<{ id: string; location_id: string; data: string }>();

  const serviceAtLocations = [];
  for (const salRow of salRows) {
    const salData = JSON.parse(salRow.data) as Record<string, unknown>;
    salData.id = salRow.id;

    let location;
    if (salRow.location_id) {
      const locRow = await db
        .prepare("SELECT data FROM locations WHERE id = ?1 OR airtable_id = ?1")
        .bind(salRow.location_id)
        .first<{ data: string }>();
      if (locRow) {
        const locData = JSON.parse(locRow.data) as Record<string, unknown>;
        locData.id = salRow.location_id;

        // Addresses linked from location
        const addresses = [];
        const addrIds = (locData.addresses as string[]) || [];
        for (const addrId of addrIds.slice(0, 1)) {
          const addrRow = await db
            .prepare("SELECT data FROM addresses WHERE id = ?1 OR airtable_id = ?1")
            .bind(addrId)
            .first<{ data: string }>();
          if (addrRow) {
            const addrData = JSON.parse(addrRow.data) as Record<string, unknown>;
            addrData.id = addrId;
            addresses.push(mapAddress(addrData));
          }
        }

        location = mapLocation(locData, { addresses });
      }
    }

    serviceAtLocations.push(mapServiceAtLocation(salData, { location }));
  }

  // Phones linked to service
  const phones = [];
  const phoneIds = (data.phones as string[]) || [];
  for (const phoneId of phoneIds.slice(0, 5)) {
    const phoneRow = await db
      .prepare("SELECT data FROM phones WHERE id = ?1 OR airtable_id = ?1")
      .bind(phoneId)
      .first<{ data: string }>();
    if (phoneRow) {
      const phoneData = JSON.parse(phoneRow.data) as Record<string, unknown>;
      phoneData.id = phoneId;
      phones.push(mapPhone(phoneData));
    }
  }

  // Contacts
  const contacts = [];
  const contactIds = (data.contacts as string[]) || [];
  for (const contactId of contactIds.slice(0, 5)) {
    const contactRow = await db
      .prepare("SELECT data FROM contacts WHERE id = ?1 OR airtable_id = ?1")
      .bind(contactId)
      .first<{ data: string }>();
    if (contactRow) {
      const contactData = JSON.parse(contactRow.data) as Record<string, unknown>;
      contactData.id = contactId;
      contacts.push(mapContact(contactData));
    }
  }

  // Languages
  const languages = [];
  const langIds = (data.languages as string[]) || [];
  for (const langId of langIds.slice(0, 10)) {
    const langRow = await db
      .prepare("SELECT data FROM languages WHERE id = ?1 OR airtable_id = ?1")
      .bind(langId)
      .first<{ data: string }>();
    if (langRow) {
      const langData = JSON.parse(langRow.data) as Record<string, unknown>;
      langData.id = langId;
      languages.push(mapLanguage(langData));
    }
  }

  return mapService(data, orgId, {
    organization: organization ? mapOrganizationSummary({ ...organization }) : undefined,
    phones,
    contacts,
    languages,
    service_at_locations: serviceAtLocations,
  });
}

export { services };
