/**
 * Geocoded Locations API endpoint.
 *
 * Ports routes/locations.py — serves location data with coordinates from D1 cache.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import type { GeocodedLocation, GeocodedLocationsResponse } from "../types";
import { safeFloat } from "../mapper";

const locations = new Hono<{ Bindings: Env }>();

locations.get("/geocoded", async (c) => {
  const db = c.env.DB;
  const publishedStatus = c.env.PUBLISHED_STATUS_VALUE;
  const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 500)));

  // Fetch locations, organizations, and services from D1
  const [locResult, orgResult, svcResult, addrResult] = await Promise.all([
    db.prepare("SELECT id, data FROM locations").all<{ id: string; data: string }>(),
    db.prepare("SELECT id, data FROM organizations").all<{ id: string; data: string }>(),
    publishedStatus
      ? db.prepare("SELECT id, data FROM services WHERE json_extract(data, '$.status') = ?1").bind(publishedStatus).all<{ id: string; data: string }>()
      : db.prepare("SELECT id, data FROM services").all<{ id: string; data: string }>(),
    db.prepare("SELECT id, data FROM addresses").all<{ id: string; data: string }>(),
  ]);

  // Build org → location mapping
  const orgByLocation = new Map<string, { id: string; name: string }>();
  for (const row of orgResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    const locIds = (d.locations as string[]) || [];
    for (const locId of locIds) {
      orgByLocation.set(locId, { id: row.id, name: (d.name as string) || "" });
    }
  }

  // Build org → first service mapping
  const serviceByOrg = new Map<string, { id: string; name: string }>();
  for (const row of svcResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    const orgIds = (d.organization as string[]) || (d.organizations as string[]) || [];
    for (const orgId of orgIds) {
      if (!serviceByOrg.has(orgId)) {
        serviceByOrg.set(orgId, { id: row.id, name: (d.name as string) || "" });
      }
    }
  }

  // Address lookup for fallback
  const addressLookup = new Map<string, { address_1?: string; city?: string; state_province?: string; postal_code?: string }>();
  for (const row of addrResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    addressLookup.set(row.id, {
      address_1: d.address_1 as string | undefined,
      city: d.city as string | undefined,
      state_province: d.state_province as string | undefined,
      postal_code: d.postal_code as string | undefined,
    });
  }

  // Build geocoded locations
  const geocodedLocations: GeocodedLocation[] = [];
  const seenCoords = new Set<string>();

  for (const row of locResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;

    let lat = safeFloat(d.latitude) ?? safeFloat(d["x-latitude"]);
    let lng = safeFloat(d.longitude) ?? safeFloat(d["x-longitude"]);

    if (lat === undefined || lng === undefined) continue;

    // Skip duplicate coordinates
    const coordKey = `${lat},${lng}`;
    if (seenCoords.has(coordKey)) continue;
    seenCoords.add(coordKey);

    // Get org info
    const orgInfo = orgByLocation.get(row.id);
    const orgId = orgInfo?.id;
    const orgName = orgInfo?.name;

    // Get service info from org
    const svcInfo = orgId ? serviceByOrg.get(orgId) : undefined;

    // Build address string
    let addressStr = (d.name as string) || "";
    const addrIds = (d.addresses as string[]) || [];
    if (addrIds.length > 0) {
      const addr = addressLookup.get(addrIds[0]);
      if (addr) {
        const parts = [addr.address_1, addr.city, addr.state_province, addr.postal_code].filter(Boolean);
        addressStr = parts.join(", ");
      }
    }

    geocodedLocations.push({
      id: row.id,
      name: (d.name as string) || addressStr,
      address: addressStr || (d.name as string),
      latitude: lat,
      longitude: lng,
      service_id: svcInfo?.id,
      service_name: svcInfo?.name,
      organization_id: orgId,
      organization_name: orgName,
    });

    if (geocodedLocations.length >= limit) break;
  }

  const response: GeocodedLocationsResponse = {
    total: geocodedLocations.length,
    locations: geocodedLocations,
  };

  return c.json(response);
});

export { locations };
