// ─── Daily cost counters ─────────────────────────────────────────────
// Minimal cost instrumentation. One row per (metric, day) — NO per-request
// rows. Populated by the hourly cron, which flushes the global budget DO's
// current-day totals here via UPSERT. Read by the usage panel's
// "Cost & Budget" section.
//
// Self-healing: a CREATE TABLE IF NOT EXISTS runs before the first write so
// the table works even if the migration (0005_daily_counters.sql) hasn't been
// applied manually.

import type { BudgetStats, EndpointCounts } from "./analysis-budget-do";
import type { Env } from "./helpers";

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS daily_counters (
  metric TEXT NOT NULL,
  day TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metric, day)
)`;

let tableReady = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (tableReady) return;
  await db.prepare(CREATE_SQL).run();
  tableReady = true;
}

/**
 * Flush the budget DO's current-day totals into daily_counters via UPSERT.
 *
 * The DO holds cumulative day totals, so we SET (not increment) — repeated
 * hourly flushes are idempotent and converge on the DO's authoritative count.
 */
export async function flushBudgetCounters(db: D1Database | undefined, stats: BudgetStats): Promise<void> {
  if (!db) return;
  const { day, count, breakdown } = stats;
  // metrics may be absent on stats produced by an older DO mid-deploy — default
  // each counter to 0 so the flush stays robust.
  const metrics = stats.metrics ?? { whoisfreaks_calls: 0, pagespeed_calls: 0, cache_hits: 0, cache_misses: 0 };
  const rows: Array<[string, number]> = [
    ["analyses_total", count],
    ["analyses_curl", breakdown.curl],
    ["analyses_analyze", breakdown.analyze],
    ["analyses_compare", breakdown.compare],
    ["analyses_badge", breakdown.badge],
    ["badge_refreshes", breakdown.badge],
    // Auxiliary cost-dashboard metrics (paid-API success counts + cache hit-rate).
    ["whoisfreaks_calls", metrics.whoisfreaks_calls],
    ["pagespeed_calls", metrics.pagespeed_calls],
    ["cache_hits", metrics.cache_hits],
    ["cache_misses", metrics.cache_misses],
  ];

  const upsert = (metric: string, value: number) =>
    db
      .prepare(
        `INSERT INTO daily_counters (metric, day, value) VALUES (?, ?, ?)
         ON CONFLICT (metric, day) DO UPDATE SET value = excluded.value`,
      )
      .bind(metric, day, value);

  try {
    await ensureTable(db);
    await db.batch(rows.map(([m, v]) => upsert(m, v)));
  } catch {
    // Self-heal then retry once.
    try {
      await db.prepare(CREATE_SQL).run();
      tableReady = true;
      await db.batch(rows.map(([m, v]) => upsert(m, v)));
    } catch {
      /* non-critical instrumentation */
    }
  }
}

// ─── endpoint_usage flush ────────────────────────────────────────────
// endpoint_usage holds one row per (endpoint, day). The per-request UPSERT that
// used to populate it was the last per-request D1 write on the hot path; it's
// been replaced by an in-memory DO counter (AnalysisBudgetDO.endpoints) flushed
// here on the hourly cron. The usage panel's read (getUsageStats) is unchanged.

const ENDPOINT_USAGE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS endpoint_usage (
  endpoint TEXT NOT NULL,
  day TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (endpoint, day)
)`;
const ENDPOINT_USAGE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_endpoint_usage_day ON endpoint_usage(day)`;

let endpointTableReady = false;

async function ensureEndpointTable(db: D1Database): Promise<void> {
  if (endpointTableReady) return;
  await db.batch([db.prepare(ENDPOINT_USAGE_TABLE_SQL), db.prepare(ENDPOINT_USAGE_INDEX_SQL)]);
  endpointTableReady = true;
}

/**
 * Flush the budget DO's current-day per-endpoint hit counts into endpoint_usage.
 *
 * Mirrors flushBudgetCounters' SET semantics: the DO holds cumulative day totals
 * (NOT per-flush deltas), so we SET `hits = excluded.hits` rather than adding.
 * Repeated hourly flushes are therefore idempotent and converge on the DO's
 * authoritative count — no double-count across flushes, no count lost between
 * them. Zero-count endpoints are skipped (nothing to write).
 */
export async function flushEndpointCounters(
  db: D1Database | undefined,
  day: string,
  endpoints: EndpointCounts | undefined,
): Promise<void> {
  if (!db || !endpoints) return;
  const rows = Object.entries(endpoints).filter(([, hits]) => hits > 0);
  if (rows.length === 0) return;

  const upsert = (endpoint: string, hits: number) =>
    db
      .prepare(
        `INSERT INTO endpoint_usage (endpoint, day, hits) VALUES (?, ?, ?)
         ON CONFLICT (endpoint, day) DO UPDATE SET hits = excluded.hits`,
      )
      .bind(endpoint, day, hits);

  try {
    await ensureEndpointTable(db);
    await db.batch(rows.map(([e, h]) => upsert(e, h)));
  } catch {
    // Self-heal then retry once.
    try {
      await db.batch([db.prepare(ENDPOINT_USAGE_TABLE_SQL), db.prepare(ENDPOINT_USAGE_INDEX_SQL)]);
      endpointTableReady = true;
      await db.batch(rows.map(([e, h]) => upsert(e, h)));
    } catch {
      /* non-critical instrumentation */
    }
  }
}

/** Read a single daily_counters value for a metric/day (0 when absent). */
export async function readDailyCounter(db: D1Database | undefined, metric: string, day: string): Promise<number> {
  if (!db) return 0;
  try {
    await ensureTable(db);
    const row = await db
      .prepare("SELECT value FROM daily_counters WHERE metric = ? AND day = ?")
      .bind(metric, day)
      .first<{ value: number }>();
    return row?.value ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Lightweight cleanup run on the hourly cron. Prunes expired rate-limit and
 * error rows, and enforces request_meta retention (the one table the manual
 * /api/cleanup historically skipped). Best-effort — never throws.
 */
export async function pruneOldRows(env: Env): Promise<void> {
  const db = env.STATS_DB;
  if (!db) return;
  const now = Date.now();
  const cutoff1d = now - 24 * 60 * 60 * 1000;
  const cutoff7d = now - 7 * 24 * 60 * 60 * 1000;
  const retentionDays = requestMetaRetentionDays(env);
  const rmCutoffDay = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const safeRun = async (sql: string, ...binds: unknown[]) => {
    try {
      await db
        .prepare(sql)
        .bind(...binds)
        .run();
    } catch {
      /* table may not exist — ignore */
    }
  };

  await safeRun("DELETE FROM ai_rate_limits WHERE ts < ?", cutoff1d);
  await safeRun("DELETE FROM ai_domain_rate_limits WHERE ts < ?", cutoff1d);
  await safeRun("DELETE FROM endpoint_rate_limits WHERE ts < ?", cutoff1d);
  await safeRun("DELETE FROM api_errors WHERE ts < ?", cutoff7d);
  await safeRun("DELETE FROM request_meta WHERE day < ?", rmCutoffDay);
  await safeRun("UPDATE request_meta SET domain = NULL WHERE domain IS NOT NULL");
}

/** Resolve request_meta retention (days) from env, defaulting to 90. */
export function requestMetaRetentionDays(env: Env): number {
  const parsed = env.REQUEST_META_RETENTION_DAYS ? Number.parseInt(env.REQUEST_META_RETENTION_DAYS, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}
