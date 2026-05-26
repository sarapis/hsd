/**
 * Service At Locations API endpoints.
 *
 * Implements the /service_at_locations endpoints required by HSDS-UK 3.0.
 * Data served from D1 cache.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import {
  mapServiceAtLocation, mapLocation, mapAddress, mapPhone, mapContact,
  mapSchedule, mapServiceArea, paginate, toUuid,
} from "../mapper";

const serviceAtLocations = new Hono<{ Bindings: Env }>();

/**
 * GET /service_at_locations — paginated list.
 */
serviceAtLocations.get("/", async (c) => {
  const db = c.env.DB;
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const perPage = Math.min(100, Math.max(1, Number(c.req.query("per_page") ?? 20)));

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

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(salId);

  let row = await db
    .prepare("SELECT id, airtable_id, service_id, location_id, data FROM service_at_locations WHERE id = ?1 OR airtable_id = ?1")
    .bind(salId)
    .first<{ id: string; airtable_id: string; service_id: string; location_id: string; data: string }>();

  // UUID reverse-lookup
  if (!row && isUuid) {
    const { results: allRows } = await db
      .prepare("SELECT id, airtable_id, service_id, location_id, data FROM service_at_locations")
      .all<{ id: string; airtable_id: string; service_id: string; location_id: string; data: string }>();
    for (const candidate of allRows) {
      if (toUuid(candidate.id) === salId.toLowerCase()) {
        row = candidate;
        break;
      }
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
