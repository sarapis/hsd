-- Migration 001 — add the deterministic uuid lookup column.
--
-- schema.sql uses CREATE TABLE IF NOT EXISTS, so adding a column there only
-- affects freshly created databases. Existing databases need this ALTER.
--
-- Why: every /:id endpoint publishes toUuid(id) but stores the raw Airtable id
-- as the primary key, so a request for a uuid missed both indexed columns and
-- fell back to scanning the whole table (pulling every JSON blob) to find the
-- row whose hash matched. This column makes that lookup a single indexed hit.
--
-- The index is UNIQUE so a toUuid hash collision fails loudly at sync time
-- rather than silently resolving to the wrong record. SQLite permits many NULLs
-- in a UNIQUE index, so rows still awaiting backfill coexist without conflict.
--
-- NOT idempotent: SQLite has no ADD COLUMN IF NOT EXISTS, so re-running this
-- errors with "duplicate column name". That is safe to ignore on a re-run.
--
-- Apply:   npm run db:migrate:uuid          (local)
--          npm run db:migrate:uuid:remote   (production)
-- Then backfill existing rows:  POST /sync/backfill-uuids

ALTER TABLE organizations ADD COLUMN uuid TEXT;
ALTER TABLE services ADD COLUMN uuid TEXT;
ALTER TABLE locations ADD COLUMN uuid TEXT;
ALTER TABLE service_at_locations ADD COLUMN uuid TEXT;
ALTER TABLE taxonomies ADD COLUMN uuid TEXT;
ALTER TABLE taxonomy_terms ADD COLUMN uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_uuid ON organizations(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_uuid ON services(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_uuid ON locations(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_at_locations_uuid ON service_at_locations(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomies_uuid ON taxonomies(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_taxonomy_terms_uuid ON taxonomy_terms(uuid);
