// Badge route integration tests
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // biome-ignore lint/suspicious/noExplicitAny: polyfill for test environment
    (globalThis as any).crypto = webcrypto;
  }
});

import type { BadgeCacheEntry } from "@worker/badge-cache";
import type { Env } from "@worker/helpers";
import worker from "@worker/index";

/** Stub KV with optional pre-seeded data */
function stubKV(data: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(data));
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

function stubD1(): D1Database {
  const stubResult = {
    results: [],
    success: true,
    meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 },
  };
  const stubStatement = {
    bind: (..._args: unknown[]) => stubStatement,
    first: async () => null,
    all: async () => stubResult,
    run: async () => stubResult,
    raw: async () => [],
  } as unknown as D1PreparedStatement;

  return {
    prepare: (_query: string) => stubStatement,
    batch: async (_stmts: D1PreparedStatement[]) => [stubResult, stubResult],
    exec: async (_query: string) => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function stubAssets(): { fetch: (request: Request) => Promise<Response> } {
  return {
    fetch: async () =>
      new Response("<!doctype html><html><head></head><body></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  };
}

function makeBadgeEntry(overrides: Partial<BadgeCacheEntry> = {}): BadgeCacheEntry {
  return {
    composite: 87,
    tier: "Strong",
    axes: { sec: 91, spd: 78, fnd: 85, rep: 92, dsc: 88, eml: 95 },
    analyzedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockEnv(kvData: Record<string, string> = {}, overrides: Partial<Env> = {}): Env {
  return {
    STATS_DB: stubD1(),
    REFERENCE_DATA: stubKV(kvData),
    ASSETS: stubAssets(),
    BASE_URL: "https://yoke.lol",
    ...overrides,
  } as Env;
}

function req(path: string, options: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(`https://yoke.lol${path}`, options);
}

describe("Badge Routes", () => {
  describe("SVG endpoint", () => {
    it("returns valid SVG with correct Content-Type on cache hit", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.svg"), env);

      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toBe("image/svg+xml");

      const svg = await resp.text();
      expect(svg).toContain("<svg");
      expect(svg).toContain("87 Strong");
      expect(svg).toContain("Yoke");
    });

    it("returns neutral badge on cache miss", async () => {
      const env = mockEnv();
      const resp = await worker.fetch(req("/badge/unknown.com.svg"), env);

      expect(resp.status).toBe(200);
      const svg = await resp.text();
      expect(svg).toContain("not yet scanned");
    });

    it("sets long scored Cache-Control and CORS headers on a scored badge", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.svg"), env);

      expect(resp.headers.get("Cache-Control")).toBe(
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      );
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(resp.headers.get("X-Yoke-Version")).toBeTruthy();
    });

    it("sets short Cache-Control on a cold/neutral (not yet scanned) badge", async () => {
      const env = mockEnv();
      const resp = await worker.fetch(req("/badge/unknown.com.svg"), env);

      expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
      expect(resp.headers.get("ETag")).toBeNull();
    });

    it("sets ETag on cache hit", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.svg"), env);

      expect(resp.headers.get("ETag")).toBeTruthy();
    });

    it("supports ?style=flat-square", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.svg?style=flat-square"), env);

      const svg = await resp.text();
      expect(svg).toContain("crispEdges");
      expect(svg).not.toContain("linearGradient");
    });

    it("supports ?label=Custom", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.svg?label=MyLabel"), env);

      const svg = await resp.text();
      expect(svg).toContain("MyLabel");
    });

    it("supports ?axis=security", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.svg?axis=security"), env);

      const svg = await resp.text();
      expect(svg).toContain("91");
      expect(svg).toContain("Security");
    });
  });

  describe("JSON endpoint", () => {
    it("returns shields.io protocol format on cache hit", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.json"), env);

      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toBe("application/json");

      const data = await resp.json();
      expect(data.schemaVersion).toBe(1);
      expect(data.label).toBe("Yoke");
      expect(data.message).toBe("87 Strong");
      expect(data.color).toBe("green");
    });

    it("returns neutral JSON on cache miss", async () => {
      const env = mockEnv();
      const resp = await worker.fetch(req("/badge/unknown.com.json"), env);

      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data.message).toBe("not yet scanned");
      expect(data.color).toBe("lightgrey");
    });

    it("sets CORS headers", async () => {
      const env = mockEnv();
      const resp = await worker.fetch(req("/badge/stripe.com.json"), env);
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("sets long scored Cache-Control on a scored JSON badge", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) });
      const resp = await worker.fetch(req("/badge/stripe.com.json"), env);
      expect(resp.headers.get("Cache-Control")).toBe(
        "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      );
    });

    it("sets short Cache-Control on a cold/neutral JSON badge", async () => {
      const env = mockEnv();
      const resp = await worker.fetch(req("/badge/unknown.com.json"), env);
      expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60");
    });
  });

  describe("badge_domains tracking", () => {
    it("records the domain with INSERT OR IGNORE and no per-hit UPDATE", async () => {
      const queries: string[] = [];
      // Capturing D1 stub: record every prepared SQL string.
      const result = {
        results: [],
        success: true,
        meta: {
          duration: 0,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 0,
          rows_written: 0,
        },
      };
      const capturingDb = {
        prepare: (query: string) => {
          queries.push(query);
          const stmt = {
            bind: () => stmt,
            first: async () => null,
            all: async () => result,
            run: async () => result,
            raw: async () => [],
          };
          return stmt as unknown as D1PreparedStatement;
        },
        exec: async () => ({ count: 0, duration: 0 }),
        batch: async () => [result],
        dump: async () => new ArrayBuffer(0),
      } as unknown as D1Database;

      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) }, { STATS_DB: capturingDb });
      await worker.fetch(req("/badge/stripe.com.svg"), env);

      // Allow the non-blocking backgroundWork promise to settle.
      await new Promise((r) => setTimeout(r, 0));

      const trackQuery = queries.find((q) => q.includes("badge_domains"));
      expect(trackQuery).toBeTruthy();
      expect(trackQuery).toContain("INSERT OR IGNORE INTO badge_domains");
      expect(trackQuery).not.toContain("ON CONFLICT");
      expect(trackQuery).not.toContain("request_count + 1");
    });
  });

  describe("invalid requests", () => {
    it("returns 400 for invalid domain", async () => {
      const env = mockEnv();
      const resp = await worker.fetch(req("/badge/.svg"), env);
      expect(resp.status).toBe(400);
    });

    it("does not match non-.svg/.json extensions", async () => {
      const env = mockEnv();
      const resp = await worker.fetch(req("/badge/stripe.com.png"), env);
      // Should fall through to SPA/404
      expect(resp.status).not.toBe(400);
    });
  });

  describe("stale cache (>20h)", () => {
    it("still returns badge data (does not block)", async () => {
      const staleEntry = makeBadgeEntry({
        analyzedAt: new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString(),
      });
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(staleEntry) });
      const resp = await worker.fetch(req("/badge/stripe.com.svg"), env);

      expect(resp.status).toBe(200);
      const svg = await resp.text();
      expect(svg).toContain("87 Strong");
    });
  });

  describe("white-label", () => {
    it("uses SITE_NAME for badge label", async () => {
      const entry = makeBadgeEntry();
      const env = mockEnv({ "badge:stripe.com": JSON.stringify(entry) }, { SITE_NAME: "MySite" } as Partial<Env>);
      const resp = await worker.fetch(req("/badge/stripe.com.svg"), env);

      const svg = await resp.text();
      expect(svg).toContain("MySite");
      expect(svg).not.toContain("Yoke");
    });
  });
});
