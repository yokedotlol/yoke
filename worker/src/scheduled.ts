// ─── Scheduled Handler ───────────────────────────────────────────────
// CF Workers scheduled event handler. Runs hourly via the cron trigger.
//
// The expensive badge pre-warm sweep that previously lived here was REMOVED:
// it re-analyzed every tracked badge domain on a timer (a cost-model hole).
// Badges now refresh lazily on-view (see api-badge.ts) and analyses are
// capped by the global daily budget DO. The hourly cron only does cheap,
// bounded maintenance: flush the budget DO's current-day aggregates into the
// daily_counters table, then prune stale rows.
//
// (The badgeSweep() helper and its admin POST /api/admin/badge-sweep endpoint
// were also removed — the sweep was fully retired, not just unscheduled.)

import { readBudgetStats } from "./analysis-budget";
import { flushBudgetCounters, pruneOldRows } from "./daily-counters";
import type { Env } from "./helpers";
import { logWarn } from "./logger";

/**
 * Cloudflare Workers scheduled event handler (hourly cron).
 * Wired up in index.ts as the `scheduled` export.
 *
 * The cron only flushes budget aggregates and prunes — no badge pre-warming.
 */
export async function handleScheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  env._ctx = ctx;

  // Flush the global budget DO's current-day totals into daily_counters (UPSERT).
  try {
    const stats = await readBudgetStats(env);
    if (stats) await flushBudgetCounters(env.STATS_DB, stats);
  } catch (e) {
    logWarn("[yoke:cron] budget flush failed", { error: e instanceof Error ? e.message : String(e) });
  }

  // Lightweight cleanup: prune stale rate-limit / error / request_meta rows.
  try {
    await pruneOldRows(env);
  } catch (e) {
    logWarn("[yoke:cron] prune failed", { error: e instanceof Error ? e.message : String(e) });
  }
}
