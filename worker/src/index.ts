/**
 * HSDS API Worker — Main entry point.
 *
 * Hono app with all route groups, CORS, scheduled sync, and MCP server.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";

// Route modules
import { root } from "./routes/root";
import { services } from "./routes/services";
import { organizations } from "./routes/organizations";
import { taxonomies, taxonomyTerms } from "./routes/taxonomies";
import { serviceAtLocations } from "./routes/service_at_locations";
import { locations } from "./routes/locations";
import { map } from "./routes/map";
import { chat } from "./chat/handler";

// Sync
import { runFullSync } from "./sync/sync";
import { toUuid } from "./mapper";

// MCP
import { DirectoryMcpAgent } from "./mcp/server";
import { routeAgentRequest } from "agents";

const app = new Hono<{ Bindings: Env }>();

// ============================================================================
// Middleware
// ============================================================================

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept"],
  }),
);

// ============================================================================
// Routes
// ============================================================================

app.route("/", root);
app.route("/services", services);
app.route("/organizations", organizations);
app.route("/taxonomies", taxonomies);
app.route("/taxonomy_terms", taxonomyTerms);
app.route("/service_at_locations", serviceAtLocations);
app.route("/locations", locations);
app.route("/map", map);
app.route("/api/chat", chat);

// ============================================================================
// Icon endpoint — serves cached category icons from D1
// ============================================================================

/**
 * Serve cached category icons. Returns the actual image data stored during sync,
 * avoiding Airtable's expiring signed URLs.
 */
app.get("/icons/:name", async (c) => {
  const name = decodeURIComponent(c.req.param("name"));
  const row = await c.env.DB
    .prepare("SELECT content_type, image_data FROM icon_cache WHERE category_name = ?1")
    .bind(name)
    .first<{ content_type: string; image_data: string }>();

  if (!row) {
    return c.json({ error: "Icon not found" }, 404);
  }

  const binaryStr = atob(row.image_data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": row.content_type,
      "Cache-Control": "public, max-age=86400", // 24 hours
      "Access-Control-Allow-Origin": "*",
    },
  });
});

// ============================================================================
// MCP endpoint — Streamable HTTP at /mcp
// ============================================================================

app.all("/mcp", async (c) => {
  return (routeAgentRequest(c.req.raw, c.env) as unknown) as Response;
});
app.all("/mcp/*", async (c) => {
  return (routeAgentRequest(c.req.raw, c.env) as unknown) as Response;
});

// ============================================================================
// Health / Status endpoints
// ============================================================================

app.get("/health", async (c) => {
  try {
    const result = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM services").first<{ cnt: number }>();
    return c.json({
      status: "ok",
      services: result?.cnt ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return c.json({ status: "error", message: "Database unavailable" }, 503);
  }
});

app.get("/sync/status", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM sync_metadata ORDER BY table_name").all();
  return c.json({ sync_metadata: results });
});

// ============================================================================
// Sync & Admin endpoints (protected by SYNC_SECRET)
// ============================================================================

/** Guard: require SYNC_SECRET bearer token for admin endpoints. */
function requireSyncAuth(c: { req: { header: (name: string) => string | undefined }; env: Env; json: (body: unknown, status?: number) => Response }): Response | null {
  const secret = c.env.SYNC_SECRET;
  if (!secret) return null; // No secret configured → open (dev mode)
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${secret}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}

// Manual sync trigger (uses waitUntil to avoid CPU timeout)
app.post("/sync/trigger", async (c) => {
  const denied = requireSyncAuth(c);
  if (denied) return denied;
  const env = c.env;
  c.executionCtx.waitUntil(
    runFullSync(env).then((results) => {
      console.log("Manual sync completed:", JSON.stringify(results));
    }),
  );
  return c.json({ status: "sync_started", message: "Sync running in background. Check /sync/status for progress." });
});

// Sync a single table (for incremental seeding)
app.post("/sync/table/:table", async (c) => {
  const denied = requireSyncAuth(c);
  if (denied) return denied;
  const tableName = c.req.param("table");
  const env = c.env;
  try {
    const { syncSingleTable } = await import("./sync/sync");
    const count = await syncSingleTable(env, tableName);
    return c.json({ status: "completed", table: tableName, records: count });
  } catch (err) {
    return c.json({ status: "error", table: tableName, error: String(err) }, 500);
  }
});

/**
 * Manual icon cache endpoint.
 * Downloads category icons from Airtable and stores as base64 in D1.
 * Processes in batches of 5 to stay within subrequest limits.
 */
app.post("/sync/icons", async (c) => {
  const denied = requireSyncAuth(c);
  if (denied) return denied;

  const db = c.env.DB;
  const BATCH_SIZE = 5;

  // Get all taxonomy terms with icon URLs
  const { results: terms } = await db
    .prepare("SELECT id, data FROM taxonomy_terms")
    .all<{ id: string; data: string }>();

  const toCache: Array<{ name: string; url: string }> = [];
  for (const term of terms) {
    const d = JSON.parse(term.data) as Record<string, unknown>;
    const name = d.name as string;
    const iconDark = d["x-icon_dark"] as Array<{ url?: string }> | undefined;

    if (!name || !iconDark || !Array.isArray(iconDark) || iconDark.length === 0 || !iconDark[0].url) {
      continue;
    }

    // Skip if already cached within 24h
    const existing = await db
      .prepare("SELECT cached_at FROM icon_cache WHERE category_name = ?1")
      .bind(name)
      .first<{ cached_at: string }>();

    if (existing) {
      const cacheAge = Date.now() - new Date(existing.cached_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) continue;
    }

    toCache.push({ name, url: iconDark[0].url });
  }

  // Process batch
  const batch = toCache.slice(0, BATCH_SIZE);
  let cached = 0;
  const errors: string[] = [];

  for (const { name, url } of batch) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        errors.push(`${name}: HTTP ${resp.status}`);
        continue;
      }

      const buffer = await resp.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const contentType = resp.headers.get("content-type") || "image/png";

      await db
        .prepare(
          "INSERT OR REPLACE INTO icon_cache (category_name, content_type, image_data, cached_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(name, contentType, base64, new Date().toISOString())
        .run();
      cached++;
    } catch (err) {
      errors.push(`${name}: ${String(err)}`);
    }
  }

  return c.json({
    status: "completed",
    cached,
    remaining: toCache.length - batch.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/**
 * Backfill the `uuid` column added in migration 001.
 *
 * New and updated rows get their uuid from upsertRecord, but existing rows
 * carry NULL until this runs, and every NULL row forces /:id lookups down the
 * transitional scan path. Idempotent — only touches rows where uuid IS NULL,
 * so it is safe to call repeatedly, and safe to call again after a sync.
 */
app.post("/sync/backfill-uuids", async (c) => {
  const denied = requireSyncAuth(c);
  if (denied) return denied;

  const db = c.env.DB;
  const tables = [
    "organizations", "services", "locations",
    "service_at_locations", "taxonomies", "taxonomy_terms",
  ];

  const filled: Record<string, number> = {};
  const collisions: string[] = [];

  for (const table of tables) {
    const { results } = await db
      .prepare(`SELECT id FROM ${table} WHERE uuid IS NULL`)
      .all<{ id: string }>();

    let count = 0;
    for (let i = 0; i < results.length; i += 50) {
      const chunk = results.slice(i, i + 50);
      const statements = chunk.map((row) =>
        db.prepare(`UPDATE ${table} SET uuid = ?1 WHERE id = ?2`).bind(toUuid(row.id), row.id),
      );
      try {
        await db.batch(statements);
        count += chunk.length;
      } catch (err) {
        // The uuid index is UNIQUE, so a toUuid hash collision surfaces here
        // rather than silently resolving /:id to the wrong record later.
        collisions.push(`${table}: ${String(err)}`);
        break;
      }
    }
    filled[table] = count;
  }

  return c.json({
    status: collisions.length > 0 ? "completed_with_errors" : "completed",
    filled,
    collisions: collisions.length > 0 ? collisions : undefined,
  });
});

// Manual seed geocache from JSON body (fallback/import)
app.post("/sync/geocache", async (c) => {
  const denied = requireSyncAuth(c);
  if (denied) return denied;
  const { entries } = (await c.req.json()) as {
    entries: Record<string, { latitude: number; longitude: number; formatted_address?: string; geocoded_at?: string }>;
  };
  if (!entries) return c.json({ error: "Missing entries" }, 400);

  const db = c.env.DB;
  let count = 0;
  for (const [addressId, geo] of Object.entries(entries)) {
    await db
      .prepare(
        "INSERT OR REPLACE INTO geocache (address_id, latitude, longitude, formatted_address, geocoded_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(addressId, geo.latitude, geo.longitude, geo.formatted_address || null, geo.geocoded_at || null)
      .run();
    count++;
  }
  return c.json({ status: "completed", records: count });
});

/**
 * Google Geocoding API — geocode addresses not yet in geocache.
 * Processes up to 10 per call (free plan: 50 subrequest limit).
 * Call repeatedly until remaining === 0.
 */
app.post("/sync/geocode", async (c) => {
  const denied = requireSyncAuth(c);
  if (denied) return denied;
  const apiKey = c.env.GOOGLE_GEOCODING_API_KEY;
  if (!apiKey) return c.json({ error: "GOOGLE_GEOCODING_API_KEY not configured" }, 400);

  const db = c.env.DB;
  const BATCH_SIZE = 10;

  // Find addresses not yet geocoded (limited batch)
  const { results: addresses } = await db
    .prepare(
      `SELECT a.id, a.data FROM addresses a
       LEFT JOIN geocache g ON a.id = g.address_id
       WHERE g.address_id IS NULL
       LIMIT ?1`,
    )
    .bind(BATCH_SIZE)
    .all<{ id: string; data: string }>();

  if (!addresses || addresses.length === 0) {
    return c.json({ status: "completed", message: "All addresses already geocoded", remaining: 0 });
  }

  let geocoded = 0;
  let failed = 0;

  for (const row of addresses) {
    const fields = JSON.parse(row.data) as Record<string, unknown>;
    const parts = [
      fields.address_1,
      fields.city,
      fields.state_province,
      fields.postal_code,
    ].filter(Boolean).map(String);
    const query = parts.join(", ");
    if (!query.trim()) { failed++; continue; }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`;
      const resp = await fetch(url);
      const data = (await resp.json()) as {
        status: string;
        results: Array<{ geometry: { location: { lat: number; lng: number } }; formatted_address: string }>;
      };

      if (data.status === "OK" && data.results.length > 0) {
        const loc = data.results[0].geometry.location;

        // NYC proximity check: reject results > 200 miles from NYC
        const R = 3958.8;
        const dLat = (loc.lat - 40.7128) * Math.PI / 180;
        const dLon = (loc.lng - (-74.006)) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(40.7128 * Math.PI / 180) * Math.cos(loc.lat * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        if (dist > 200) {
          console.log(`Rejected ${row.id}: ${query.slice(0, 50)} (${dist.toFixed(0)}mi from NYC)`);
          // Still insert a zero-coord record to mark as processed (won't match map queries)
          await db
            .prepare("INSERT OR REPLACE INTO geocache (address_id, latitude, longitude, formatted_address, geocoded_at) VALUES (?1, 0, 0, ?2, ?3)")
            .bind(row.id, `REJECTED: ${dist.toFixed(0)}mi from NYC`, new Date().toISOString())
            .run();
          failed++;
          continue;
        }

        await db
          .prepare(
            "INSERT OR REPLACE INTO geocache (address_id, latitude, longitude, formatted_address, geocoded_at) VALUES (?1, ?2, ?3, ?4, ?5)",
          )
          .bind(row.id, loc.lat, loc.lng, data.results[0].formatted_address, new Date().toISOString())
          .run();
        geocoded++;
      } else {
        console.log(`No result for ${row.id}: ${query.slice(0, 50)} (${data.status})`);
        // Mark as processed with zero coords
        await db
          .prepare("INSERT OR REPLACE INTO geocache (address_id, latitude, longitude, formatted_address, geocoded_at) VALUES (?1, 0, 0, ?2, ?3)")
          .bind(row.id, `NO_RESULT: ${data.status}`, new Date().toISOString())
          .run();
        failed++;
      }
    } catch (err) {
      console.error(`Geocode error for ${row.id}:`, err);
      failed++;
    }
  }

  // Count remaining
  const remaining = await db
    .prepare("SELECT COUNT(*) as cnt FROM addresses a LEFT JOIN geocache g ON a.id = g.address_id WHERE g.address_id IS NULL")
    .first<{ cnt: number }>();

  return c.json({
    status: "batch_completed",
    batch_size: addresses.length,
    geocoded,
    failed,
    remaining: remaining?.cnt ?? 0,
  });
});

// Geocache stats
app.get("/sync/geocache", async (c) => {
  const [cacheResult, addrResult] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM geocache").first<{ cnt: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as cnt FROM addresses").first<{ cnt: number }>(),
  ]);
  return c.json({
    geocache_entries: cacheResult?.cnt ?? 0,
    total_addresses: addrResult?.cnt ?? 0,
    coverage: addrResult?.cnt ? `${Math.round(((cacheResult?.cnt ?? 0) / addrResult.cnt) * 100)}%` : "0%",
  });
});

// ============================================================================
// Export
// ============================================================================

export default {
  fetch: app.fetch,

  /** Scheduled handler — runs Airtable sync on cron trigger. */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runFullSync(env).then((results) => {
        console.log("Scheduled sync completed:", JSON.stringify(results));
      }),
    );
  },
};

// Export MCP Agent class for Durable Object binding
export { DirectoryMcpAgent };
