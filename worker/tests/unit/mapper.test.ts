/**
 * Unit tests for mapper functions.
 *
 * Inspired by PR #15's test_application_layer.py approach:
 * - Test pure functions with typed input data
 * - Verify field mapping, null stripping, and edge cases
 */
import { describe, it, expect } from "vitest";
import {
  mapPhone,
  mapAddress,
  mapSchedule,
  mapContact,
  mapServiceSummary,
  mapOrganizationSummary,
  safeFloat,
  safeInt,
  firstOrNone,
  stripNulls,
  paginate,
  toUuid,
  sanitiseEmail,
  normaliseUrl,
  normaliseStatus,
} from "../../src/mapper";
import type { AirtablePhone, AirtableAddress, AirtableSchedule } from "../../src/airtable-types";

describe("Utility helpers", () => {
  describe("safeFloat", () => {
    it("parses a valid number string", () => {
      expect(safeFloat("40.7128")).toBe(40.7128);
    });

    it("returns undefined for empty string", () => {
      expect(safeFloat("")).toBeUndefined();
    });

    it("returns undefined for null", () => {
      expect(safeFloat(null)).toBeUndefined();
    });

    it("passes through number values", () => {
      expect(safeFloat(3.14)).toBe(3.14);
    });

    it("returns undefined for non-numeric string", () => {
      expect(safeFloat("not-a-number")).toBeUndefined();
    });
  });

  describe("safeInt", () => {
    it("floors float to int", () => {
      expect(safeInt(18.7)).toBe(18);
    });

    it("returns undefined for NaN input", () => {
      expect(safeInt("abc")).toBeUndefined();
    });

    // CHARACTERIZATION: Number("") is 0, so an empty Airtable cell becomes 0
    // rather than being stripped — safeFloat handles this case correctly and
    // safeInt does not. A `minimum_age: 0` is not the same as an absent one.
    // Phase 5 changes this to undefined; update this expectation with the fix.
    it("returns 0 for empty string (known inconsistency with safeFloat)", () => {
      expect(safeInt("")).toBe(0);
      expect(safeFloat("")).toBeUndefined();
    });
  });

  describe("firstOrNone", () => {
    it("returns first element", () => {
      expect(firstOrNone(["a", "b"])).toBe("a");
    });

    it("returns undefined for empty array", () => {
      expect(firstOrNone([])).toBeUndefined();
    });

    it("returns undefined for null", () => {
      expect(firstOrNone(null)).toBeUndefined();
    });
  });

  describe("stripNulls", () => {
    it("removes undefined and null values", () => {
      const result = stripNulls({ a: "hello", b: undefined, c: null, d: 0 });
      expect(result).toEqual({ a: "hello", d: 0 });
    });

    it("preserves empty strings and falsy values", () => {
      const result = stripNulls({ a: "", b: false, c: 0 });
      expect(result).toEqual({ a: "", b: false, c: 0 });
    });
  });

  describe("toUuid", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    // Golden values. Every published id in the API derives from this function,
    // so its output is a compatibility contract, not an implementation detail —
    // if these change, every service/org URL and every downstream consumer breaks.
    // `recIRw2WYaFKRJZcv` is a real taxonomy id; its expected value here is the
    // one currently served in production.
    it("produces stable, known values for real Airtable ids", () => {
      expect(toUuid("recIRw2WYaFKRJZcv")).toBe("15656349-5277-5257-9961-464b524a5a63");
      expect(toUuid("phone-1")).toBe("77686f6e-652d-5100-8000-000000000000");
      expect(toUuid("org-1")).toBe("6a72672d-3100-5000-8000-000000000000");
    });

    it("is deterministic across calls", () => {
      expect(toUuid("recABC123")).toBe(toUuid("recABC123"));
    });

    it("emits RFC-shaped uuids with version and variant bits set", () => {
      const uuid = toUuid("recIRw2WYaFKRJZcv");
      expect(uuid).toMatch(UUID_RE);
      expect(uuid[14]).toBe("5"); // version nibble
      expect("89ab").toContain(uuid[19]); // variant nibble
    });

    it("passes through an existing uuid, lowercased", () => {
      const existing = "6BA7B810-9DAD-11D1-80B4-00C04FD430C8";
      expect(toUuid(existing)).toBe(existing.toLowerCase());
    });

    it("distinguishes distinct ids of equal length", () => {
      expect(toUuid("recAAAAAAAAAAAAAA")).not.toBe(toUuid("recBBBBBBBBBBBBBB"));
    });

    // CHARACTERIZATION: the empty-string case returns the nil uuid rather than
    // undefined, and the nil uuid is truthy — which is why `toUuid(x) || undefined`
    // at mapper.ts:330/407/428 is dead code and 96 of 100 taxonomy terms publish
    // parent_id: 00000000-... instead of omitting the field. Phase 1 fixes the
    // callers (checking emptiness before converting), not this function.
    it("returns the nil uuid for empty input, and the nil uuid is truthy", () => {
      expect(toUuid("")).toBe("00000000-0000-0000-0000-000000000000");
      expect(Boolean(toUuid(""))).toBe(true);
    });
  });

  describe("sanitiseEmail", () => {
    it("accepts a plain address", () => {
      expect(sanitiseEmail("help@example.org")).toBe("help@example.org");
    });

    it("trims surrounding whitespace", () => {
      expect(sanitiseEmail("  help@example.org  ")).toBe("help@example.org");
    });

    it("rejects urls and empty values", () => {
      expect(sanitiseEmail("https://example.org")).toBeUndefined();
      expect(sanitiseEmail("www.example.org")).toBeUndefined();
      expect(sanitiseEmail("not-an-email")).toBeUndefined();
      expect(sanitiseEmail("")).toBeUndefined();
      expect(sanitiseEmail(null)).toBeUndefined();
    });

    // CHARACTERIZATION: the doc comment claims "exactly one '@'" but the check is
    // `includes("@")`, so multi-address and malformed values pass through into
    // HSDS output. Phase 5 tightens this to real validation.
    it("lets multi-address and spaced values through (weaker than documented)", () => {
      expect(sanitiseEmail("a@b.org, c@d.org")).toBe("a@b.org, c@d.org");
      expect(sanitiseEmail("mailto:x@y.org")).toBe("mailto:x@y.org");
    });
  });

  describe("normaliseUrl", () => {
    it("passes through absolute http and https urls", () => {
      expect(normaliseUrl("https://example.org/a")).toBe("https://example.org/a");
      expect(normaliseUrl("http://example.org")).toBe("http://example.org");
    });

    it("adds a scheme to bare domains", () => {
      expect(normaliseUrl("www.example.org")).toBe("https://www.example.org");
      expect(normaliseUrl("example.org/path")).toBe("https://example.org/path");
    });

    it("returns undefined for empty values", () => {
      expect(normaliseUrl("")).toBeUndefined();
      expect(normaliseUrl("   ")).toBeUndefined();
      expect(normaliseUrl(null)).toBeUndefined();
    });

    // CHARACTERIZATION: a value containing no dot is returned verbatim, so a
    // `javascript:` payload survives intact and is rendered straight into an
    // href — React does not strip those. Phase 2 adds a scheme allowlist and
    // this expectation becomes undefined.
    it("returns dotless values unchanged, including dangerous schemes", () => {
      expect(normaliseUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    });

    // CHARACTERIZATION: any dot-containing string is treated as a domain, so
    // prose and email addresses become nonsense urls. Phase 5 validates properly.
    it("turns dot-containing prose into a url", () => {
      expect(normaliseUrl("See site.com for info")).toBe("https://See site.com for info");
      expect(normaliseUrl("foo@bar.com")).toBe("https://foo@bar.com");
    });
  });

  describe("normaliseStatus", () => {
    it("maps Airtable publish states onto HSDS status values", () => {
      expect(normaliseStatus("Published")).toBe("active");
      expect(normaliseStatus("active")).toBe("active");
      expect(normaliseStatus("Unpublished")).toBe("inactive");
      expect(normaliseStatus("draft")).toBe("inactive");
      expect(normaliseStatus("Defunct")).toBe("defunct");
      expect(normaliseStatus("closed")).toBe("defunct");
      expect(normaliseStatus("Temporarily Closed")).toBe("temporarily closed");
    });

    it("defaults to active for empty or unrecognised values", () => {
      expect(normaliseStatus("")).toBe("active");
      expect(normaliseStatus(null)).toBe("active");
      expect(normaliseStatus("something else")).toBe("active");
    });
  });
});

describe("Map functions", () => {
  describe("mapPhone", () => {
    it("maps a full phone record", () => {
      const input: AirtablePhone = {
        id: "phone-1",
        number: "555-123-4567",
        extension: "123",
        type: "Office",
        description: "Main office line",
      };
      const result = mapPhone(input);
      // HSDS-UK 3.0 requires uuid-formatted ids, so the raw Airtable id is converted.
      expect(result.id).toBe(toUuid("phone-1"));
      expect(result.number).toBe("555-123-4567");
      expect(result.extension).toBe("123");
      expect(result.type).toBe("Office");
    });

    it("strips undefined optional fields", () => {
      const input: AirtablePhone = { id: "phone-2", number: "555-000-0000" };
      const result = mapPhone(input);
      expect(result).toEqual({ id: toUuid("phone-2"), number: "555-000-0000" });
      expect("extension" in result).toBe(false);
    });
  });

  describe("mapAddress", () => {
    it("maps a full address with array address_type", () => {
      const input: AirtableAddress = {
        id: "addr-1",
        address_1: "123 Main St",
        city: "New York",
        state_province: "NY",
        postal_code: "10001",
        country: "USA",
        address_type: ["physical"],
      };
      const result = mapAddress(input);
      expect(result.address_1).toBe("123 Main St");
      expect(result.address_type).toBe("physical"); // Array → first element
    });
  });

  describe("mapSchedule", () => {
    it("joins array byday into comma-separated string", () => {
      const input: AirtableSchedule = {
        id: "sched-1",
        byday: ["MO", "WE", "FR"],
        opens_at: "09:00",
        closes_at: "17:00",
      };
      const result = mapSchedule(input);
      expect(result.byday).toBe("MO,WE,FR");
    });
  });

  describe("mapOrganizationSummary", () => {
    it("maps core org fields", () => {
      const input = {
        id: "org-1",
        name: "Mutual Aid NYC",
        description: "Community resource network",
        website: "https://mutualaid.nyc",
      };
      const result = mapOrganizationSummary(input);
      expect(result.name).toBe("Mutual Aid NYC");
      expect(result.website).toBe("https://mutualaid.nyc");
    });
  });

  describe("mapServiceSummary", () => {
    it("maps a service with need_focus and community_focus", () => {
      const input = {
        id: "svc-1",
        name: "Food Pantry",
        status: "Published",
        description: "Provides groceries",
        needFocus: ["Food"],
        communityFocus: ["All"],
      };
      const result = mapServiceSummary(input, "org-1");
      expect(result.name).toBe("Food Pantry");
      expect(result.id).toBe(toUuid("svc-1"));
      expect(result.organization_id).toBe(toUuid("org-1"));
      expect(result.need_focus).toEqual(["Food"]);
      expect(result.community_focus).toEqual(["All"]);
      // "Published" is an Airtable state, not an HSDS one.
      expect(result.status).toBe("active");
    });
  });
});

describe("paginate", () => {
  it("creates correct page metadata", () => {
    const items = [1, 2, 3, 4, 5];
    const result = paginate(items, 23, 2, 5);
    expect(result.total_items).toBe(23);
    expect(result.total_pages).toBe(5);
    expect(result.page_number).toBe(2);
    expect(result.size).toBe(5);
    expect(result.first_page).toBe(false);
    expect(result.last_page).toBe(false);
  });

  it("detects first and last page", () => {
    const first = paginate([1, 2], 2, 1, 10);
    expect(first.first_page).toBe(true);
    expect(first.last_page).toBe(true);
  });

  it("handles empty results", () => {
    const empty = paginate([], 0, 1, 20);
    expect(empty.empty).toBe(true);
    expect(empty.total_pages).toBe(1);
  });
});
