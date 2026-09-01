/**
 * Airtable → D1 sync logic.
 *
 * Ports airtable/sync.py. Called by the scheduled handler on cron trigger.
 * Each table sync is isolated — failures in one table don't block others.
 *
 * Incremental: compares each record's content against what D1 already stores
 * and writes only what actually differs, in batched round-trips.
 */
import { listRecords } from "./airtable-client";
import { buildUpsertStatement, updateSyncMetadata } from "../db/queries";
import { toBase64 } from "../utils/base64";
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

/** Writes per db.batch call. Keeps each round-trip well inside D1 limits. */
const WRITE_BATCH_SIZE = 50;

export interface SyncTableResult {
  total: number;
  written: number;
  skipped: number;
  /** Ids present in D1 but no longer in Airtable. */
  orphaned: number;
  deleted: number;
  /** Ids actually written this run — lets the search index reindex just these. */
  changedIds: string[];
  /** Ids removed this run, so their index entries can be dropped. */
  deletedIds: string[];
}

export interface SyncOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean;
  /** Delete D1 rows whose ids are no longer present in Airtable. */
  reconcileDeletes?: boolean;
}

/**
 * Sync a single Airtable table to D1 (incremental).
 *
 * Change detection compares the stored JSON against the incoming record rather
 * than comparing timestamps. The previous timestamp check was inert: the client
 * populated `lastModifiedTime` from Airtable's `createdTime` "as a proxy", and
 * createdTime never changes, while D1's `updated_at` is stamped at insert — so
 * `airtableTime <= d1Time` held for every existing row and edits made in
 * Airtable never reached production. Only brand-new records were ever written.
 *
 * Comparing content needs no Airtable schema change, and its failure mode is
 * safe: a key-order difference costs one redundant write, and it can never
 * report a genuinely changed record as unchanged.
 */
async function syncTable(
  env: Env,
  localTable: string,
  config: TableConfig,
  options: SyncOptions = {},
): Promise<SyncTableResult> {
  const records = await listRecords(
    env.AIRTABLE_API_KEY,
    env.AIRTABLE_BASE_ID,
    config.airtableName,
  );

  // Existing content, to detect what actually changed.
  const { results: existing } = await env.DB
    .prepare(`SELECT id, data FROM ${localTable}`)
    .all<{ id: string; data: string }>();
  const existingMap = new Map(existing.map((r) => [r.id, r.data]));

  let written = 0;
  let skipped = 0;
  const changedIds: string[] = [];
  const seenIds = new Set<string>();
  let pending: D1PreparedStatement[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    if (!options.dryRun) await env.DB.batch(pending);
    pending = [];
  };

  for (const record of records) {
    const id = (record.fields.id as string) || record.id;
    seenIds.add(id);

    const extraColumns = config.extraColumns
      ? config.extraColumns(record.fields, record.id)
      : {};

    const previous = existingMap.get(id);
    if (previous !== undefined && previous === JSON.stringify(record.fields)) {
      skipped++;
      continue;
    }

    pending.push(
      buildUpsertStatement(env.DB, localTable, id, record.id, record.fields, extraColumns),
    );
    changedIds.push(id);
    written++;

    if (pending.length >= WRITE_BATCH_SIZE) await flush();
  }
  await flush();

  // Records removed in Airtable otherwise linger in D1 and keep being served.
  const orphanIds = [...existingMap.keys()].filter((id) => !seenIds.has(id));
  let deleted = 0;
  if (options.reconcileDeletes && !options.dryRun && orphanIds.length > 0) {
    for (let i = 0; i < orphanIds.length; i += WRITE_BATCH_SIZE) {
      const chunk = orphanIds.slice(i, i + WRITE_BATCH_SIZE);
      await env.DB.batch(
        chunk.map((id) => env.DB.prepare(`DELETE FROM ${localTable} WHERE id = ?1`).bind(id)),
      );
      deleted += chunk.length;
    }
  }

  if (!options.dryRun) await updateSyncMetadata(env.DB, localTable, records.length);
  return {
    total: records.length,
    written,
    skipped,
    orphaned: orphanIds.length,
    deleted,
    changedIds,
    deletedIds: deleted > 0 ? orphanIds : [],
  };
}

/** Look up organization names, used to enrich a service's tokens. */
async function loadOrgNames(db: D1Database): Promise<Map<string, string>> {
  const { results: orgs } = await db
    .prepare("SELECT id, data FROM organizations")
    .all<{ id: string; data: string }>();
  const map = new Map<string, string>();
  for (const org of orgs) {
    const orgData = JSON.parse(org.data) as Record<string, unknown>;
    if (orgData.name) map.set(org.id, String(orgData.name));
  }
  return map;
}

/** Build the token INSERT statements for a single service row. */
function tokenStatementsForService(
  db: D1Database,
  svc: { id: string; organization_id: string; data: string },
  orgNames: Map<string, string>,
): D1PreparedStatement[] {
  const data = JSON.parse(svc.data) as Record<string, unknown>;
  const nameTokens = tokenize(String(data.name || ""));
  const descTokens = tokenize(String(data.description || ""));
  const orgTokens = tokenize(orgNames.get(svc.organization_id) || "");

  const insert = (token: string, source: string) =>
    db
      .prepare("INSERT INTO search_tokens (service_id, token, source) VALUES (?1, ?2, ?3)")
      .bind(svc.id, token, source);

  const stmts: D1PreparedStatement[] = [];
  for (const token of nameTokens) stmts.push(insert(token, "name"));
  for (const token of descTokens) {
    if (!nameTokens.has(token)) stmts.push(insert(token, "description"));
  }
  for (const token of orgTokens) {
    if (!nameTokens.has(token) && !descTokens.has(token)) stmts.push(insert(token, "organization"));
  }
  return stmts;
}

/**
 * Reindex search tokens.
 *
 * Pass `scope` to reindex only the named services; omit it for a full rebuild.
 *
 * The full rebuild is DELETE-everything-then-reinsert, which costs roughly
 * 2 x the token count in writes — about 55,000 for this dataset. It used to run
 * whenever a sync wrote anything at all, so a single edited service triggered a
 * complete reindex, and a handful of edits per day was enough to blow through
 * D1's 100,000 writes/day free limit. Reindexing only the affected services
 * turns a one-record edit into a few dozen writes instead.
 */
export async function reindexSearchTokens(
  db: D1Database,
  scope?: { serviceIds: Set<string>; removedServiceIds?: Set<string> },
): Promise<number> {
  const orgNames = await loadOrgNames(db);
  let written = 0;

  const insertFor = async (rows: Array<{ id: string; organization_id: string; data: string }>) => {
    let pending: D1PreparedStatement[] = [];
    for (const svc of rows) {
      pending.push(...tokenStatementsForService(db, svc, orgNames));
      if (pending.length >= 200) {
        await db.batch(pending);
        written += pending.length;
        pending = [];
      }
    }
    if (pending.length > 0) {
      await db.batch(pending);
      written += pending.length;
    }
  };

  if (!scope) {
    await db.prepare("DELETE FROM search_tokens").run();
    const { results } = await db
      .prepare("SELECT id, organization_id, data FROM services")
      .all<{ id: string; organization_id: string; data: string }>();
    await insertFor(results);
    return written;
  }

  const rebuildIds = [...scope.serviceIds];
  const touched = [...new Set([...rebuildIds, ...(scope.removedServiceIds ?? [])])];
  if (touched.length === 0) return 0;

  // Clear the old entries for every touched service (including deleted ones,
  // whose tokens would otherwise keep matching searches).
  for (let i = 0; i < touched.length; i += WRITE_BATCH_SIZE) {
    const chunk = touched.slice(i, i + WRITE_BATCH_SIZE);
    const placeholders = chunk.map((_, j) => `?${j + 1}`).join(", ");
    await db
      .prepare(`DELETE FROM search_tokens WHERE service_id IN (${placeholders})`)
      .bind(...chunk)
      .run();
  }

  for (let i = 0; i < rebuildIds.length; i += WRITE_BATCH_SIZE) {
    const chunk = rebuildIds.slice(i, i + WRITE_BATCH_SIZE);
    const placeholders = chunk.map((_, j) => `?${j + 1}`).join(", ");
    const { results } = await db
      .prepare(`SELECT id, organization_id, data FROM services WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: string; organization_id: string; data: string }>();
    await insertFor(results);
  }

  return written;
}

/** Full search-index rebuild. Exposed for recovery via POST /sync/reindex. */
export async function reindexAllSearchTokens(db: D1Database): Promise<number> {
  return reindexSearchTokens(db);
}

/** Services belonging to the given organizations — their tokens embed the org name. */
async function servicesForOrganizations(db: D1Database, orgIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < orgIds.length; i += WRITE_BATCH_SIZE) {
    const chunk = orgIds.slice(i, i + WRITE_BATCH_SIZE);
    const placeholders = chunk.map((_, j) => `?${j + 1}`).join(", ");
    const { results } = await db
      .prepare(`SELECT id FROM services WHERE organization_id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: string }>();
    out.push(...results.map((r) => r.id));
  }
  return out;
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

  // Cache ages in one query rather than one per term.
  const { results: cacheRows } = await db
    .prepare("SELECT category_name, cached_at FROM icon_cache")
    .all<{ category_name: string; cached_at: string }>();
  const cachedAtByName = new Map(cacheRows.map((r) => [r.category_name, r.cached_at]));

  let cached = 0;
  for (const term of terms) {
    const d = JSON.parse(term.data) as Record<string, unknown>;
    const name = d.name as string;
    const iconDark = d["x-icon_dark"] as Array<{ url?: string; type?: string }> | undefined;

    if (!name || !iconDark || !Array.isArray(iconDark) || iconDark.length === 0 || !iconDark[0].url) {
      continue;
    }

    // Re-cache every 24 hours (Airtable URLs typically expire in 2-4 hours)
    const cachedAt = cachedAtByName.get(name);
    if (cachedAt) {
      const cacheAge = Date.now() - new Date(cachedAt).getTime();
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
      const base64 = toBase64(buffer);
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
export async function runFullSync(
  env: Env,
  options: SyncOptions = {},
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  let totalWritten = 0;
  let totalDeleted = 0;

  for (const [localTable, config] of Object.entries(TABLE_MAPPING)) {
    try {
      const result = await syncTable(env, localTable, config, options);
      results[localTable] = result;
      totalWritten += result.written;
      totalDeleted += result.deleted;
      console.log(
        `${options.dryRun ? "[dry-run] " : ""}Synced ${localTable}: ${result.total} records ` +
        `(${result.written} written, ${result.skipped} unchanged, ${result.orphaned} orphaned)`,
      );
    } catch (err) {
      console.error(`Failed to sync ${localTable}:`, err);
      results[localTable] = { error: String(err) };
    }
  }

  if (options.dryRun) {
    results._dry_run = true;
    results._would_write = totalWritten;
    return results;
  }

  // Reindex only the services this sync actually touched.
  //
  // The index is derived from a service's own name/description plus its
  // organization's name, so a changed organization also invalidates the tokens
  // of every service under it. Everything else keeps the entries it already has.
  //
  // This used to be a full DELETE-and-reinsert of the whole table whenever any
  // record changed — roughly 55,000 writes to reflect a single edit, which is
  // what exhausted D1's 100,000/day free write limit on ordinary editing days.
  const svcResult = results.services as SyncTableResult | undefined;
  const orgResult = results.organizations as SyncTableResult | undefined;

  const affected = new Set<string>(svcResult?.changedIds ?? []);
  const removed = new Set<string>(svcResult?.deletedIds ?? []);

  if (orgResult?.changedIds?.length) {
    try {
      for (const id of await servicesForOrganizations(env.DB, orgResult.changedIds)) {
        affected.add(id);
      }
    } catch (err) {
      console.error("Failed to expand changed organizations to services:", err);
    }
  }

  if (affected.size > 0 || removed.size > 0) {
    try {
      const tokenCount = await reindexSearchTokens(env.DB, {
        serviceIds: affected,
        removedServiceIds: removed,
      });
      results._search_tokens = {
        reindexed_services: affected.size,
        removed_services: removed.size,
        tokens_written: tokenCount,
      };
      console.log(
        `Reindexed ${affected.size} service(s) (${removed.size} removed): ${tokenCount} tokens written`,
      );
    } catch (err) {
      console.error("Failed to reindex search tokens:", err);
      results._search_tokens = { error: String(err) };
    }
  } else {
    results._search_tokens = { skipped: "no services changed" };
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

