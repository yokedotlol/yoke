// Demand-gated badge tests: cold-start is a pure read (no trigger, no seeding),
// and a very old badge serves a neutral "stale — re-scan" badge.
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

/** KV stub that records every get() key, with optional pre-seeded data. */
function recordingKV(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  const gets: string[] = [];
  const puts: string[] = [];
  const kv = {
    get: async (key: string) => {
      gets.push(key);
      return store.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      puts.push(key);
      store.set(key, value);
    },
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
  return { kv, gets, puts };
}

/** D1 stub that records every prepared SQL string. */
function recordingD1() {
  const queries: string[] = [];
  const result = {
    results: [],
    success: true,
    meta: { changes: 0, duration: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
  };
  const db = {
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
    batch: async () => [result],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
  return { db, queries };
}

function stubAssets(): { fetch: (request: Request) => Promise<Response> } {
  return { fetch: async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }) };
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

function req(path: string): Request {
  return new Request(`https://yoke.lol${path}`);
}

describe("Badge demand-gating", () => {
  it("cold start (no caches) is a pure read — no analysis trigger, no badge_domains seeding", async () => {
    const { kv, gets } = recordingKV(); // empty: badge miss + analysis miss
    const { db, queries } = recordingD1();
    const env = { STATS_DB: db, REFERENCE_DATA: kv, ASSETS: stubAssets(), BASE_URL: "https://yoke.lol" } as Env;

    const resp = await worker.fetch(req("/badge/never-seen.com.svg"), env);
    await new Promise((r) => setTimeout(r, 0)); // let any backgroundWork settle

    expect(resp.status).toBe(200);
    const svg = await resp.text();
    expect(svg).toContain("not yet scanned");

    // Must NOT seed badge_domains (no INSERT) and must NOT take the stampede lock.
    expect(queries.some((q) => q.includes("badge_domains"))).toBe(false);
    expect(gets.some((k) => k.startsWith("badge-pending:"))).toBe(false);
  });

  it("stale-decay: a badge older than BADGE_STALE_DAYS serves a neutral 'stale — re-scan'", async () => {
    const stale = makeBadgeEntry({ analyzedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString() });
    const { kv } = recordingKV({ "badge:old.com": JSON.stringify(stale) });
    const { db } = recordingD1();
    const env = {
      STATS_DB: db,
      REFERENCE_DATA: kv,
      ASSETS: stubAssets(),
      BASE_URL: "https://yoke.lol",
      BADGE_STALE_DAYS: "30",
    } as Env;

    const resp = await worker.fetch(req("/badge/old.com.json"), env);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.message).toBe("stale — re-scan");
    expect(data.color).toBe("lightgrey");
  });

  it("fresh badge still serves its score (no stale-decay, no refresh trigger)", async () => {
    const fresh = makeBadgeEntry();
    const { kv, gets } = recordingKV({ "badge:fresh.com": JSON.stringify(fresh) });
    const { db } = recordingD1();
    const env = {
      STATS_DB: db,
      REFERENCE_DATA: kv,
      ASSETS: stubAssets(),
      BASE_URL: "https://yoke.lol",
    } as Env;

    const resp = await worker.fetch(req("/badge/fresh.com.svg"), env);
    await new Promise((r) => setTimeout(r, 0));
    const svg = await resp.text();
    expect(svg).toContain("87 Strong");
    // Fresh (< 6h) → no refresh-on-view, so no stampede lock taken.
    expect(gets.some((k) => k.startsWith("badge-pending:"))).toBe(false);
  });
});
