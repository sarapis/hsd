/**
 * Smoke tests for the deployed HSDS API.
 *
 * Inspired by PR #15's smoke test pattern — hits real endpoints to verify
 * the deployed service is alive and returning correct data shapes.
 *
 * Run: npm run test:smoke
 */
import { describe, it, expect } from "vitest";

const API_URL = process.env.API_URL || "https://hsds-api.devin-d41.workers.dev";

describe("Health", () => {
  it("GET /health returns status ok", async () => {
    const res = await fetch(`${API_URL}/health`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(typeof data.services).toBe("number");
    expect((data.services as number)).toBeGreaterThan(0);
  });
});

describe("Services", () => {
  it("GET /services returns paginated list", async () => {
    const res = await fetch(`${API_URL}/services?per_page=5`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.total_items).toBeDefined();
    expect(data.contents).toBeDefined();
    expect(Array.isArray(data.contents)).toBe(true);
    expect((data.contents as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it("GET /services?search=food returns results with stemming", async () => {
    const res = await fetch(`${API_URL}/services?search=food+pantries`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    // "food pantries" should match "food pantry" via stemming
    expect((data.total_items as number)).toBeGreaterThan(0);
  });

  it("GET /services/:id returns a service detail", async () => {
    // Get first service ID
    const listRes = await fetch(`${API_URL}/services?per_page=1`);
    const listData = await listRes.json() as { contents: Array<{ id: string }> };
    const firstId = listData.contents[0]?.id;
    expect(firstId).toBeDefined();

    const detailRes = await fetch(`${API_URL}/services/${firstId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as Record<string, unknown>;
    expect(detail.id).toBe(firstId);
    expect(detail.name).toBeDefined();
  });
});

describe("Organizations", () => {
  it("GET /organizations returns paginated list", async () => {
    const res = await fetch(`${API_URL}/organizations?per_page=3`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.total_items).toBeDefined();
    expect(Array.isArray(data.contents)).toBe(true);
  });
});

describe("Map", () => {
  it("GET /map/services returns services with coordinates and categories", async () => {
    const res = await fetch(`${API_URL}/map/services`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.services).toBeDefined();
    expect(data.needCategories).toBeDefined();
    expect(Array.isArray(data.services)).toBe(true);
    expect(Array.isArray(data.needCategories)).toBe(true);
    // Should have geocoded services with lat/lng
    const services = data.services as Array<Record<string, unknown>>;
    const withCoords = services.filter((s) => s.latitude && s.longitude);
    expect(withCoords.length).toBeGreaterThan(0);
  });

  it("categories have Worker icon URLs (not Airtable)", async () => {
    const res = await fetch(`${API_URL}/map/services`);
    const data = await res.json() as { needCategories: Array<{ name: string; icon?: string }> };
    const withIcons = data.needCategories.filter((c) => c.icon);
    // Icons should point to our Worker, not Airtable
    for (const cat of withIcons) {
      expect(cat.icon).toContain("/icons/");
      expect(cat.icon).not.toContain("airtableusercontent.com");
    }
  });
});

describe("Icons", () => {
  it("GET /icons/Food returns a PNG image", async () => {
    const res = await fetch(`${API_URL}/icons/Food`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("image/");
    const cacheControl = res.headers.get("cache-control");
    expect(cacheControl).toContain("max-age=");
  });

  it("GET /icons/NonExistent returns 404", async () => {
    const res = await fetch(`${API_URL}/icons/NonExistentCategory12345`);
    expect(res.status).toBe(404);
  });
});

describe("API Root", () => {
  it("GET / returns HSDS 3.0 metadata", async () => {
    const res = await fetch(`${API_URL}/`);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.version).toBeDefined();
    expect(data.profile).toBeDefined();
  });
});
