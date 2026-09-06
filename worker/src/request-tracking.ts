// Aggregate request telemetry for the admin dashboard.
// Stores hourly counters only: no raw/hashed IPs, request targets, timestamps, or per-request rows.

import { backgroundWork, type Env } from "./helpers";

export interface RequestMeta {
  endpoint: string;
  domain?: string; // accepted for caller compatibility; never persisted in request telemetry
  status: number;
  latencyMs: number;
}

/** Detect client type from request headers */
export function detectClientType(request: Request): string {
  const origin = request.headers.get("origin") || "";
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) return "extension";
  if (
    /^curl\b/.test(ua) ||
    /^wget\b/.test(ua) ||
    /^httpie\b/.test(ua) ||
    ua === "" ||
    /^python-/.test(ua) ||
    /^go-http/.test(ua) ||
    /^node-fetch/.test(ua)
  )
    return "cli";
  if (!origin && !request.headers.get("referer") && request.headers.get("accept")?.includes("application/json"))
    return "api";
  return "web";
}

/** Extract 2-letter country from CF headers */
function getCountry(request: Request): string {
  const country = request.headers.get("cf-ipcountry") || "XX";
  return /^[A-Z]{2}$/.test(country) ? country : "XX";
}

let tableReady = false;

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS request_aggregates (
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  client_type TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'XX',
  status_code INTEGER NOT NULL DEFAULT 200,
  request_count INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, endpoint, client_type, country, status_code)
)`;

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_ra_day ON request_aggregates(day)",
  "CREATE INDEX IF NOT EXISTS idx_ra_endpoint ON request_aggregates(endpoint, day)",
  "CREATE INDEX IF NOT EXISTS idx_ra_country ON request_aggregates(country, day)",
];

async function ensureTable(db: D1Database): Promise<void> {
  if (tableReady) return;
  const stmts = [db.prepare(CREATE_SQL), ...INDEXES.map((sql) => db.prepare(sql))];
  await db.batch(stmts);
  // Privacy cleanup for deployments that used the legacy per-request table.
  await db.prepare("DROP TABLE IF EXISTS request_meta").run();
  tableReady = true;
}

/** Increment one anonymous aggregate bucket. Non-blocking via backgroundWork. */
export function trackRequest(env: Env, request: Request, meta: RequestMeta): void {
  if (!env.STATS_DB || env.DISABLE_ANALYTICS) return;

  const country = getCountry(request);
  const clientType = detectClientType(request);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const latencyMs = Math.max(0, Math.round(meta.latencyMs || 0));

  backgroundWork(
    env,
    (async () => {
      try {
        await ensureTable(env.STATS_DB);
        await env.STATS_DB.prepare(
          `INSERT INTO request_aggregates
             (day, hour, endpoint, client_type, country, status_code, request_count, latency_sum_ms)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(day, hour, endpoint, client_type, country, status_code)
           DO UPDATE SET
             request_count = request_count + 1,
             latency_sum_ms = latency_sum_ms + excluded.latency_sum_ms`,
        )
          .bind(day, hour, meta.endpoint, clientType, country, meta.status, latencyMs)
          .run();
      } catch {
        /* non-critical telemetry */
      }
    })(),
  );
}

/** Get aggregate operational analytics for the dashboard */
export async function getRequestAnalytics(db: D1Database | undefined, days: number): Promise<RequestAnalytics> {
  const result: RequestAnalytics = {
    total_requests: 0,
    unique_domains: 0,
    avg_latency_ms: 0,
    error_rate_pct: 0,
    domains_per_day: [],
    requests_per_day: [],
    by_client_type: {},
    by_country: [],
    by_hour: new Array(24).fill(0),
    by_status: {},
    repeat_analysis_rate: 0,
  };
  if (!db) return result;

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  try {
    await ensureTable(db);
  } catch {
    return result;
  }

  try {
    const agg = await db
      .prepare(
        `SELECT SUM(request_count) as total,
                SUM(latency_sum_ms) as latency,
                SUM(CASE WHEN status_code >= 400 THEN request_count ELSE 0 END) as errors
         FROM request_aggregates WHERE day >= ?`,
      )
      .bind(cutoff)
      .first<{ total: number; latency: number; errors: number }>();

    let totalFromUsage = 0;
    try {
      const usageTotal = await db
        .prepare(`SELECT SUM(hits) as total FROM endpoint_usage WHERE day >= ?`)
        .bind(cutoff)
        .first<{ total: number }>();
      totalFromUsage = usageTotal?.total ?? 0;
    } catch {
      /* endpoint_usage may not exist */
    }

    const aggregateTotal = agg?.total ?? 0;
    result.total_requests = totalFromUsage || aggregateTotal;
    result.avg_latency_ms = aggregateTotal > 0 ? Math.round((agg?.latency ?? 0) / aggregateTotal) : 0;
    result.error_rate_pct = aggregateTotal > 0 ? Math.round(((agg?.errors ?? 0) / aggregateTotal) * 100 * 10) / 10 : 0;

    try {
      const domainAgg = await db
        .prepare(`SELECT COUNT(DISTINCT domain) as domains FROM domain_scores WHERE scored_at >= ?`)
        .bind(`${cutoff}T00:00:00`)
        .first<{ domains: number }>();
      result.unique_domains = domainAgg?.domains ?? 0;

      const dpd = await db
        .prepare(
          `SELECT DATE(scored_at) as day, COUNT(DISTINCT domain) as domains
           FROM domain_scores WHERE scored_at >= ? GROUP BY DATE(scored_at) ORDER BY day`,
        )
        .bind(`${cutoff}T00:00:00`)
        .all();
      result.domains_per_day = ((dpd.results || []) as { day: string; domains: number }[]).map((row) => ({
        date: row.day,
        count: row.domains,
      }));

      const repeats = await db
        .prepare(
          `SELECT COUNT(*) as multi FROM (
             SELECT domain FROM domain_scores WHERE scored_at >= ? GROUP BY domain HAVING COUNT(*) > 1
           )`,
        )
        .bind(`${cutoff}T00:00:00`)
        .first<{ multi: number }>();
      if (repeats && result.unique_domains > 0) {
        result.repeat_analysis_rate = Math.round((repeats.multi / result.unique_domains) * 100);
      }
    } catch {
      /* domain_scores may not exist yet */
    }

    try {
      const rpd = await db
        .prepare(`SELECT day, SUM(hits) as cnt FROM endpoint_usage WHERE day >= ? GROUP BY day ORDER BY day`)
        .bind(cutoff)
        .all();
      result.requests_per_day = ((rpd.results || []) as { day: string; cnt: number }[]).map((row) => ({
        date: row.day,
        count: row.cnt,
      }));
    } catch {
      /* endpoint_usage may not exist */
    }

    const bct = await db
      .prepare(
        `SELECT client_type, SUM(request_count) as cnt
         FROM request_aggregates WHERE day >= ? GROUP BY client_type ORDER BY cnt DESC`,
      )
      .bind(cutoff)
      .all();
    for (const row of (bct.results || []) as { client_type: string; cnt: number }[]) {
      result.by_client_type[row.client_type] = row.cnt;
    }

    const countries = await db
      .prepare(
        `SELECT country, SUM(request_count) as cnt
         FROM request_aggregates WHERE day >= ? AND country != 'XX'
         GROUP BY country ORDER BY cnt DESC LIMIT 15`,
      )
      .bind(cutoff)
      .all();
    result.by_country = ((countries.results || []) as { country: string; cnt: number }[]).map((row) => ({
      country: row.country,
      requests: row.cnt,
    }));

    const hourly = await db
      .prepare(
        `SELECT hour, SUM(request_count) as cnt
         FROM request_aggregates WHERE day >= ? GROUP BY hour ORDER BY hour`,
      )
      .bind(cutoff)
      .all();
    for (const row of (hourly.results || []) as { hour: number; cnt: number }[]) {
      result.by_hour[row.hour] = row.cnt;
    }

    const statuses = await db
      .prepare(
        `SELECT status_code, SUM(request_count) as cnt
         FROM request_aggregates WHERE day >= ? GROUP BY status_code ORDER BY cnt DESC`,
      )
      .bind(cutoff)
      .all();
    for (const row of (statuses.results || []) as { status_code: number; cnt: number }[]) {
      result.by_status[row.status_code] = row.cnt;
    }
  } catch {
    /* aggregate telemetry tables may not exist yet */
  }

  return result;
}

export interface RequestAnalytics {
  total_requests: number;
  unique_domains: number;
  avg_latency_ms: number;
  error_rate_pct: number;
  domains_per_day: { date: string; count: number }[];
  requests_per_day: { date: string; count: number }[];
  by_client_type: Record<string, number>;
  by_country: { country: string; requests: number }[];
  by_hour: number[];
  by_status: Record<number, number>;
  repeat_analysis_rate: number;
}
