/**
 * Map Services API endpoint.
 *
 * Ports routes/map.py — complex location resolution with multi-priority lookup.
 * All data served from D1 cache.
 */
import { Hono } from "hono";
import type { Env } from "../env";
import type { MapService, MapDataResponse, CategoryDetail } from "../types";
import { haversine } from "../utils/haversine";
import { safeFloat } from "../mapper";

const map = new Hono<{ Bindings: Env }>();

map.get("/services", async (c) => {
  const db = c.env.DB;
  const publishedStatus = c.env.PUBLISHED_STATUS_VALUE;

  // Fetch all lookup data from D1
  const svcQuery = publishedStatus
    ? `SELECT id, airtable_id, data FROM services WHERE json_extract(data, '$.status') = ?1`
    : `SELECT id, airtable_id, data FROM services`;

  const [svcResult, locResult, addrResult, orgResult, phoneResult, salResult, taxTermResult, geocacheResult] =
    await Promise.all([
      publishedStatus
        ? db.prepare(svcQuery).bind(publishedStatus).all<{ id: string; airtable_id: string; data: string }>()
        : db.prepare(svcQuery).all<{ id: string; airtable_id: string; data: string }>(),
      db.prepare("SELECT id, data FROM locations").all<{ id: string; data: string }>(),
      db.prepare("SELECT id, data FROM addresses").all<{ id: string; data: string }>(),
      db.prepare("SELECT id, data FROM organizations").all<{ id: string; data: string }>(),
      db.prepare("SELECT id, data FROM phones").all<{ id: string; data: string }>(),
      db.prepare("SELECT id, data FROM service_at_locations").all<{ id: string; data: string }>(),
      db.prepare("SELECT id, data FROM taxonomy_terms").all<{ id: string; data: string }>(),
      db.prepare("SELECT address_id, latitude, longitude FROM geocache").all<{ address_id: string; latitude: number; longitude: number }>(),
    ]);

  // Build lookups
  const orgLookup = new Map<string, string>();
  for (const row of orgResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    orgLookup.set(row.id, (d.name as string) || "");
  }

  const iconLookup = new Map<string, string>();
  const apiOrigin = new URL(c.req.url).origin;
  for (const row of taxTermResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    const name = d.name as string;
    if (name) {
      // Use Worker-served cached icon URL (never expires)
      iconLookup.set(name, `${apiOrigin}/icons/${encodeURIComponent(name)}`);
    }
  }

  const locationLookup = new Map<string, {
    name?: string;
    latitude?: number;
    longitude?: number;
    address_ids: string[];
  }>();
  for (const row of locResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    const extractCoord = (plain: string, lookup: string): number | undefined => {
      const val = safeFloat(d[plain]);
      if (val !== undefined) return val;
      const arr = d[lookup] as unknown[] | undefined;
      if (arr && Array.isArray(arr) && arr.length > 0) return safeFloat(arr[0]);
      return undefined;
    };
    locationLookup.set(row.id, {
      name: d.name as string | undefined,
      latitude: extractCoord("latitude", "tmp-latitude"),
      longitude: extractCoord("longitude", "tmp-longitude"),
      address_ids: (d.addresses as string[]) || [],
    });
  }

  const addressLookup = new Map<string, { formatted: string; location_ids: string[] }>();
  for (const row of addrResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    const parts = [d.address_1, d.city, d.state_province, d.postal_code]
      .filter(Boolean)
      .map(String);
    addressLookup.set(row.id, {
      formatted: parts.join(", "),
      location_ids: (d.location as string[]) || [],
    });
  }

  // Geocache: address_id → { latitude, longitude }
  const geocacheLookup = new Map<string, { latitude: number; longitude: number }>();
  for (const row of geocacheResult.results) {
    geocacheLookup.set(row.address_id, { latitude: row.latitude, longitude: row.longitude });
  }

  // SAL junction: service_id → location_ids
  const salLocationLookup = new Map<string, string[]>();
  for (const row of salResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    const serviceIds = (d.services as string[]) || [];
    const locIds = (d.locations as string[]) || [];
    for (const sid of serviceIds) {
      const existing = salLocationLookup.get(sid) || [];
      existing.push(...locIds);
      salLocationLookup.set(sid, existing);
    }
  }

  const phoneLookup = new Map<string, string>();
  for (const row of phoneResult.results) {
    const d = JSON.parse(row.data) as Record<string, unknown>;
    phoneLookup.set(row.id, (d.number as string) || "");
  }

  // Resolve location for a given location ID
  function resolveLocation(locId: string): { lat?: number; lng?: number; addr?: string } {
    const loc = locationLookup.get(locId);
    if (!loc) return {};
    let addrStr = loc.name;
    for (const aid of loc.address_ids) {
      const addr = addressLookup.get(aid);
      if (addr) {
        addrStr = addr.formatted;
        break;
      }
    }
    // Direct coordinates on location record
    if (loc.latitude && loc.longitude) {
      return { lat: loc.latitude, lng: loc.longitude, addr: addrStr };
    }
    // Fallback: geocache keyed on linked address record IDs
    for (const aid of loc.address_ids) {
      const geo = geocacheLookup.get(aid);
      if (geo) {
        return { lat: geo.latitude, lng: geo.longitude, addr: addrStr };
      }
    }
    return { addr: addrStr };
  }

  // Build service list
  const needCategories = new Set<string>();
  const communityCategories = new Set<string>();
  const mapServices: MapService[] = [];

  for (const row of svcResult.results) {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const needFocus = (data.needFocus as string[]) || [];
    const communityFocus = (data.communityFocus as string[]) || [];

    if (Array.isArray(needFocus)) needFocus.forEach((n) => needCategories.add(n));
    if (Array.isArray(communityFocus)) communityFocus.forEach((n) => communityCategories.add(n));

    let latitude: number | undefined;
    let longitude: number | undefined;
    let address: string | undefined;

    // Priority 1: SAL junction
    const salLocIds = salLocationLookup.get(row.id) || [];
    for (const locId of salLocIds) {
      const resolved = resolveLocation(locId);
      if (resolved.lat && resolved.lng) {
        latitude = resolved.lat;
        longitude = resolved.lng;
        address = resolved.addr;
        break;
      }
    }

    // Priority 2: direct locations on service
    if (!latitude) {
      for (const locId of ((data.locations as string[]) || [])) {
        const resolved = resolveLocation(locId);
        if (resolved.lat && resolved.lng) {
          latitude = resolved.lat;
          longitude = resolved.lng;
          address = resolved.addr;
          break;
        }
      }
    }

    // Priority 3: addresses on service
    if (!latitude) {
      for (const addrId of ((data.addresses as string[]) || [])) {
        const addr = addressLookup.get(addrId);
        if (addr) {
          if (!address) address = addr.formatted;
          for (const locId of addr.location_ids) {
            const loc = locationLookup.get(locId);
            if (loc?.latitude && loc?.longitude) {
              latitude = loc.latitude;
              longitude = loc.longitude;
              break;
            }
          }
          if (latitude) break;
        }
      }
    }

    // Priority 4: geocache (Nominatim pre-computed coordinates keyed by address record ID)
    if (!latitude) {
      for (const addrId of ((data.addresses as string[]) || [])) {
        const geo = geocacheLookup.get(addrId);
        if (geo) {
          latitude = geo.latitude;
          longitude = geo.longitude;
          if (!address) {
            const addr = addressLookup.get(addrId);
            if (addr) address = addr.formatted;
          }
          break;
        }
      }
    }

    // 50-mile distance filter from NYC
    if (latitude !== undefined && longitude !== undefined) {
      if (haversine(latitude, longitude, 40.7128, -74.006) > 50.0) {
        latitude = undefined;
        longitude = undefined;
      }
    }

    // Phone
    let phone: string | undefined;
    for (const phoneId of ((data.phones as string[]) || [])) {
      const p = phoneLookup.get(phoneId);
      if (p) {
        phone = p;
        break;
      }
    }

    // Org name
    let orgName: string | undefined;
    for (const orgId of ((data.organizations as string[]) || [])) {
      const name = orgLookup.get(orgId);
      if (name) {
        orgName = name;
        break;
      }
    }

    mapServices.push({
      id: row.id,
      name: (data.name as string) || "Unnamed Service",
      description: data.description as string | undefined,
      address,
      phone,
      url: data.url as string | undefined,
      needFocus: Array.isArray(needFocus) ? needFocus : [],
      communityFocus: Array.isArray(communityFocus) ? communityFocus : [],
      latitude,
      longitude,
      organization_name: orgName,
    });
  }

  const response: MapDataResponse = {
    services: mapServices,
    needCategories: [...needCategories].sort().map((name): CategoryDetail => ({
      name,
      icon: iconLookup.get(name),
    })),
    communityCategories: [...communityCategories].sort().map((name): CategoryDetail => ({
      name,
      icon: iconLookup.get(name),
    })),
  };

  return c.json(response);
});

export { map };
