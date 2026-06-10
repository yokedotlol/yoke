// GET /{domain} (curl/JSON content-negotiation path) rate-limit tests.
// Verifies the curl API shares the /api/analyze bucket and returns the same
// 429 JSON shape when over-limit, without running an analysis.
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // biome-ignore lint/suspicious/noExplicitAny: polyfill for test environment
    (globalThis as any).crypto = webcrypto;
  }
});

import type { Env } from "@worker/helpers";
import worker from "@worker/index";

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

/** A minimal fresh analysis-cache envelope so runAnalysis returns a cache HIT. */
function freshAnalysisCache(domain: string): Record<string, string> {
  const data = {
    domain,
    analyzed_at: new Date().toISOString(),
    cached: false,
    domain_score: { composite: 80, tier: "Strong", axes: {} },
  };
  return { [`cache:analysis:${domain}`]: JSON.stringify({ data, cached_at: Date.now() }) };
}

function stubD1(): D1Database {
  const result = {
    results: [],
    success: true,
    meta: { changes: 0, duration: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
  };
  const stmt = {
    bind: () => stmt,
    first: async () => null,
    all: async () => result,
    run: async () => result,
    raw: async () => [],
  } as unknown as D1PreparedStatement;
  return {
    prepare: () => stmt,
    batch: async () => [result, result],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function stubAssets(): { fetch: (request: Request) => Promise<Response> } {
  return { fetch: async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }) };
}

/**
 * Stub RATE_LIMITER DO namespace. The shared limiter does a dry-run /check then
 * records on a separate call. Records every endpoint seen so we can assert the
 * curl path uses the "/api/analyze" bucket. When `block` is true, /check
 * reports over-limit.
 */
function stubRateLimiter(opts: { block: boolean; seen: string[] }): DurableObjectNamespace {
  const stub = {
    fetch: async (request: Request) => {
      const body = (await request.json()) as { endpoint: string };
      opts.seen.push(body.endpoint);
      const resetAt = Math.floor(Date.now() / 1000) + 3600;
      const payload = opts.block
        ? { allowed: false, limit: 20, remaining: 0, resetAt }
        : { allowed: true, limit: 20, remaining: 19, resetAt };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    },
  };
  return {
    idFromName: (_name: string) => ({ name: _name }) as unknown as DurableObjectId,
    get: (_id: DurableObjectId) => stub as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

function curlReq(path: string): Request {
  return new Request(`https://yoke.lol${path}`, {
    headers: { Accept: "application/json", "User-Agent": "curl/8.0", "cf-connecting-ip": "203.0.113.7" },
  });
}

describe("GET /{domain} curl/JSON rate limiting", () => {
  it("returns 429 with the /api/analyze JSON shape when over-limit", async () => {
    const seen: string[] = [];
    const env = {
      STATS_DB: stubD1(),
      REFERENCE_DATA: stubKV(),
      ASSETS: stubAssets(),
      BASE_URL: "https://yoke.lol",
      RATE_LIMITER: stubRateLimiter({ block: true, seen }),
    } as unknown as Env;

    const resp = await worker.fetch(curlReq("/stripe.com"), env);
    expect(resp.status).toBe(429);
    const data = await resp.json();
    expect(data.code).toBe("RATE_LIMITED");
    expect(data.limit).toBe(20);

    // Shares the /api/analyze bucket (prevents a GET+POST 2x bypass).
    expect(seen).toContain("/api/analyze");
  });

  it("admin key bypasses the curl rate limit (no DO check)", async () => {
    const seen: string[] = [];
    const env = {
      STATS_DB: stubD1(),
      // Seed a fresh analysis cache so the bypassed path returns a cache HIT
      // instead of making real network calls.
      REFERENCE_DATA: stubKV(freshAnalysisCache("stripe.com")),
      ASSETS: stubAssets(),
      BASE_URL: "https://yoke.lol",
      ADMIN_KEY: "s3cret",
      RATE_LIMITER: stubRateLimiter({ block: true, seen }),
    } as unknown as Env;

    const req = new Request("https://yoke.lol/stripe.com", {
      headers: {
        Accept: "application/json",
        "User-Agent": "curl/8.0",
        "X-Admin-Key": "s3cret",
        "cf-connecting-ip": "203.0.113.7",
      },
    });
    const resp = await worker.fetch(req, env);
    // Not a 429 — admin bypassed the limiter entirely (no /check call).
    expect(resp.status).not.toBe(429);
    expect(seen).not.toContain("/api/analyze");
  });
});
