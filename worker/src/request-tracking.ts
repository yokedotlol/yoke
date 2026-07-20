// Rich request-level telemetry for the admin dashboard
// Stores anonymized per-request metadata — NO raw IPs, NO PII
// Uses secret-salted, daily-rotating SHA-256 hash for unique visitor counting

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
  // If no origin and no referer, likely direct API call
  if (!origin && !request.headers.get("referer") && request.headers.get("accept")?.includes("application/json"))
    return "api";
  return "web";
}

/** SHA-256 hash with secret salt + daily rotation, truncated to 16 hex chars — not reversible */
async function hashVisitor(ip: string, day: string, env?: { IP_HASH_SALT?: string }): Promise<string> {
  const salt = env?.IP_HASH_SALT || "yoke-default-salt";
  const data = new TextEncoder().encode(`${ip}:${day}:${salt}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** Extract 2-letter country from CF headers */
function getCountry(request: Request): string {
  return request.headers.get("cf-ipcountry") || "XX";
}

let tableReady = false;

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS request_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  domain TEXT,
  client_type TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'XX',
  status_code INTEGER NOT NULL DEFAULT 200,
  latency_ms INTEGER,
  visitor_hash TEXT NOT NULL
)`;

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_rm_day ON request_meta(day)",
  "CREATE INDEX IF NOT EXISTS idx_rm_endpoint ON request_meta(endpoint, day)",
  "CREATE INDEX IF NOT EXISTS idx_rm_domain ON request_meta(domain, day)",
  "CREATE INDEX IF NOT EXISTS idx_rm_visitor ON request_meta(visitor_hash, day)",
  "CREATE INDEX IF NOT EXISTS idx_rm_country ON request_meta(country)",
  "CREATE INDEX IF NOT EXISTS idx_rm_hour ON request_meta(day, hour)",
];

async function ensureTable(db: D1Database): Promise<void> {
  if (tableReady) return;
  const stmts = [db.prepare(CREATE_SQL), ...INDEXES.map((s) => db.prepare(s))];
  await db.batch(stmts);
  tableReady = true;
}

/** Track a request with rich metadata. Non-blocking — fire and forget via backgroundWork. */
export function trackRequest(env: Env, request: Request, meta: RequestMeta): void {
  if (!env.STATS_DB || env.DISABLE_ANALYTICS) return;

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const country = getCountry(request);
  const clientType = detectClientType(request);
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const hour = new Date(now).getUTCHours();

  backgroundWork(
    env,
    (async () => {
      try {
        const visitorHash = await hashVisitor(ip, day, env);
        await ensureTable(env.STATS_DB);
        await env.STATS_DB.prepare(
          `INSERT INTO request_meta (ts, day, hour, endpoint, domain, client_type, country, status_code, latency_ms, visitor_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(now, day, hour, meta.endpoint, null, clientType, country, meta.status, meta.latencyMs, visitorHash)
          .run();
      } catch {
        // Auto-migrate on first failure
        try {
          await env.STATS_DB.prepare(CREATE_SQL).run();
          for (const idx of INDEXES) await env.STATS_DB.prepare(idx).run();
          tableReady = true;
          const visitorHash = await hashVisitor(ip, day, env);
          await env.STATS_DB.prepare(
            `INSERT INTO request_meta (ts, day, hour, endpoint, domain, client_type, country, status_code, latency_ms, visitor_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(now, day, hour, meta.endpoint, null, clientType, country, meta.status, meta.latencyMs, visitorHash)
            .run();
        } catch {
          /* non-critical telemetry */
        }
      }
    })(),
  );
}

/** Get rich analytics for the dashboard */
export async function getRequestAnalytics(db: D1Database | undefined, days: number): Promise<RequestAnalytics> {
  if (!db)
    return {
      total_requests: 0,
      unique_visitors: 0,
      unique_domains: 0,
      avg_latency_ms: 0,
      error_rate_pct: 0,
      by_country: [],
      visitors_per_day: [],
      domains_per_day: [],
      requests_per_day: [],
      by_client_type: {},
      by_hour: [],
      by_status: {},
      repeat_analysis_rate: 0,
    };
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const result: RequestAnalytics = {
    total_requests: 0,
    unique_visitors: 0,
    unique_domains: 0,
    avg_latency_ms: 0,
    error_rate_pct: 0,
    visitors_per_day: [],
    domains_per_day: [],
    requests_per_day: [],
    by_client_type: {},
    by_country: [],
    by_hour: new Array(24).fill(0),
    by_status: {},
    repeat_analysis_rate: 0,
  };

  try {
    await ensureTable(db);
  } catch {
    return result;
  }

  try {
    // Aggregate KPIs — operational request telemetry stays aggregate and never stores analyzed domains.
    const agg = await db
      .prepare(
        `SELECT COUNT(DISTINCT visitor_hash) as visitors,
              AVG(latency_ms) as avg_lat,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
              COUNT(*) as rm_total
       FROM request_meta WHERE day >= ?`,
      )
      .bind(cutoff)
      .first<{ visitors: number; avg_lat: number; errors: number; rm_total: number }>();

    // Total requests from endpoint_usage (has full history)
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

    if (agg) {
      result.total_requests = totalFromUsage || agg.rm_total;
      result.unique_visitors = agg.visitors;
      // unique_domains is populated from domain_scores below; request_meta intentionally does not retain targets.
      result.avg_latency_ms = Math.round(agg.avg_lat || 0);
      result.error_rate_pct = agg.rm_total > 0 ? Math.round((agg.errors / agg.rm_total) * 1000) / 10 : 0;
    }

    // Domain analytics come from product score history, not request telemetry.
    try {
      const domainAgg = await db
        .prepare(`SELECT COUNT(DISTINCT domain) as domains FROM domain_scores WHERE scored_at >= ?`)
        .bind(`${cutoff}T00:00:00`)
        .first<{ domains: number }>();
      result.unique_domains = domainAgg?.domains ?? 0;
    } catch {
      /* domain_scores may not exist yet */
    }

    // Visitors per day
    const vpd = await db
      .prepare(
        `SELECT day, COUNT(DISTINCT visitor_hash) as visitors FROM request_meta WHERE day >= ? GROUP BY day ORDER BY day`,
      )
      .bind(cutoff)
      .all();
    result.visitors_per_day = ((vpd.results || []) as { day: string; visitors: number }[]).map((r) => ({
      date: r.day,
      count: r.visitors,
    }));

    // Unique domains per day from product score history only.
    try {
      const dpd = await db
        .prepare(
          `SELECT DATE(scored_at) as day, COUNT(DISTINCT domain) as domains
         FROM domain_scores WHERE scored_at >= ? GROUP BY DATE(scored_at) ORDER BY day`,
        )
        .bind(`${cutoff}T00:00:00`)
        .all();
      result.domains_per_day = ((dpd.results || []) as { day: string; domains: number }[]).map((r) => ({
        date: r.day,
        count: r.domains,
      }));
    } catch {
      /* domain_scores may not exist yet */
    }

    // Requests per day — pull from endpoint_usage for full history
    try {
      const rpd = await db
        .prepare(`SELECT day, SUM(hits) as cnt FROM endpoint_usage WHERE day >= ? GROUP BY day ORDER BY day`)
        .bind(cutoff)
        .all();
      result.requests_per_day = ((rpd.results || []) as { day: string; cnt: number }[]).map((r) => ({
        date: r.day,
        count: r.cnt,
      }));
    } catch {
      /* endpoint_usage may not exist */
    }

    // By client type
    const bct = await db
      .prepare(
        `SELECT client_type, COUNT(*) as cnt FROM request_meta WHERE day >= ? GROUP BY client_type ORDER BY cnt DESC`,
      )
      .bind(cutoff)
      .all();
    for (const r of (bct.results || []) as { client_type: string; cnt: number }[]) {
      result.by_client_type[r.client_type] = r.cnt;
    }

    // Top 15 countries
    const countries = await db
      .prepare(
        `SELECT country, COUNT(*) as cnt, COUNT(DISTINCT visitor_hash) as visitors
       FROM request_meta WHERE day >= ? AND country != 'XX' GROUP BY country ORDER BY cnt DESC LIMIT 15`,
      )
      .bind(cutoff)
      .all();
    result.by_country = ((countries.results || []) as { country: string; cnt: number; visitors: number }[]).map(
      (r) => ({
        country: r.country,
        requests: r.cnt,
        visitors: r.visitors,
      }),
    );

    // Hourly distribution (UTC)
    const hourly = await db
      .prepare(`SELECT hour, COUNT(*) as cnt FROM request_meta WHERE day >= ? GROUP BY hour ORDER BY hour`)
      .bind(cutoff)
      .all();
    for (const r of (hourly.results || []) as { hour: number; cnt: number }[]) {
      result.by_hour[r.hour] = r.cnt;
    }

    // Status code breakdown
    const statuses = await db
      .prepare(
        `SELECT status_code, COUNT(*) as cnt FROM request_meta WHERE day >= ? GROUP BY status_code ORDER BY cnt DESC`,
      )
      .bind(cutoff)
      .all();
    for (const r of (statuses.results || []) as { status_code: number; cnt: number }[]) {
      result.by_status[r.status_code] = r.cnt;
    }

    // Repeat analysis rate: domains scored more than once in product score history.
    try {
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
  } catch {
    /* tables may not exist yet */
  }

  return result;
}

export interface RequestAnalytics {
  total_requests: number;
  unique_visitors: number;
  unique_domains: number;
  avg_latency_ms: number;
  error_rate_pct: number;
  visitors_per_day: { date: string; count: number }[];
  domains_per_day: { date: string; count: number }[];
  requests_per_day: { date: string; count: number }[];
  by_client_type: Record<string, number>;
  by_country: { country: string; requests: number; visitors: number }[];
  by_hour: number[];
  by_status: Record<number, number>;
  repeat_analysis_rate: number;
}
