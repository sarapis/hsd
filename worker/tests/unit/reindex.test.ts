/**
 * Unit tests for scoped search-index reindexing.
 *
 * Regression coverage for the D1 write blowout: the index used to be fully
 * rebuilt (DELETE everything, reinsert everything) whenever a sync wrote any
 * record at all, so one edited service cost ~2x the token count in writes —
 * about 55,000 for production — and a normal editing day exceeded D1's
 * 100,000 writes/day free limit several times over.
 *
 * What matters here is not just correctness but WRITE VOLUME, so these tests
 * assert which statements are issued, not only the resulting token counts.
 */
import { describe, it, expect } from "vitest";
import { reindexSearchTokens } from "../../src/sync/sync";

interface Issued { sql: string; params: unknown[] }

/** Minimal D1 stand-in that records every statement instead of executing it. */
function fakeDb(services: Array<{ id: string; organization_id: string; data: string }>,
                orgs: Array<{ id: string; data: string }>) {
  const issued: Issued[] = [];
  const makeStmt = (sql: string, params: unknown[] = []): any => ({
    bind: (...p: unknown[]) => makeStmt(sql, p),
    run: async () => { issued.push({ sql, params }); return {}; },
    all: async () => {
      issued.push({ sql, params });
      if (/FROM organizations/.test(sql)) return { results: orgs };
      if (/FROM services WHERE id IN/.test(sql)) {
        return { results: services.filter((s) => params.includes(s.id)) };
      }
      if (/FROM services/.test(sql)) return { results: services };
      return { results: [] };
    },
  });
  return {
    issued,
    db: {
      prepare: (sql: string) => makeStmt(sql),
      batch: async (stmts: any[]) => { for (const st of stmts) await st.run(); return []; },
    } as unknown as D1Database,
  };
}

const SERVICES = [
  { id: "svc-1", organization_id: "org-1", data: JSON.stringify({ name: "Food Pantry", description: "Free groceries" }) },
  { id: "svc-2", organization_id: "org-1", data: JSON.stringify({ name: "Hot Meals", description: "Dinner service" }) },
  { id: "svc-3", organization_id: "org-2", data: JSON.stringify({ name: "Eviction Defense", description: "Housing court" }) },
];
const ORGS = [
  { id: "org-1", data: JSON.stringify({ name: "Brooklyn Kitchen" }) },
  { id: "org-2", data: JSON.stringify({ name: "Queens Legal" }) },
];

const inserts = (issued: Issued[]) => issued.filter((i) => /INSERT INTO search_tokens/.test(i.sql));
const insertedServiceIds = (issued: Issued[]) => new Set(inserts(issued).map((i) => i.params[0]));

describe("reindexSearchTokens — full rebuild", () => {
  it("clears the whole table and reindexes every service", async () => {
    const { db, issued } = fakeDb(SERVICES, ORGS);
    const written = await reindexSearchTokens(db);

    expect(issued.some((i) => /^DELETE FROM search_tokens$/.test(i.sql.trim()))).toBe(true);
    expect(insertedServiceIds(issued)).toEqual(new Set(["svc-1", "svc-2", "svc-3"]));
    expect(written).toBe(inserts(issued).length);
  });
});

describe("reindexSearchTokens — scoped", () => {
  it("touches only the named service", async () => {
    const { db, issued } = fakeDb(SERVICES, ORGS);
    await reindexSearchTokens(db, { serviceIds: new Set(["svc-2"]) });

    // The unscoped table-wide DELETE must never run in a scoped reindex.
    expect(issued.some((i) => /^DELETE FROM search_tokens$/.test(i.sql.trim()))).toBe(false);

    const del = issued.find((i) => /DELETE FROM search_tokens WHERE service_id IN/.test(i.sql));
    expect(del?.params).toEqual(["svc-2"]);
    expect(insertedServiceIds(issued)).toEqual(new Set(["svc-2"]));
  });

  it("writes far fewer rows than a full rebuild", async () => {
    const full = fakeDb(SERVICES, ORGS);
    await reindexSearchTokens(full.db);
    const scoped = fakeDb(SERVICES, ORGS);
    await reindexSearchTokens(scoped.db, { serviceIds: new Set(["svc-2"]) });

    expect(inserts(scoped.issued).length).toBeLessThan(inserts(full.issued).length);
  });

  it("drops entries for a removed service without reinserting them", async () => {
    const { db, issued } = fakeDb(SERVICES, ORGS);
    await reindexSearchTokens(db, {
      serviceIds: new Set(["svc-1"]),
      removedServiceIds: new Set(["svc-3"]),
    });

    const del = issued.find((i) => /DELETE FROM search_tokens WHERE service_id IN/.test(i.sql));
    expect(new Set(del?.params)).toEqual(new Set(["svc-1", "svc-3"]));
    // svc-3 is gone: cleared, never reindexed.
    expect(insertedServiceIds(issued)).toEqual(new Set(["svc-1"]));
  });

  it("does nothing at all when no service changed", async () => {
    const { db, issued } = fakeDb(SERVICES, ORGS);
    const written = await reindexSearchTokens(db, { serviceIds: new Set() });

    expect(written).toBe(0);
    expect(issued.filter((i) => /DELETE FROM search_tokens/.test(i.sql))).toHaveLength(0);
    expect(inserts(issued)).toHaveLength(0);
  });

  it("indexes the organization name alongside the service's own text", async () => {
    const { db, issued } = fakeDb(SERVICES, ORGS);
    await reindexSearchTokens(db, { serviceIds: new Set(["svc-1"]) });

    const tokens = inserts(issued).map((i) => i.params[1]);
    expect(tokens).toContain("brooklyn");   // from the organization
    expect(tokens).toContain("pantry");     // from the service name
    expect(tokens).toContain("groceries");  // from the description
  });
});
