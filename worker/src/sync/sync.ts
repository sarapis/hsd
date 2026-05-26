/**
 * Airtable → D1 sync logic.
 *
 * Ports airtable/sync.py. Called by the scheduled handler on cron trigger.
 * Each table sync is isolated — failures in one table don't block others.
 *
 * Incremental: compares Airtable modifiedTime against D1 updated_at to skip
 * unchanged records, dramatically reducing D1 write usage.
 */
import { listRecords } from "./airtable-client";
import { upsertRecord, updateSyncMetadata } from "../db/queries";
import type { Env } from "../env";

/**
 * Mapping: local table → Airtable table name + extra column extractors.
 * From airtable/sync.py TABLE_MAPPING.
 */
interface TableConfig {
  airtableName: string;
  extraColumns?: (fields: Record<string, unknown>, recordId: string) => Record<string, string>;
}

const TABLE_MAPPING: Record<string, TableConfig> = {
  organizations: { airtableName: "organizations" },
  services: {
    airtableName: "services",
    extraColumns: (fields): Record<string, string> => {
      const orgs = (fields.organizations || fields.organization) as string[] | undefined;
      return orgs && orgs.length > 0 ? { organization_id: orgs[0] } : {};
    },
  },
  locations: { airtableName: "locations" },
  addresses: { airtableName: "addresses" },
  contacts: { airtableName: "contacts" },
  phones: { airtableName: "phones" },
  schedules: { airtableName: "schedules" },
  languages: { airtableName: "languages" },
  accessibility: { airtableName: "accessibility" },
  service_at_locations: {
    airtableName: "service_at_location",
    extraColumns: (fields): Record<string, string> => {
      const extras: Record<string, string> = {};
      const services = fields.services as string[] | undefined;
      const locations = fields.locations as string[] | undefined;
      if (services && services.length > 0) extras.service_id = services[0];
      if (locations && locations.length > 0) extras.location_id = locations[0];
      return extras;
    },
  },
  taxonomies: { airtableName: "taxonomies" },
  taxonomy_terms: {
    airtableName: "taxonomy_terms",
    extraColumns: (fields): Record<string, string> => {
      const taxonomy = fields.taxonomy as string[] | undefined;
      return taxonomy && taxonomy.length > 0 ? { taxonomy_id: taxonomy[0] } : {};
    },
  },
  programs: { airtableName: "programs" },
  service_areas: { airtableName: "service_areas" },
  funding: { airtableName: "funding" },
  cost_options: { airtableName: "cost_option" },
  required_documents: { airtableName: "required_document" },
};

// ============================================================================
// Stemming & Tokenization
// ============================================================================

/** Common English stop words to exclude from search index. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "this", "that", "these",
  "those", "it", "its", "we", "our", "you", "your", "they", "their",
  "not", "no", "if", "as", "so", "than", "then", "also", "very",
]);

/**
 * Basic English stemmer — strips common suffixes.
 * Not as good as Porter/Snowball but zero-dependency and handles the common cases.
 */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("tion") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ment") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ness") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ous") && word.length > 4) return word.slice(0, -3);
  if (word.endsWith("ful") && word.length > 4) return word.slice(0, -3);
  if (word.endsWith("able") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ible") && word.length > 5) return word.slice(0, -4);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("ly") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Tokenize text into unique stemmed words.
 * Returns Set of lowercase stemmed tokens, excluding stop words.
 */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  for (const word of words) {
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    tokens.add(word);
    const stemmed = stem(word);
    if (stemmed.length >= 2) tokens.add(stemmed);
  }
  return tokens;
}

// ============================================================================
// Incremental Sync
// ============================================================================

/**
 * Sync a single Airtable table to D1 (incremental).
 * Compares Airtable's modifiedTime against D1's updated_at.
 * Returns { total, written, skipped }.
 */
async function syncTable(
  env: Env,
  localTable: string,
  config: TableConfig,
): Promise<{ total: number; written: number; skipped: number }> {
  const records = await listRecords(
    env.AIRTABLE_API_KEY,
    env.AIRTABLE_BASE_ID,
    config.airtableName,
  );

  // Fetch existing updated_at timestamps for comparison
  const { results: existing } = await env.DB
    .prepare(`SELECT id, updated_at FROM ${localTable}`)
    .all<{ id: string; updated_at: string }>();
  const existingMap = new Map(existing.map((r) => [r.id, r.updated_at]));

  let written = 0;
  let skipped = 0;

  for (const record of records) {
    const id = (record.fields.id as string) || record.id;
    const extraColumns = config.extraColumns
      ? config.extraColumns(record.fields, record.id)
      : {};

    // Incremental check: skip if record hasn't been modified since last sync
    const modifiedTime = record.lastModifiedTime;
    const existingUpdatedAt = existingMap.get(id);

    if (existingUpdatedAt && modifiedTime) {
      const airtableTime = new Date(modifiedTime).getTime();
      const d1Time = new Date(existingUpdatedAt).getTime();
      if (airtableTime <= d1Time) {
        skipped++;
        continue;
      }
    }

    await upsertRecord(
      env.DB,
      localTable,
      id,
      record.id,
      record.fields,
      extraColumns,
    );
    written++;
  }

  await updateSyncMetadata(env.DB, localTable, records.length);
  return { total: records.length, written, skipped };
}

/**
 * Rebuild the search_tokens table from current services + organizations.
 * Called after full sync to update the search index.
 */
async function rebuildSearchTokens(db: D1Database): Promise<number> {
  await db.prepare("DELETE FROM search_tokens").run();

  const { results: services } = await db
    .prepare("SELECT id, organization_id, data FROM services")
    .all<{ id: string; organization_id: string; data: string }>();

  // Fetch org names for enrichment
  const { results: orgs } = await db
    .prepare("SELECT id, data FROM organizations")
    .all<{ id: string; data: string }>();
  const orgNameMap = new Map<string, string>();
  for (const org of orgs) {
    const orgData = JSON.parse(org.data) as Record<string, unknown>;
    if (orgData.name) orgNameMap.set(org.id, String(orgData.name));
  }

  let tokenCount = 0;

  for (const svc of services) {
    const data = JSON.parse(svc.data) as Record<string, unknown>;
    const name = String(data.name || "");
    const desc = String(data.description || "");
    const orgName = orgNameMap.get(svc.organization_id) || "";

    const nameTokens = tokenize(name);
    const descTokens = tokenize(desc);
    const orgTokens = tokenize(orgName);

    const stmts: D1PreparedStatement[] = [];
    for (const token of nameTokens) {
      stmts.push(
        db.prepare("INSERT INTO search_tokens (service_id, token, source) VALUES (?1, ?2, 'name')")
          .bind(svc.id, token),
      );
    }
    for (const token of descTokens) {
      if (!nameTokens.has(token)) {
        stmts.push(
          db.prepare("INSERT INTO search_tokens (service_id, token, source) VALUES (?1, ?2, 'description')")
            .bind(svc.id, token),
        );
      }
    }
    for (const token of orgTokens) {
      if (!nameTokens.has(token) && !descTokens.has(token)) {
        stmts.push(
          db.prepare("INSERT INTO search_tokens (service_id, token, source) VALUES (?1, ?2, 'organization')")
            .bind(svc.id, token),
        );
      }
    }

    if (stmts.length > 0) {
      await db.batch(stmts);
      tokenCount += stmts.length;
    }
  }

  return tokenCount;
}

/**
 * Download and cache category icons from Airtable attachment URLs.
 * Airtable signed URLs expire after a few hours — this stores the actual
 * image data in D1 so the Worker can serve them indefinitely.
 */
async function cacheIcons(db: D1Database): Promise<number> {
  const { results: terms } = await db
    .prepare("SELECT id, data FROM taxonomy_terms")
    .all<{ id: string; data: string }>();

  let cached = 0;
  for (const term of terms) {
    const d = JSON.parse(term.data) as Record<string, unknown>;
    const name = d.name as string;
    const iconDark = d["x-icon_dark"] as Array<{ url?: string; type?: string }> | undefined;

    if (!name || !iconDark || !Array.isArray(iconDark) || iconDark.length === 0 || !iconDark[0].url) {
      continue;
    }

    // Check if we already have this icon cached
    const existing = await db
      .prepare("SELECT cached_at FROM icon_cache WHERE category_name = ?1")
      .bind(name)
      .first<{ cached_at: string }>();

    // Re-cache every 24 hours (Airtable URLs typically expire in 2-4 hours)
    if (existing) {
      const cacheAge = Date.now() - new Date(existing.cached_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        continue; // Still fresh
      }
    }

    try {
      const resp = await fetch(iconDark[0].url);
      if (!resp.ok) {
        console.log(`Icon fetch failed for ${name}: ${resp.status}`);
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
      console.error(`Icon cache error for ${name}:`, err);
    }
  }

  return cached;
}

/**
 * Run a full sync of all tables.
 * Called by the scheduled handler.
 */
export async function runFullSync(env: Env): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};

  for (const [localTable, config] of Object.entries(TABLE_MAPPING)) {
    try {
      const { total, written, skipped } = await syncTable(env, localTable, config);
      results[localTable] = { total, written, skipped };
      console.log(`Synced ${localTable}: ${total} records (${written} written, ${skipped} skipped)`);
    } catch (err) {
      console.error(`Failed to sync ${localTable}:`, err);
      results[localTable] = { error: String(err) };
    }
  }

  // Rebuild search tokens after sync
  try {
    const tokenCount = await rebuildSearchTokens(env.DB);
    results._search_tokens = { tokens: tokenCount };
    console.log(`Rebuilt search index: ${tokenCount} tokens`);
  } catch (err) {
    console.error("Failed to rebuild search tokens:", err);
    results._search_tokens = { error: String(err) };
  }

  // Cache category icons (download from Airtable → base64 in D1)
  try {
    const iconCount = await cacheIcons(env.DB);
    results._icons = { cached: iconCount };
    if (iconCount > 0) console.log(`Cached ${iconCount} category icons`);
  } catch (err) {
    console.error("Failed to cache icons:", err);
    results._icons = { error: String(err) };
  }

  return results;
}

/**
 * Sync a single table by name.
 * Used by the /sync/table/:table endpoint for incremental seeding.
 */
export async function syncSingleTable(env: Env, tableName: string): Promise<number> {
  const config = TABLE_MAPPING[tableName];
  if (!config) {
    throw new Error(`Unknown table: ${tableName}. Valid tables: ${Object.keys(TABLE_MAPPING).join(", ")}`);
  }
  const { total } = await syncTable(env, tableName, config);
  return total;
}

