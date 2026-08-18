/**
 * Unit tests for pagination query-parameter parsing.
 *
 * Regression coverage for the `?page=abc` → HTTP 500 bug: NaN survived the
 * Math.max/Math.min clamps inline in each route and threw at the D1 bind.
 */
import { describe, it, expect } from "vitest";
import { parseBoundedInt, parsePage, parsePerPage } from "../../src/utils/pagination";

describe("parsePage", () => {
  it("parses a valid page number", () => {
    expect(parsePage("3")).toBe(3);
  });

  it("defaults to 1 when absent or empty", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("   ")).toBe(1);
  });

  // The regression: these each produced NaN and a 500 before the fix.
  it("falls back to 1 for unparseable values", () => {
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("xyz123")).toBe(1);
    expect(parsePage("NaN")).toBe(1);
    expect(parsePage("Infinity")).toBe(1);
    expect(parsePage("-Infinity")).toBe(1);
  });

  it("clamps non-positive pages up to 1", () => {
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-5")).toBe(1);
  });

  it("floors fractional pages", () => {
    expect(parsePage("2.9")).toBe(2);
  });
});

describe("parsePerPage", () => {
  it("parses a valid size and applies the default", () => {
    expect(parsePerPage("50")).toBe(50);
    expect(parsePerPage(undefined)).toBe(20);
  });

  it("honours a caller-supplied default", () => {
    expect(parsePerPage(undefined, 100)).toBe(100);
  });

  it("caps at 100 so query cost stays bounded", () => {
    expect(parsePerPage("5000")).toBe(100);
  });

  it("falls back for unparseable values", () => {
    expect(parsePerPage("xyz")).toBe(20);
  });

  it("clamps non-positive sizes up to 1", () => {
    expect(parsePerPage("0")).toBe(1);
    expect(parsePerPage("-10")).toBe(1);
  });
});

describe("parseBoundedInt", () => {
  it("clamps into the supplied range", () => {
    expect(parseBoundedInt("2000", { fallback: 500, min: 1, max: 1000 })).toBe(1000);
    expect(parseBoundedInt("0", { fallback: 500, min: 1, max: 1000 })).toBe(1);
    expect(parseBoundedInt("750", { fallback: 500, min: 1, max: 1000 })).toBe(750);
  });

  it("falls back rather than throwing on junk", () => {
    expect(parseBoundedInt("junk", { fallback: 500, min: 1, max: 1000 })).toBe(500);
  });

  it("leaves the value unbounded above when no max is given", () => {
    expect(parseBoundedInt("99999", { fallback: 1 })).toBe(99999);
  });
});
