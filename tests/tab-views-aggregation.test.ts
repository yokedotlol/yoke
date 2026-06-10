// tab_views write-amp fix: POST /api/track-tab now does a daily-aggregated
// (tab, day) UPSERT (mirroring endpoint_usage) instead of one INSERT per call,
// and getUsageStats reads the aggregate via SUM(views) GROUP BY tab.
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
import { getUsageStats } from "@worker/usage-tracking";

/**
 * In-memory D1 that models the daily-aggregated tab_views UPSERT and the
 * SUM(views) GROUP BY read, plus a permissive default for everything else
 * (rate-limit lookups, endpoint_usage ensureTable batch, etc.).
 */
function memoryD1(captured: { sql: string[] }) {
  const tab = new Map<string, number>(); // `${tab}|${day}` -> views

  function stmt(sql: string, binds: unknown[] = []): D1PreparedStatement {
    captured.sql.push(sql);
    const empty = {
      results: [] as unknown[],
      success: true,
      meta: { changes: 0, duration: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
    };
    return {
      bind: (...args: unknown[]) => stmt(sql, args),
      first: async () => null,
      all: async () => {
        if (sql.includes("FROM tab_views") && sql.includes("SUM(views)")) {
          const byTab = new Map<string, number>();
          for (const [key, v] of tab) {
            const t = key.split("|")[0];
            byTab.set(t, (byTab.get(t) ?? 0) + v);
          }
          return {
            results: [...byTab.entries()].map(([t, cnt]) => ({ tab: t, cnt })),
            success: true,
            meta: {},
          } as unknown as D1Result;
        }
        return empty as unknown as D1Result;
      },
      run: async () => {
        if (sql.startsWith("INSERT INTO tab_views")) {
          const [t, day] = binds as [string, string];
          tab.set(`${t}|${day}`, (tab.get(`${t}|${day}`) ?? 0) + 1); // UPSERT increment
        }
        return empty as unknown as D1Result;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement;
  }

  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      const out: D1Result[] = [];
      for (const s of stmts) out.push((await s.run()) as unknown as D1Result);
      return out;
    },
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
    _tab: tab,
  } as unknown as D1Database & { _tab: Map<string, number> };
}

function stubKV(): KVNamespace {
  return {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

function trackReq(tab: string): Request {
  return new Request("https://yoke.lol/api/track-tab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab }),
  });
}

describe("tab_views daily aggregation", () => {
  it("track-tab issues a (tab, day) UPSERT — not a per-event INSERT", async () => {
    const captured = { sql: [] as string[] };
    const db = memoryD1(captured);
    const env = { STATS_DB: db, REFERENCE_DATA: stubKV() } as Env;

    const resp = await worker.fetch(trackReq("dns"), env);
    expect(resp.status).toBe(200);

    const insertSql = captured.sql.find((s) => s.startsWith("INSERT INTO tab_views"));
    expect(insertSql).toBeDefined();
    expect(insertSql).toContain("(tab, day, views)");
    expect(insertSql).toContain("ON CONFLICT(tab, day) DO UPDATE SET views = views + 1");
    // Must NOT use the old per-event (tab, domain, ts) shape.
    expect(insertSql).not.toContain("ts");
    expect(insertSql).not.toContain("domain");
  });

  it("repeated clicks on the same tab/day aggregate into one row (no write-amp)", async () => {
    const captured = { sql: [] as string[] };
    const db = memoryD1(captured) as D1Database & { _tab: Map<string, number> };
    const env = { STATS_DB: db, REFERENCE_DATA: stubKV() } as Env;

    await worker.fetch(trackReq("ssl"), env);
    await worker.fetch(trackReq("ssl"), env);
    await worker.fetch(trackReq("ssl"), env);

    // One row, count 3 — not three rows.
    expect(db._tab.size).toBe(1);
    expect([...db._tab.values()][0]).toBe(3);
  });

  it("getUsageStats reads the aggregate via SUM(views) GROUP BY tab", async () => {
    const captured = { sql: [] as string[] };
    const db = memoryD1(captured) as D1Database & { _tab: Map<string, number> };
    const env = { STATS_DB: db, REFERENCE_DATA: stubKV() } as Env;

    await worker.fetch(trackReq("dns"), env);
    await worker.fetch(trackReq("dns"), env);
    await worker.fetch(trackReq("ssl"), env);

    const stats = await getUsageStats(db, 30);
    expect(stats.tab_views).toBeDefined();
    expect(stats.tab_views?.dns).toBe(2);
    expect(stats.tab_views?.ssl).toBe(1);

    const readSql = captured.sql.find((s) => s.includes("FROM tab_views"));
    expect(readSql).toContain("SUM(views)");
    expect(readSql).toContain("WHERE day >=");
  });

  it("returns 400 when tab is missing", async () => {
    const captured = { sql: [] as string[] };
    const db = memoryD1(captured);
    const env = { STATS_DB: db, REFERENCE_DATA: stubKV() } as Env;
    const resp = await worker.fetch(
      new Request("https://yoke.lol/api/track-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(resp.status).toBe(400);
  });
});
