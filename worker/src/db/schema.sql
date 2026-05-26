-- D1 Schema for HSDS Directory
-- Ports the SQLite schema from db/database.py init_db()
-- Note: D1 does NOT support FTS5 — search uses LIKE queries instead.

-- Core tables
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    organization_id TEXT,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_at_locations (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    service_id TEXT,
    location_id TEXT,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taxonomies (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS taxonomy_terms (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    taxonomy_id TEXT,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Supporting tables
CREATE TABLE IF NOT EXISTS phones (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS languages (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS programs (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_areas (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS funding (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_options (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS required_documents (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accessibility (
    id TEXT PRIMARY KEY,
    airtable_id TEXT UNIQUE,
    data TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Sync metadata table
CREATE TABLE IF NOT EXISTS sync_metadata (
    table_name TEXT PRIMARY KEY,
    last_sync TEXT,
    record_count INTEGER
);

-- Geocache: pre-computed coordinates from Google Geocoding API
CREATE TABLE IF NOT EXISTS geocache (
    address_id TEXT PRIMARY KEY,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    formatted_address TEXT,
    geocoded_at TEXT
);

-- Search tokens: normalized words from service name/description for fast prefix search.
-- Replaces LIKE '%term%' with indexed token matching + basic stemming.
CREATE TABLE IF NOT EXISTS search_tokens (
    service_id TEXT NOT NULL,
    token TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'name'
);

-- Icon cache: downloaded Airtable category icons stored as base64.
-- Prevents broken images from expiring Airtable signed URLs.
CREATE TABLE IF NOT EXISTS icon_cache (
    category_name TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    image_data TEXT NOT NULL,
    cached_at TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_services_org ON services(organization_id);
CREATE INDEX IF NOT EXISTS idx_sal_service ON service_at_locations(service_id);
CREATE INDEX IF NOT EXISTS idx_sal_location ON service_at_locations(location_id);
CREATE INDEX IF NOT EXISTS idx_terms_taxonomy ON taxonomy_terms(taxonomy_id);
CREATE INDEX IF NOT EXISTS idx_search_token ON search_tokens(token);
CREATE INDEX IF NOT EXISTS idx_search_service ON search_tokens(service_id);
