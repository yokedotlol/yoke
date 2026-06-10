// Lightweight endpoint usage tracking — daily counters per endpoint in D1
// One row per endpoint per day, incremented on each call via UPSERT

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS endpoint_usage (
  endpoint TEXT NOT NULL,
  day TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (endpoint, day)
)`;

const INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_endpoint_usage_day ON endpoint_usage(day)`;

let tableReady = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (tableReady) return;
  await db.batch([db.prepare(TABLE_SQL), db.prepare(INDEX_SQL)]);
  tableReady = true;
}

/** Track endpoint usage. Returns a promise — caller should pass to ctx.waitUntil() or await it. */
export function trackUsage(db: D1Database | undefined, endpoint: string, disabled?: boolean): Promise<void> {
  if (!db || disabled) return Promise.resolve();
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return ensureTable(db)
    .then(() =>
      db
        .prepare(
          `INSERT INTO endpoint_usage (endpoint, day, hits) VALUES (?, ?, 1)
       ON CONFLICT(endpoint, day) DO UPDATE SET hits = hits + 1`,
        )
        .bind(endpoint, day)
        .run(),
    )
    .then(() => {})
    .catch(() => {}); // silently ignore tracking failures
}

/** Get usage stats for the last N days */
export async function getUsageStats(
  db: D1Database | undefined,
  days = 30,
): Promise<{
  by_endpoint: Record<string, number>;
  by_day: { day: string; endpoint: string; hits: number }[];
  total: number;
  tab_views?: Record<string, number>;
  score_stats?: {
    total_scores: number;
    unique_domains: number;
    avg_composite: number;
    archetype_breakdown: Record<string, number>;
    tier_breakdown: Record<string, number>;
    daily_scores: { date: string; count: number; avg: number }[];
  };
  daily_snapshot_count?: number;
  error_stats?: { total: number; by_api: Record<string, number>; recent: { ts: number; api: string; error: string }[] };
}> {
  if (!db) return { by_endpoint: {}, by_day: [], total: 0 };
  await ensureTable(db);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const tabCutoffDay = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10); // tab_views: last 7 days

  const [summaryResult, dailyResult] = await db.batch([
    db
      .prepare(
        `SELECT endpoint, SUM(hits) as total FROM endpoint_usage WHERE day >= ? GROUP BY endpoint ORDER BY total DESC`,
      )
      .bind(cutoff),
    db
      .prepare(`SELECT day, endpoint, hits FROM endpoint_usage WHERE day >= ? ORDER BY day DESC, hits DESC`)
      .bind(cutoff),
  ]);

  const by_endpoint: Record<string, number> = {};
  let total = 0;
  for (const row of (summaryResult.results || []) as { endpoint: string; total: number }[]) {
    by_endpoint[row.endpoint] = row.total;
    total += row.total;
  }

  const by_day = ((dailyResult.results || []) as { day: string; endpoint: string; hits: number }[]).map((r) => ({
    day: r.day,
    endpoint: r.endpoint,
    hits: r.hits,
  }));

  // Tab views summary (last 7 days, best-effort). tab_views is now daily-
  // aggregated (one row per tab/day), so we SUM the per-day view counts.
  let tab_views: Record<string, number> | undefined;
  try {
    const tvResult = await db
      .prepare("SELECT tab, SUM(views) as cnt FROM tab_views WHERE day >= ? GROUP BY tab ORDER BY cnt DESC")
      .bind(tabCutoffDay)
      .all();
    if (tvResult.results && tvResult.results.length > 0) {
      tab_views = {};
      for (const row of tvResult.results as { tab: string; cnt: number }[]) {
        tab_views[row.tab] = row.cnt;
      }
    }
  } catch {
    /* table may not exist yet */
  }

  // Domain score stats (aggregate only — no individual domains exposed)
  let score_stats:
    | {
        total_scores: number;
        unique_domains: number;
        avg_composite: number;
        archetype_breakdown: Record<string, number>;
        tier_breakdown: Record<string, number>;
        daily_scores: { date: string; count: number; avg: number }[];
      }
    | undefined;
  try {
    const scoreAgg = await db
      .prepare(
        `SELECT COUNT(*) as total, COUNT(DISTINCT domain) as uniq, AVG(composite_score) as avg_comp FROM domain_scores WHERE scored_at >= ?`,
      )
      .bind(`${cutoff}T00:00:00`)
      .first<{ total: number; uniq: number; avg_comp: number }>();

    const archetypeRows = await db
      .prepare(
        `SELECT archetype, COUNT(*) as cnt FROM domain_scores WHERE scored_at >= ? GROUP BY archetype ORDER BY cnt DESC`,
      )
      .bind(`${cutoff}T00:00:00`)
      .all();
    const archetype_breakdown: Record<string, number> = {};
    for (const r of (archetypeRows.results || []) as { archetype: string; cnt: number }[]) {
      archetype_breakdown[r.archetype] = r.cnt;
    }

    // Tier distribution from composite scores
    const tierRows = await db
      .prepare(
        `SELECT
        CASE
          WHEN composite_score >= 90 THEN 'Excellent'
          WHEN composite_score >= 78 THEN 'Strong'
          WHEN composite_score >= 60 THEN 'Moderate'
          WHEN composite_score >= 40 THEN 'Weak'
          ELSE 'Critical'
        END as tier,
        COUNT(*) as cnt
       FROM domain_scores WHERE scored_at >= ? GROUP BY tier ORDER BY tier`,
      )
      .bind(`${cutoff}T00:00:00`)
      .all();
    const tier_breakdown: Record<string, number> = {};
    for (const r of (tierRows.results || []) as { tier: string; cnt: number }[]) {
      tier_breakdown[r.tier] = r.cnt;
    }

    // Daily score volume + average
    const dailyScoreRows = await db
      .prepare(
        `SELECT DATE(scored_at) as d, COUNT(*) as cnt, AVG(composite_score) as avg FROM domain_scores WHERE scored_at >= ? GROUP BY d ORDER BY d`,
      )
      .bind(`${cutoff}T00:00:00`)
      .all();
    const daily_scores = ((dailyScoreRows.results || []) as { d: string; cnt: number; avg: number }[]).map((r) => ({
      date: r.d,
      count: r.cnt,
      avg: Math.round(r.avg),
    }));

    if (scoreAgg) {
      score_stats = {
        total_scores: scoreAgg.total,
        unique_domains: scoreAgg.uniq,
        avg_composite: Math.round(scoreAgg.avg_comp || 0),
        archetype_breakdown,
        tier_breakdown,
        daily_scores,
      };
    }
  } catch {
    /* domain_scores table may not exist yet */
  }

  // Daily snapshot count
  let daily_snapshot_count: number | undefined;
  try {
    const snap = await db.prepare("SELECT COUNT(*) as cnt FROM daily_snapshots").first<{ cnt: number }>();
    daily_snapshot_count = snap?.cnt ?? 0;
  } catch {
    /* table may not exist */
  }

  // API error stats (anonymized — no IPs)
  let error_stats:
    | {
        total: number;
        by_api: Record<string, number>;
        recent: { ts: number; api: string; error: string }[];
      }
    | undefined;
  try {
    const errAgg = await db
      .prepare(`SELECT COUNT(*) as total FROM api_errors WHERE ts >= ?`)
      .bind(Date.now() - days * 86400000)
      .first<{ total: number }>();
    const errByApi = await db
      .prepare(`SELECT api, COUNT(*) as cnt FROM api_errors WHERE ts >= ? GROUP BY api ORDER BY cnt DESC`)
      .bind(Date.now() - days * 86400000)
      .all();
    const by_api: Record<string, number> = {};
    for (const r of (errByApi.results || []) as { api: string; cnt: number }[]) {
      by_api[r.api] = r.cnt;
    }
    // Recent errors (last 10, no IP)
    const recentErrors = await db.prepare(`SELECT ts, api, error FROM api_errors ORDER BY ts DESC LIMIT 10`).all();
    const recent = ((recentErrors.results || []) as { ts: number; api: string; error: string }[]).map((r) => ({
      ts: r.ts,
      api: r.api,
      error: r.error?.slice(0, 120) || "",
    }));
    error_stats = { total: errAgg?.total ?? 0, by_api, recent };
  } catch {
    /* api_errors table may not exist */
  }

  const result = { by_endpoint, by_day, total, tab_views, score_stats, daily_snapshot_count, error_stats };
  return result;
}
