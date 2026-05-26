/**
 * Cloudflare Worker environment bindings.
 *
 * Typed interface for D1 database, Workers AI, secrets, and vars
 * defined in wrangler.toml.
 */
export interface Env {
  /** D1 SQLite database binding */
  DB: D1Database;
  /** Workers AI binding */
  AI: Ai;
  /** Airtable Personal Access Token (set via wrangler secret put) */
  AIRTABLE_API_KEY: string;
  /** Airtable Base ID (set via wrangler secret put) */
  AIRTABLE_BASE_ID: string;
  /** Only show services with this status value */
  PUBLISHED_STATUS_VALUE: string;
  /** Sync interval in minutes (informational — cron drives actual schedule) */
  SYNC_INTERVAL_MINUTES: string;
  /** Optional bearer token to protect sync/admin endpoints */
  SYNC_SECRET?: string;
  /** Google Geocoding API key for address coordinate resolution */
  GOOGLE_GEOCODING_API_KEY?: string;
  /** Durable Object binding for MCP Agent */
  DIRECTORY_MCP_AGENT: DurableObjectNamespace;
}
