// Badge cert-expiry STALENESS tests.
//
// Cert expiry is a staleness trigger, NOT a verdict: a cached badge whose SSL
// cert notAfter is in the past demotes to the neutral "stale — re-scan"
// rendering (never "expired"), and triggers a gated refresh when eligible.
// A future notAfter behaves normally, and a badge with no cert field at all is
// unchanged (backward compatibility with pre-field cached badges).
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

/** KV stub that records every get()/put() key, with optional pre-seeded data. */
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
    // analyzedAt recent so age-decay & refresh-on-view don't fire on their own.
    analyzedAt: new Date().toISOString(),
    ...overrides,
  };
}

function req(path: string): Request {
  return new Request(`https://yoke.lol${path}`);
}

function envWith(kv: KVNamespace, db: D1Database, extra: Partial<Env> = {}): Env {
  return {
    STATS_DB: db,
    REFERENCE_DATA: kv,
    ASSETS: stubAssets(),
    BASE_URL: "https://yoke.lol",
    ...extra,
  } as Env;
}

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // yesterday
const FUTURE = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(); // +60d

describe("Badge cert-expiry staleness", () => {
  it("(a) past cert notAfter demotes a fresh badge to neutral 'stale — re-scan' (no score)", async () => {
    const entry = makeBadgeEntry({ certNotAfter: PAST });
    const { kv } = recordingKV({ "badge:expired-cert.com": JSON.stringify(entry) });
    const { db } = recordingD1();
    const env = envWith(kv, db);

    const json = await worker.fetch(req("/badge/expired-cert.com.json"), env);
    const data = await json.json();
    expect(data.message).toBe("stale — re-scan");
    expect(data.color).toBe("lightgrey");
    // Must NOT surface the real score.
    expect(data.message).not.toContain("87");

    const svgResp = await worker.fetch(req("/badge/expired-cert.com.svg"), envWith(kv, db));
    const svg = await svgResp.text();
    expect(svg).toContain("stale — re-scan");
    expect(svg).not.toContain("87 Strong");
  });

  it("(a) past cert notAfter triggers a gated refresh when the badge is past the refresh interval", async () => {
    // analyzedAt older than the default 6h refresh interval → refresh eligible.
    const old = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const entry = makeBadgeEntry({ analyzedAt: old, certNotAfter: PAST });
    const { kv, gets } = recordingKV({ "badge:refresh-me.com": JSON.stringify(entry) });
    const { db } = recordingD1();
    const env = envWith(kv, db, { _ctx: { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext });

    const resp = await worker.fetch(req("/badge/refresh-me.com.svg"), env);
    await new Promise((r) => setTimeout(r, 0));
    const svg = await resp.text();
    expect(svg).toContain("stale — re-scan");
    // A gated refresh takes the stampede lock (badge-pending:<domain>).
    expect(gets.some((k) => k.startsWith("badge-pending:"))).toBe(true);
  });

  it("(a) does NOT trigger a refresh when the badge is still within the refresh interval", async () => {
    const entry = makeBadgeEntry({ certNotAfter: PAST }); // analyzedAt = now → fresh
    const { kv, gets } = recordingKV({ "badge:fresh-but-expired-cert.com": JSON.stringify(entry) });
    const { db } = recordingD1();
    const env = envWith(kv, db);

    const resp = await worker.fetch(req("/badge/fresh-but-expired-cert.com.svg"), env);
    await new Promise((r) => setTimeout(r, 0));
    const svg = await resp.text();
    expect(svg).toContain("stale — re-scan"); // still demoted
    expect(gets.some((k) => k.startsWith("badge-pending:"))).toBe(false); // but no refresh taken
  });

  it("(b) future cert notAfter serves the normal scored badge", async () => {
    const entry = makeBadgeEntry({ certNotAfter: FUTURE });
    const { kv } = recordingKV({ "badge:good-cert.com": JSON.stringify(entry) });
    const { db } = recordingD1();
    const env = envWith(kv, db);

    const json = await worker.fetch(req("/badge/good-cert.com.json"), env);
    const data = await json.json();
    expect(data.message).toBe("87 Strong");

    const svgResp = await worker.fetch(req("/badge/good-cert.com.svg"), envWith(kv, db));
    const svg = await svgResp.text();
    expect(svg).toContain("87 Strong");
  });

  it("(c) badge with no cert field is unchanged (backward compatible) — scored", async () => {
    const entry = makeBadgeEntry(); // no certNotAfter
    expect((entry as BadgeCacheEntry).certNotAfter).toBeUndefined();
    const { kv, gets } = recordingKV({ "badge:legacy.com": JSON.stringify(entry) });
    const { db } = recordingD1();
    const env = envWith(kv, db);

    const json = await worker.fetch(req("/badge/legacy.com.json"), env);
    const data = await json.json();
    expect(data.message).toBe("87 Strong");
    // No cert check → no spurious refresh.
    await new Promise((r) => setTimeout(r, 0));
    expect(gets.some((k) => k.startsWith("badge-pending:"))).toBe(false);
  });

  it("unparseable cert notAfter is ignored (no opinion) — scored", async () => {
    const entry = makeBadgeEntry({ certNotAfter: "not-a-date" });
    const { kv } = recordingKV({ "badge:junk-cert.com": JSON.stringify(entry) });
    const { db } = recordingD1();
    const env = envWith(kv, db);

    const json = await worker.fetch(req("/badge/junk-cert.com.json"), env);
    const data = await json.json();
    expect(data.message).toBe("87 Strong");
  });
});
