// daily_counters flush/read tests — verifies UPSERT semantics + retention prune.

import type { BudgetStats } from "@worker/analysis-budget-do";
import { flushBudgetCounters, pruneOldRows, readDailyCounter } from "@worker/daily-counters";
import type { Env } from "@worker/helpers";
import { describe, expect, it } from "vitest";

/**
 * In-memory D1 stub implementing just enough of the daily_counters UPSERT and
 * SELECT to assert behavior. Keyed by (metric, day).
 */
function memoryD1(captured?: { deletes: string[] }): D1Database {
  const table = new Map<string, number>(); // `${metric}|${day}` -> value

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
        } else if (sql.startsWith("DELETE FROM")) {
          captured?.deletes.push(sql);
        }
        return {
          results: [],
          success: true,
          meta: { changes: 0, duration: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
        } as unknown as D1Result;
      },
      all: async () => ({ results: [], success: true, meta: {} }) as unknown as D1Result,
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
  } as unknown as D1Database;
}

function makeStats(overrides: Partial<BudgetStats> = {}): BudgetStats {
  return {
    day: "2026-06-10",
    count: 7,
    limit: 3000,
    breakdown: { curl: 3, analyze: 2, compare: 1, badge: 1, other: 0 },
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

  it("pruneOldRows deletes request_meta past the retention window", async () => {
    const captured = { deletes: [] as string[] };
    const env = { STATS_DB: memoryD1(captured), REQUEST_META_RETENTION_DAYS: "90" } as unknown as Env;
    await pruneOldRows(env);
    expect(captured.deletes.some((s) => s.includes("DELETE FROM request_meta"))).toBe(true);
    expect(captured.deletes.some((s) => s.includes("DELETE FROM endpoint_rate_limits"))).toBe(true);
  });
});
