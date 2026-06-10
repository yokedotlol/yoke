/**
 * Durable Object–based global daily analysis budget.
 *
 * A single instance (addressed via idFromName("global-analysis-budget"))
 * caps the number of expensive cache-miss analyses run per UTC day across
 * the whole deployment. This protects the cost model: each analysis fans
 * out to ~25 external APIs (some paid), so an unbounded request volume can
 * run up real money.
 *
 * State lives in durable storage so the count survives DO eviction — unlike
 * the rate limiter (where a reset is harmless), losing the budget count would
 * reset the ceiling and defeat the guard. The current UTC day is tracked
 * alongside the counters; when the day rolls over the counters reset to zero.
 *
 * Fail-open is the caller's responsibility: on any DO error the caller still
 * runs the analysis. The budget should never take analysis down.
 */

// ─── Types ──────────────────────────────────────────────────────────

/** Per-path breakdown of charges for the current day. */
export interface BudgetBreakdown {
  curl: number;
  analyze: number;
  compare: number;
  badge: number;
  other: number;
}

/** Result of a charge() call. */
export interface ChargeResult {
  allowed: boolean;
  count: number;
  limit: number;
}

/**
 * Auxiliary in-memory daily metrics that ride alongside the budget count.
 *
 * Unlike `count`/`breakdown` (the cost guard, which must survive eviction),
 * these are cheap fire-and-forget observability counters. They live in the
 * same DO so call sites never touch D1/KV on the hot path — the hourly cron
 * flushes them into daily_counters. Losing a few on eviction is harmless.
 */
export interface BudgetMetrics {
  whoisfreaks_calls: number;
  pagespeed_calls: number;
  cache_hits: number;
  cache_misses: number;
}

/** Bumpable metric names (the `/bump` endpoint payload). */
export type BudgetMetric = keyof BudgetMetrics;

/**
 * Per-endpoint hit counts for the current UTC day (`{ endpoint: count }`).
 *
 * Like `metrics`, these are cheap fire-and-forget observability counters that
 * keep the hot path off D1 — every API request used to do a per-request
 * endpoint_usage UPSERT; now it bumps this in-memory map instead. The hourly
 * cron flushes the cumulative day totals into the endpoint_usage table.
 */
export type EndpointCounts = Record<string, number>;

/** Result of a stats() call. */
export interface BudgetStats {
  day: string;
  count: number;
  limit: number;
  breakdown: BudgetBreakdown;
  metrics: BudgetMetrics;
  endpoints: EndpointCounts;
}

/** Persisted shape in DO storage. */
interface BudgetState {
  day: string;
  count: number;
  breakdown: BudgetBreakdown;
  metrics: BudgetMetrics;
  endpoints: EndpointCounts;
}

/** Default global daily analysis budget when env override is absent/invalid. */
export const DEFAULT_GLOBAL_ANALYSIS_BUDGET = 3000;

/** Stable name for the single global budget DO instance. */
export const ANALYSIS_BUDGET_DO_NAME = "global-analysis-budget";

function emptyBreakdown(): BudgetBreakdown {
  return { curl: 0, analyze: 0, compare: 0, badge: 0, other: 0 };
}

function emptyMetrics(): BudgetMetrics {
  return { whoisfreaks_calls: 0, pagespeed_calls: 0, cache_hits: 0, cache_misses: 0 };
}

function emptyEndpoints(): EndpointCounts {
  return {};
}

/** Max distinct endpoint keys tracked per day — bounds memory against junk labels. */
const MAX_ENDPOINT_KEYS = 256;

const METRIC_KEYS: readonly BudgetMetric[] = ["whoisfreaks_calls", "pagespeed_calls", "cache_hits", "cache_misses"];

function isMetric(name: string): name is BudgetMetric {
  return (METRIC_KEYS as readonly string[]).includes(name);
}

/** Current UTC date as YYYY-MM-DD. */
function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Normalize an arbitrary path/source label into a breakdown bucket. */
function bucketFor(path: string): keyof BudgetBreakdown {
  switch (path) {
    case "curl":
    case "analyze":
    case "compare":
    case "badge":
      return path;
    default:
      return "other";
  }
}

export class AnalysisBudgetDO {
  private state: DurableObjectState;

  /** In-memory mirror of persisted state. Loaded lazily on first access. */
  private cache: BudgetState | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      const limit = this.limitFrom(request);

      if (url.pathname === "/charge" && request.method === "POST") {
        const body = (await request.json()) as { path?: string };
        const result = await this.charge(bucketFor(body.path ?? "other"), limit);
        return jsonResponse(result);
      }

      // Fire-and-forget observability bump. Does NOT count toward the budget —
      // it only increments an auxiliary in-memory metric (cost dashboard).
      if (url.pathname === "/bump" && request.method === "POST") {
        const body = (await request.json()) as { metric?: string };
        if (!body.metric || !isMetric(body.metric)) {
          return jsonResponse({ error: "unknown metric" }, 400);
        }
        await this.bump(body.metric);
        return jsonResponse({ ok: true });
      }

      // Fire-and-forget per-endpoint hit counter. Like /bump, this never counts
      // toward the budget — it only increments the in-memory endpoint tally the
      // hourly cron flushes into endpoint_usage.
      if (url.pathname === "/endpoint" && request.method === "POST") {
        const body = (await request.json()) as { endpoint?: string };
        if (!body.endpoint || typeof body.endpoint !== "string") {
          return jsonResponse({ error: "missing endpoint" }, 400);
        }
        await this.recordEndpoint(body.endpoint);
        return jsonResponse({ ok: true });
      }

      if (url.pathname === "/stats" && request.method === "GET") {
        const result = await this.stats(limit);
        return jsonResponse(result);
      }
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : "DO internal error" }, 500);
    }

    return new Response("Not found", { status: 404 });
  }

  /** Read the limit from the request header, defaulting when absent/invalid. */
  private limitFrom(request: Request): number {
    const raw = request.headers.get("X-Budget-Limit");
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_ANALYSIS_BUDGET;
  }

  // ─── Core Logic ─────────────────────────────────────────────────

  /** Load persisted state, rolling the day over when needed. */
  private async load(): Promise<BudgetState> {
    if (!this.cache) {
      const stored = await this.state.storage.get<BudgetState>("budget");
      this.cache = stored
        ? {
            ...stored,
            // back-compat: pre-metrics / pre-endpoints rows
            metrics: { ...emptyMetrics(), ...stored.metrics },
            endpoints: { ...emptyEndpoints(), ...stored.endpoints },
          }
        : {
            day: utcDay(),
            count: 0,
            breakdown: emptyBreakdown(),
            metrics: emptyMetrics(),
            endpoints: emptyEndpoints(),
          };
    }
    const today = utcDay();
    if (this.cache.day !== today) {
      this.cache = {
        day: today,
        count: 0,
        breakdown: emptyBreakdown(),
        metrics: emptyMetrics(),
        endpoints: emptyEndpoints(),
      };
      await this.state.storage.put("budget", this.cache);
    }
    return this.cache;
  }

  /** Atomically increment the day's count for a path. Returns allowed/count/limit. */
  async charge(bucket: keyof BudgetBreakdown, limit: number): Promise<ChargeResult> {
    const st = await this.load();
    if (st.count >= limit) {
      return { allowed: false, count: st.count, limit };
    }
    st.count += 1;
    st.breakdown[bucket] += 1;
    await this.state.storage.put("budget", st);
    return { allowed: true, count: st.count, limit };
  }

  /**
   * Increment an auxiliary metric. Separate from charge() — never consults or
   * affects the budget limit; it's pure observability accounting.
   */
  async bump(metric: BudgetMetric): Promise<void> {
    const st = await this.load();
    st.metrics[metric] += 1;
    await this.state.storage.put("budget", st);
  }

  /**
   * Increment the day's hit count for an endpoint. Pure observability — never
   * consults or affects the budget. New keys are capped at MAX_ENDPOINT_KEYS so
   * an attacker spraying distinct labels can't grow DO state unboundedly
   * (further distinct keys are dropped; existing ones still count).
   */
  async recordEndpoint(endpoint: string): Promise<void> {
    const st = await this.load();
    if (st.endpoints[endpoint] === undefined && Object.keys(st.endpoints).length >= MAX_ENDPOINT_KEYS) {
      return;
    }
    st.endpoints[endpoint] = (st.endpoints[endpoint] ?? 0) + 1;
    await this.state.storage.put("budget", st);
  }

  /** Read today's count, limit, per-path breakdown, and auxiliary metrics. */
  async stats(limit: number): Promise<BudgetStats> {
    const st = await this.load();
    return {
      day: st.day,
      count: st.count,
      limit,
      breakdown: { ...st.breakdown },
      metrics: { ...st.metrics },
      endpoints: { ...st.endpoints },
    };
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
