/**
 * Service At Locations API endpoints.
 *
 * Implements the /service_at_locations endpoints required by HSDS-UK 3.0.
 * Data served from D1 cache.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import {
  mapServiceAtLocation, mapLocation, mapAddress, mapPhone, mapContact, mapSchedule, mapServiceArea, paginate,
} from "../mapper";
import { parsePage, parsePerPage } from "../utils/pagination";
import { resolveRecordId } from "../db/queries";

const serviceAtLocations = new Hono<{ Bindings: Env }>();

/**
 * GET /service_at_locations — paginated list.
 */
serviceAtLocations.get("/", async (c) => {
  const db = c.env.DB;
  const page = parsePage(c.req.query("page"));
  const perPage = parsePerPage(c.req.query("per_page"));

  const { results } = await db
    .prepare("SELECT id, airtable_id, service_id, location_id, data FROM service_at_locations")
    .all<{ id: string; airtable_id: string; service_id: string; location_id: string; data: string }>();

  const items = results.map((row) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    data.id = row.id;
    return mapServiceAtLocation(data);
  });

  const start = (page - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);
  return c.json(paginate(pageItems, items.length, page, perPage));
});

/**
 * GET /service_at_locations/:id — single record with nested location detail.
 */
serviceAtLocations.get("/:id", async (c) => {
  const db = c.env.DB;
  const salId = c.req.param("id");

  let row = await db
    .prepare("SELECT id, airtable_id, service_id, location_id, data FROM service_at_locations WHERE id = ?1 OR airtable_id = ?1")
    .bind(salId)
    .first<{ id: string; airtable_id: string; service_id: string; location_id: string; data: string }>();

  // Not a raw id — resolve the published uuid against the indexed column.
  if (!row) {
    const resolvedId = await resolveRecordId(db, "service_at_locations", salId);
    if (resolvedId) {
      row = await db
        .prepare("SELECT id, airtable_id, service_id, location_id, data FROM service_at_locations WHERE id = ?1")
        .bind(resolvedId)
        .first<{ id: string; airtable_id: string; service_id: string; location_id: string; data: string }>();
    }
  }

  if (!row) return c.json({ detail: "Service at location not found" }, 404);

  const data = JSON.parse(row.data) as Record<string, unknown>;
  data.id = row.id;

  // Fetch nested location if available
  let location;
  if (row.location_id) {
    const locRow = await db
      .prepare("SELECT id, data FROM locations WHERE id = ?1 OR airtable_id = ?1")
      .bind(row.location_id)
      .first<{ id: string; data: string }>();
    if (locRow) {
      const locData = JSON.parse(locRow.data) as Record<string, unknown>;
      locData.id = locRow.id;

      // Fetch addresses
      const addresses = [];
      for (const addrId of ((locData.addresses as string[]) || []).slice(0, 3)) {
        const addrRow = await db
          .prepare("SELECT data FROM addresses WHERE id = ?1 OR airtable_id = ?1")
          .bind(addrId)
          .first<{ data: string }>();
        if (addrRow) {
          const d = JSON.parse(addrRow.data) as Record<string, unknown>;
          d.id = addrId;
          addresses.push(mapAddress(d));
        }
      }

      location = mapLocation(locData, { addresses });
    }
  }

  return c.json(mapServiceAtLocation(data, { location }));
});

export { serviceAtLocations };
