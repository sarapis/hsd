/**
 * Tests for sync change detection and reindex scoping.
 *
 * These cover the path that let the D1 write-quota blowout ship with a green
 * suite. The reindex tests handed reindexSearchTokens a pre-built scope, but
 * the bug was in how that scope was COMPUTED: any organization change — even
 * an irrelevant field — reindexed every service under it. On 2026-09-02 a
 * 261-org edit reindexed all 680 services, and three such runs exceeded D1's
 * 100,000 writes/day limit.
 */
import { describe, it, expect } from "vitest";
import { contentFingerprint, diffRecords, computeReindexScope } from "../../src/sync/sync";

const rec = (id: string, fields: Record<string, unknown>) => ({ id, fields });
const stored = (entries: Array<[string, Record<string, unknown>]>) =>
  new Map(entries.map(([id, f]) => [id, JSON.stringify(f)]));

const attachment = (url: string) => ({
  id: "attABC", filename: "food.png", size: 1234, type: "image/png", url,
  thumbnails: { small: { url: url + "&s", width: 36, height: 36 } },
});

describe("contentFingerprint", () => {
  it("ignores re-signed attachment URLs", () => {
    const a = { name: "Food", "x-icon_dark": [attachment("https://x/v1?exp=1")] };
    const b = { name: "Food", "x-icon_dark": [attachment("https://x/v1?exp=2")] };
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
  });

  it("still sees a genuinely different attachment", () => {
    const a = { "x-icon_dark": [attachment("https://x/a")] };
    const b = { "x-icon_dark": [{ ...attachment("https://x/b"), id: "attXYZ", filename: "new.png" }] };
    expect(contentFingerprint(a)).not.toBe(contentFingerprint(b));
  });

  it("ignores key order", () => {
    expect(contentFingerprint({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(contentFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("does not mistake an ordinary object with an id for an attachment", () => {
    // No `filename`, so every field must still count.
    expect(contentFingerprint({ link: { id: "x", label: "one" } }))
      .not.toBe(contentFingerprint({ link: { id: "x", label: "two" } }));
  });
});

describe("diffRecords", () => {
  it("skips an identical record without writing", () => {
    const d = diffRecords([rec("r1", { name: "A" })], stored([["r1", { name: "A" }]]));
    expect(d.toWrite).toHaveLength(0);
    expect(d.skipped).toBe(1);
    expect(d.renamedIds).toEqual([]);
  });

  it("skips a record whose only difference is a rotated attachment URL", () => {
    const before = { name: "Food", "x-icon_dark": [attachment("https://x/v?exp=1")] };
    const after = { name: "Food", "x-icon_dark": [attachment("https://x/v?exp=2")] };
    const d = diffRecords([rec("t1", after)], stored([["t1", before]]));
    expect(d.toWrite).toHaveLength(0);
    expect(d.skipped).toBe(1);
  });

  it("skips a record whose keys were merely reordered", () => {
    const d = diffRecords([rec("r1", { phone: "1", name: "A" })], stored([["r1", { name: "A", phone: "1" }]]));
    expect(d.toWrite).toHaveLength(0);
  });

  it("writes a non-name edit WITHOUT marking it renamed", () => {
    const d = diffRecords([rec("o1", { name: "Org", phone: "2" })], stored([["o1", { name: "Org", phone: "1" }]]));
    expect(d.toWrite.map((w) => w.id)).toEqual(["o1"]);
    expect(d.renamedIds).toEqual([]);
  });

  it("marks a name change as renamed", () => {
    const d = diffRecords([rec("o1", { name: "New Name" })], stored([["o1", { name: "Old Name" }]]));
    expect(d.renamedIds).toEqual(["o1"]);
  });

  it("treats a brand-new record as written and renamed", () => {
    const d = diffRecords([rec("o9", { name: "Fresh" })], new Map());
    expect(d.toWrite.map((w) => w.id)).toEqual(["o9"]);
    expect(d.renamedIds).toEqual(["o9"]);
  });

  it("rewrites a record whose stored JSON is unreadable", () => {
    const d = diffRecords([rec("r1", { name: "A" })], new Map([["r1", "{not json"]]));
    expect(d.toWrite).toHaveLength(1);
  });

  it("uses fields.id over the Airtable record id when present", () => {
    const d = diffRecords([rec("recX", { id: "custom-1", name: "A" })], new Map());
    expect([...d.seenIds]).toEqual(["custom-1"]);
  });
});

/** D1 stand-in answering only the services-by-organization lookup. */
function fakeDb(services: Array<{ id: string; organization_id: string }>) {
  const stmt = (sql: string, params: unknown[] = []): any => ({
    bind: (...p: unknown[]) => stmt(sql, p),
    all: async () => ({
      results: /organization_id IN/.test(sql)
        ? services.filter((s) => params.includes(s.organization_id)).map((s) => ({ id: s.id }))
        : [],
    }),
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}

const DB = fakeDb([
  { id: "svc-1", organization_id: "org-1" },
  { id: "svc-2", organization_id: "org-1" },
  { id: "svc-3", organization_id: "org-2" },
]);

describe("computeReindexScope", () => {
  it("does NOT reindex services when an org changed but its name did not", async () => {
    // The regression: this used to reindex svc-1 and svc-2. org-1 IS in
    // changedIds here — expanding on that instead of renamedIds must fail.
    const orgs = { changedIds: ["org-1"], renamedIds: [] as string[], deletedIds: [] as string[] };
    const scope = await computeReindexScope(DB, undefined, orgs);
    expect([...scope.serviceIds]).toEqual([]);
  });

  it("reindexes every service under a renamed org", async () => {
    const scope = await computeReindexScope(DB, undefined, { renamedIds: ["org-1"], deletedIds: [] });
    expect(new Set(scope.serviceIds)).toEqual(new Set(["svc-1", "svc-2"]));
  });

  it("reindexes services whose org was deleted, so its name leaves their tokens", async () => {
    const scope = await computeReindexScope(DB, undefined, { renamedIds: [], deletedIds: ["org-2"] });
    expect([...scope.serviceIds]).toEqual(["svc-3"]);
  });

  it("includes directly changed services and carries removals through", async () => {
    const scope = await computeReindexScope(
      DB,
      { changedIds: ["svc-3"], deletedIds: ["svc-9"] },
      { renamedIds: [], deletedIds: [] },
    );
    expect([...scope.serviceIds]).toEqual(["svc-3"]);
    expect([...scope.removedServiceIds]).toEqual(["svc-9"]);
  });

  it("never reindexes a service that is being removed", async () => {
    const scope = await computeReindexScope(
      DB,
      { changedIds: [], deletedIds: ["svc-1"] },
      { renamedIds: ["org-1"], deletedIds: [] },
    );
    expect([...scope.serviceIds]).toEqual(["svc-2"]);
    expect([...scope.removedServiceIds]).toEqual(["svc-1"]);
  });

  it("is empty when nothing changed", async () => {
    const scope = await computeReindexScope(DB);
    expect(scope.serviceIds.size + scope.removedServiceIds.size).toBe(0);
  });
});
