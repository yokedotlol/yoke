// daily_counters flush/read tests — verifies UPSERT semantics + retention prune.

import type { BudgetStats } from "@worker/analysis-budget-do";
import {
  cleanupPrivacyResidue,
  flushBudgetCounters,
  flushEndpointCounters,
  pruneOldRows,
  readDailyCounter,
} from "@worker/daily-counters";
import type { Env } from "@worker/helpers";
import { describe, expect, it } from "vitest";

/**
 * In-memory D1 stub implementing just enough of the daily_counters /
 * endpoint_usage UPSERT + SELECT to assert behavior. daily_counters is keyed by
 * (metric, day); endpoint_usage by (endpoint, day). `endpointUsage` is exposed
 * so tests can assert SET (not increment) semantics across flushes.
 */
function memoryD1(captured?: {
  deletes: string[];
  updates?: string[];
  creates?: string[];
}): D1Database & { endpointUsage: Map<string, number>; droppedTables: Set<string> } {
  const table = new Map<string, number>(); // `${metric}|${day}` -> value
  const endpointUsage = new Map<string, number>(); // `${endpoint}|${day}` -> hits
  const droppedTables = new Set<string>();

  function makeStmt(sql: string, binds: unknown[] = []): D1PreparedStatement {
    return {
      bind: (...args: unknown[]) => makeStmt(sql, args),
      first: async <T = unknown>() => {
        if (sql.includes("SELECT value FROM daily_counters")) {
          const [metric, day] = binds as [string, string];
          const v = table.get(`${metric}|${day}`);
          return (v === undefined ? null : ({ value: v } as unknown)) as T;
        }
        return null as unknown as T;
      },
      run: async () => {
        if (sql.startsWith("INSERT INTO daily_counters")) {
          const [metric, day, value] = binds as [string, string, number];
          table.set(`${metric}|${day}`, value); // ON CONFLICT DO UPDATE SET = value
        } else if (sql.startsWith("INSERT INTO endpoint_usage")) {
          const [endpoint, day, hits] = binds as [string, string, number];
          endpointUsage.set(`${endpoint}|${day}`, hits); // ON CONFLICT DO UPDATE SET = excluded.hits
        } else if (sql.startsWith("DELETE FROM")) {
          captured?.deletes.push(sql);
        } else if (sql.startsWith("DROP TABLE IF EXISTS")) {
          droppedTables.add(sql.replace("DROP TABLE IF EXISTS ", ""));
        } else if (sql.startsWith("UPDATE")) {
          captured?.updates?.push(sql);
        } else if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
          captured?.creates?.push(sql);
        }
        return {
          results: [],
          success: true,
          meta: { changes: 0, duration: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
        } as unknown as D1Result;
      },
      all: async () => {
        if (sql.includes("PRAGMA table_info(tab_views)")) {
          return {
            results: [{ name: "id" }, { name: "tab" }, { name: "domain" }, { name: "ts" }],
            success: true,
            meta: {},
          } as unknown as D1Result;
        }
        return { results: [], success: true, meta: {} } as unknown as D1Result;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement;
  }

  return {
    prepare: (sql: string) => makeStmt(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      const out: D1Result[] = [];
      for (const s of stmts) out.push((await s.run()) as unknown as D1Result);
      return out;
    },
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
    endpointUsage,
    droppedTables,
  } as unknown as D1Database & { endpointUsage: Map<string, number>; droppedTables: Set<string> };
}

function makeStats(overrides: Partial<BudgetStats> = {}): BudgetStats {
  return {
    day: "2026-06-10",
    count: 7,
    limit: 3000,
    breakdown: { curl: 3, analyze: 2, compare: 1, badge: 1, other: 0 },
    metrics: { whoisfreaks_calls: 4, pagespeed_calls: 6, cache_hits: 20, cache_misses: 5 },
    ...overrides,
  };
}

describe("daily_counters", () => {
  it("flushes budget totals via UPSERT and reads them back", async () => {
    const db = memoryD1();
    await flushBudgetCounters(db, makeStats());

    expect(await readDailyCounter(db, "analyses_total", "2026-06-10")).toBe(7);
    expect(await readDailyCounter(db, "analyses_curl", "2026-06-10")).toBe(3);
    expect(await readDailyCounter(db, "analyses_analyze", "2026-06-10")).toBe(2);
    expect(await readDailyCounter(db, "analyses_compare", "2026-06-10")).toBe(1);
    expect(await readDailyCounter(db, "analyses_badge", "2026-06-10")).toBe(1);
    expect(await readDailyCounter(db, "badge_refreshes", "2026-06-10")).toBe(1);
  });

  it("flushes auxiliary cost metrics (paid-API counts + cache hits/misses)", async () => {
    const db = memoryD1();
    await flushBudgetCounters(db, makeStats());

    expect(await readDailyCounter(db, "whoisfreaks_calls", "2026-06-10")).toBe(4);
    expect(await readDailyCounter(db, "pagespeed_calls", "2026-06-10")).toBe(6);
    expect(await readDailyCounter(db, "cache_hits", "2026-06-10")).toBe(20);
    expect(await readDailyCounter(db, "cache_misses", "2026-06-10")).toBe(5);
  });

  it("flushes safely when an older DO omits the metrics field", async () => {
    const db = memoryD1();
    const legacy = makeStats();
    // Simulate a stats payload from a DO that predates the metrics field.
    (legacy as { metrics?: unknown }).metrics = undefined;
    await flushBudgetCounters(db, legacy);

    expect(await readDailyCounter(db, "analyses_total", "2026-06-10")).toBe(7);
    expect(await readDailyCounter(db, "whoisfreaks_calls", "2026-06-10")).toBe(0);
  });

  it("UPSERT is idempotent — re-flush SETs (does not increment) the cumulative total", async () => {
    const db = memoryD1();
    await flushBudgetCounters(db, makeStats({ count: 7 }));
    // Hourly cron runs again later with a higher cumulative total.
    await flushBudgetCounters(
      db,
      makeStats({ count: 12, breakdown: { curl: 5, analyze: 4, compare: 2, badge: 1, other: 0 } }),
    );

    // Value reflects the latest cumulative total, NOT 7 + 12.
    expect(await readDailyCounter(db, "analyses_total", "2026-06-10")).toBe(12);
    expect(await readDailyCounter(db, "analyses_curl", "2026-06-10")).toBe(5);
  });

  it("readDailyCounter returns 0 for an absent metric", async () => {
    const db = memoryD1();
    expect(await readDailyCounter(db, "analyses_total", "1999-01-01")).toBe(0);
  });

  it("flushes per-endpoint counts into endpoint_usage", async () => {
    const db = memoryD1();
    await flushEndpointCounters(db, "2026-06-10", { analyze: 5, compare: 2, news: 1 });

    expect(db.endpointUsage.get("analyze|2026-06-10")).toBe(5);
    expect(db.endpointUsage.get("compare|2026-06-10")).toBe(2);
    expect(db.endpointUsage.get("news|2026-06-10")).toBe(1);
  });

  it("endpoint flush is idempotent — two consecutive flushes do NOT double-count", async () => {
    const db = memoryD1();
    // First hourly flush: DO cumulative day total so far.
    await flushEndpointCounters(db, "2026-06-10", { analyze: 5, compare: 2 });
    // Second flush later in the day: DO total has grown. Because the DO holds
    // cumulative totals and we SET (not add), the row reflects the latest total,
    // NOT 5 + 8. This is the key no-double-count guarantee.
    await flushEndpointCounters(db, "2026-06-10", { analyze: 8, compare: 3 });

    expect(db.endpointUsage.get("analyze|2026-06-10")).toBe(8);
    expect(db.endpointUsage.get("compare|2026-06-10")).toBe(3);
  });

  it("endpoint flush is a no-op for empty/zero/undefined inputs", async () => {
    const db = memoryD1();
    await flushEndpointCounters(db, "2026-06-10", {});
    await flushEndpointCounters(db, "2026-06-10", { analyze: 0 });
    await flushEndpointCounters(db, "2026-06-10", undefined);
    await flushEndpointCounters(undefined, "2026-06-10", { analyze: 5 });
    expect(db.endpointUsage.size).toBe(0);
  });

  it("pruneOldRows deletes request_meta past the retention window", async () => {
    const captured = { deletes: [] as string[], updates: [] as string[], creates: [] as string[] };
    const env = { STATS_DB: memoryD1(captured), REQUEST_META_RETENTION_DAYS: "90" } as unknown as Env;
    await pruneOldRows(env);
    expect(captured.deletes.some((s) => s.includes("DELETE FROM request_meta"))).toBe(true);
    expect(captured.deletes.some((s) => s.includes("DELETE FROM endpoint_rate_limits"))).toBe(true);
  });

  it("privacy cleanup purges old target-bearing operational tables and reshapes tab_views", async () => {
    const captured = { deletes: [] as string[], updates: [] as string[], creates: [] as string[] };
    const db = memoryD1(captured);
    const deletedKeys: string[] = [];
    const env = {
      STATS_DB: db,
      REFERENCE_DATA: { delete: async (key: string) => deletedKeys.push(key) } as unknown as KVNamespace,
    } as unknown as Env;

    await cleanupPrivacyResidue(env);

    expect(deletedKeys).toEqual(expect.arrayContaining(["recent:index", "showcase:index"]));
    expect(db.droppedTables.has("domain_lookups")).toBe(true);
    expect(captured.updates).toEqual(
      expect.arrayContaining([
        "UPDATE api_errors SET domain = NULL WHERE domain IS NOT NULL",
        "UPDATE request_meta SET domain = NULL WHERE domain IS NOT NULL",
      ]),
    );
    expect(captured.creates.some((s) => s.includes("CREATE TABLE IF NOT EXISTS tab_views"))).toBe(true);
  });
});
