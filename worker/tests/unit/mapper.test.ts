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
      expect(result.id).toBe("phone-1");
      expect(result.number).toBe("555-123-4567");
      expect(result.extension).toBe("123");
      expect(result.type).toBe("Office");
    });

    it("strips undefined optional fields", () => {
      const input: AirtablePhone = { id: "phone-2", number: "555-000-0000" };
      const result = mapPhone(input);
      expect(result).toEqual({ id: "phone-2", number: "555-000-0000" });
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
      expect(result.organization_id).toBe("org-1");
      expect(result.need_focus).toEqual(["Food"]);
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
