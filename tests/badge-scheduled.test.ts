// Badge scheduled handler tests
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // biome-ignore lint/suspicious/noExplicitAny: polyfill for test environment
    (globalThis as any).crypto = webcrypto;
  }
});

import type { Env } from "@worker/helpers";
import { badgeSweep } from "@worker/scheduled";

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

/** D1 stub that returns configurable domain rows */
function stubD1WithDomains(domains: string[]): D1Database {
  const stubResult = {
    results: domains.map((d) => ({ domain: d })),
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
    batch: async () => [stubResult],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

/** D1 stub where badge_domains table doesn't exist */
function stubD1NoTable(): D1Database {
  const stubStatement = {
    bind: (..._args: unknown[]) => stubStatement,
    first: async () => {
      throw new Error("no such table: badge_domains");
    },
    all: async () => {
      throw new Error("no such table: badge_domains");
    },
    run: async () => {
      throw new Error("no such table: badge_domains");
    },
    raw: async () => {
      throw new Error("no such table: badge_domains");
    },
  } as unknown as D1PreparedStatement;

  return {
    prepare: (_query: string) => stubStatement,
    batch: async () => {
      throw new Error("no such table: badge_domains");
    },
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function freshBadgeEntry() {
  return JSON.stringify({
    composite: 87,
    tier: "Strong",
    axes: { sec: 91, spd: 78, fnd: 85, rep: 92, dsc: 88, eml: 95 },
    analyzedAt: new Date().toISOString(),
  });
}

describe("Badge Sweep", () => {
  it("handles empty badge_domains table with no errors", async () => {
    const env = {
      STATS_DB: stubD1WithDomains([]),
      REFERENCE_DATA: stubKV(),
    } as unknown as Env;

    const result = await badgeSweep(env);
    expect(result.checked).toBe(0);
    expect(result.refreshed).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("skips sweep when badge_domains table does not exist", async () => {
    const env = {
      STATS_DB: stubD1NoTable(),
      REFERENCE_DATA: stubKV(),
    } as unknown as Env;

    const result = await badgeSweep(env);
    expect(result.checked).toBe(0);
    expect(result.refreshed).toBe(0);
  });

  it("does not refresh domains with fresh badge cache", async () => {
    const env = {
      STATS_DB: stubD1WithDomains(["fresh.com"]),
      REFERENCE_DATA: stubKV({ "badge:fresh.com": freshBadgeEntry() }),
    } as unknown as Env;

    const result = await badgeSweep(env);
    expect(result.checked).toBe(1);
    expect(result.refreshed).toBe(0);
  });

  it("returns correct structure from sweep result", async () => {
    const env = {
      STATS_DB: stubD1WithDomains([]),
      REFERENCE_DATA: stubKV(),
    } as unknown as Env;

    const result = await badgeSweep(env);
    expect(result).toHaveProperty("checked");
    expect(result).toHaveProperty("refreshed");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("budget_exhausted");
    expect(result.budget_exhausted).toBe(false);
    expect(result.skipped).toBe(0);
  });

  it("handles missing STATS_DB gracefully", async () => {
    const env = {
      REFERENCE_DATA: stubKV(),
    } as unknown as Env;

    const result = await badgeSweep(env);
    expect(result.checked).toBe(0);
  });

  it("handles missing REFERENCE_DATA gracefully", async () => {
    const env = {
      STATS_DB: stubD1WithDomains(["test.com"]),
    } as unknown as Env;

    const result = await badgeSweep(env);
    expect(result.checked).toBe(0);
  });
});
