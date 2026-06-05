// HTTP routing integration tests — exercises the worker's fetch handler directly
// with mock Env bindings (no real network calls).
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

// Polyfill crypto.subtle for Node.js (Cloudflare Workers have it natively)
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // biome-ignore lint/suspicious/noExplicitAny: polyfill for test environment
    (globalThis as any).crypto = webcrypto;
  }
});

import type { Env } from "@worker/helpers";
// Import the worker's default export (the fetch handler)
import worker from "@worker/index";

// ─── Mock Env ───────────────────────────────────────────────────────

/** Stub KV namespace — all reads return null, writes are no-ops */
function stubKV(): KVNamespace {
  return {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

/** Stub D1 database — queries resolve with empty results */
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

/** Stub ASSETS binding — returns 404 for all fetches */
function stubAssets(): { fetch: (request: Request) => Promise<Response> } {
  return {
    fetch: async (_request: Request) =>
      new Response("<!doctype html><html><head></head><body></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
  };
}

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    STATS_DB: stubD1(),
    REFERENCE_DATA: stubKV(),
    ASSETS: stubAssets(),
    BASE_URL: "https://yoke.lol",
    ...overrides,
  } as Env;
}

function req(path: string, options: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(`https://yoke.lol${path}`, options);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("HTTP routing integration", () => {
  // ── Static routes ──

  describe("static routes", () => {
    it("GET /robots.txt returns 200 with correct content", async () => {
      const resp = await worker.fetch(req("/robots.txt"), mockEnv());
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("User-agent: *");
      expect(text).toContain("Disallow: /api/");
      expect(text).toContain("Sitemap:");
    });

    it("GET /sitemap.xml returns 200 with XML content", async () => {
      const resp = await worker.fetch(req("/sitemap.xml"), mockEnv());
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain('<?xml version="1.0"');
      expect(text).toContain("<urlset");
      expect(resp.headers.get("Content-Type")).toContain("application/xml");
    });

    it("GET /llms.txt returns 200 with LLM-friendly content", async () => {
      const resp = await worker.fetch(req("/llms.txt"), mockEnv());
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("Domain Intelligence");
      expect(text).toContain("## Key Capabilities");
      expect(resp.headers.get("Content-Type")).toContain("text/plain");
    });

    it("GET /status returns 200", async () => {
      const resp = await worker.fetch(req("/status"), mockEnv());
      expect(resp.status).toBe(200);
    });

    it("GET /manifest.json returns valid JSON", async () => {
      const resp = await worker.fetch(req("/manifest.json"), mockEnv());
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("start_url", "/");
      expect(data).toHaveProperty("display", "standalone");
      expect(resp.headers.get("Content-Type")).toContain("application/manifest+json");
    });

    it("GET /security.txt returns 200", async () => {
      const resp = await worker.fetch(req("/security.txt"), mockEnv());
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("Contact:");
      expect(text).toContain("Expires:");
    });

    it("GET /.well-known/security.txt returns same content as /security.txt", async () => {
      const resp = await worker.fetch(req("/.well-known/security.txt"), mockEnv());
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("Contact:");
    });
  });

  // ── CORS ──

  describe("CORS preflight", () => {
    it("OPTIONS on any path returns 204 with CORS headers", async () => {
      const resp = await worker.fetch(req("/api/analyze", { method: "OPTIONS" }), mockEnv());
      expect(resp.status).toBe(204);
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(resp.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
    });

    it("OPTIONS on root returns 204", async () => {
      const resp = await worker.fetch(req("/", { method: "OPTIONS" }), mockEnv());
      expect(resp.status).toBe(204);
    });
  });

  // ── HEAD conversion ──

  describe("HEAD conversion", () => {
    it("HEAD /robots.txt returns same status as GET but empty body", async () => {
      const env = mockEnv();
      const getResp = await worker.fetch(req("/robots.txt"), env);
      const headResp = await worker.fetch(req("/robots.txt", { method: "HEAD" }), env);
      expect(headResp.status).toBe(getResp.status);
      const body = await headResp.text();
      expect(body).toBe("");
    });

    it("HEAD preserves content-type header from GET", async () => {
      const env = mockEnv();
      const getResp = await worker.fetch(req("/robots.txt"), env);
      const headResp = await worker.fetch(req("/robots.txt", { method: "HEAD" }), env);
      expect(headResp.headers.get("Content-Type")).toBe(getResp.headers.get("Content-Type"));
    });
  });

  // ── API routing ──

  describe("API routing", () => {
    it("POST /api/analyze with invalid domain format returns 400", async () => {
      const resp = await worker.fetch(
        req("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: "not a valid domain!!!" }),
        }),
        mockEnv(),
      );
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data).toHaveProperty("code", "INVALID_DOMAIN");
    });

    it("POST /api/analyze without domain returns 400", async () => {
      const resp = await worker.fetch(
        req("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        mockEnv(),
      );
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data).toHaveProperty("code", "MISSING_DOMAIN");
    });

    it("POST /api/compare without domains returns 400", async () => {
      const resp = await worker.fetch(
        req("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        mockEnv(),
      );
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data).toHaveProperty("code", "MISSING_DOMAIN");
    });

    it("POST /api/suggestions without domain returns 400", async () => {
      const resp = await worker.fetch(
        req("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        mockEnv(),
      );
      expect(resp.status).toBe(400);
    });
  });

  // ── 404 handling ──

  describe("404 handling", () => {
    it("GET /api/nonexistent returns 404", async () => {
      const resp = await worker.fetch(req("/api/nonexistent"), mockEnv());
      expect(resp.status).toBe(404);
      const data = await resp.json();
      expect(data).toHaveProperty("code", "NOT_FOUND");
    });

    it("POST /api/nonexistent returns 404", async () => {
      const resp = await worker.fetch(
        req("/api/nonexistent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
        mockEnv(),
      );
      expect(resp.status).toBe(404);
    });
  });

  // ── Admin routes ──

  describe("admin routes", () => {
    it("GET /api/health returns 200 with status", async () => {
      const resp = await worker.fetch(req("/api/health"), mockEnv());
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty("status", "ok");
    });

    it("GET /api/stats without D1 returns 501", async () => {
      const env = mockEnv({ STATS_DB: undefined as unknown as D1Database });
      const resp = await worker.fetch(req("/api/stats"), env);
      expect(resp.status).toBe(501);
    });

    it("GET /api/stats with D1 returns stats data", async () => {
      const resp = await worker.fetch(req("/api/stats"), mockEnv());
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty("total_scans");
      expect(data).toHaveProperty("updated_at");
    });

    it("GET /api/scoring returns scoring methodology", async () => {
      const resp = await worker.fetch(req("/api/scoring"), mockEnv());
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty("axis_weights");
      expect(data).toHaveProperty("tier_thresholds");
    });

    it("GET /api/cleanup without auth returns 401", async () => {
      const resp = await worker.fetch(req("/api/cleanup"), mockEnv({ ADMIN_KEY: "secret123" }));
      expect(resp.status).toBe(401);
    });

    it("GET /api/docs returns JSON for API clients", async () => {
      const resp = await worker.fetch(req("/api/docs", { headers: { Accept: "application/json" } }), mockEnv());
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty("endpoints");
    });

    it("GET /api/docs returns HTML for browsers", async () => {
      const resp = await worker.fetch(req("/api/docs", { headers: { Accept: "text/html" } }), mockEnv());
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toContain("text/html");
    });
  });

  // ── Domain page routing ──

  describe("domain page routing", () => {
    it("GET /example.com with browser Accept returns HTML (SPA shell)", async () => {
      const resp = await worker.fetch(
        req("/example.com", {
          headers: { Accept: "text/html,application/xhtml+xml" },
        }),
        mockEnv(),
      );
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toContain("text/html");
    });

    it("DELETE on domain path returns 405", async () => {
      const resp = await worker.fetch(req("/example.com", { method: "DELETE" }), mockEnv());
      expect(resp.status).toBe(405);
    });
  });

  // ── Malformed request body ──

  describe("malformed request body", () => {
    it("POST /api/analyze with invalid JSON returns 400", async () => {
      const resp = await worker.fetch(
        req("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        }),
        mockEnv(),
      );
      expect(resp.status).toBe(400);
      const data = await resp.json();
      expect(data).toHaveProperty("code", "BAD_REQUEST");
    });
  });

  // ── MTA-STS ──

  describe("MTA-STS", () => {
    it("serves MTA-STS policy on mta-sts.yoke.lol", async () => {
      const resp = await worker.fetch(new Request("https://mta-sts.yoke.lol/.well-known/mta-sts.txt"), mockEnv());
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain("version: STSv1");
      expect(text).toContain("mode: enforce");
    });
  });
});
