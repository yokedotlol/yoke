// ─── Global Analysis Budget client ──────────────────────────────────
// Thin wrapper around the AnalysisBudgetDO single-instance Durable Object.
// Provides fail-open charge() + stats() helpers and the typed error thrown
// when the daily ceiling is hit.

import {
  ANALYSIS_BUDGET_DO_NAME,
  type BudgetMetric,
  type BudgetStats,
  DEFAULT_GLOBAL_ANALYSIS_BUDGET,
} from "./analysis-budget-do";
import { backgroundWork, type Env } from "./helpers";
import { logError } from "./logger";

/** Source/path label threaded from call sites for per-path accounting. */
export type AnalysisSource = "curl" | "analyze" | "compare" | "badge" | "other";

/** Thrown by runAnalysisCore when the global daily budget is exhausted. */
export class BudgetExceededError extends Error {
  readonly count: number;
  readonly limit: number;
  constructor(count: number, limit: number) {
    super("Global analysis budget reached");
    this.name = "BudgetExceededError";
    this.count = count;
    this.limit = limit;
  }
}

/** Resolve the configured daily limit (env override → default). */
export function resolveBudgetLimit(env: Env): number {
  const parsed = env.GLOBAL_ANALYSIS_BUDGET ? Number.parseInt(env.GLOBAL_ANALYSIS_BUDGET, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_ANALYSIS_BUDGET;
}

function budgetStub(env: Env) {
  if (!env.ANALYSIS_BUDGET) return null;
  const id = env.ANALYSIS_BUDGET.idFromName(ANALYSIS_BUDGET_DO_NAME);
  return env.ANALYSIS_BUDGET.get(id);
}

/**
 * Charge one analysis against the global daily budget.
 *
 * Fail-OPEN: if the binding is missing or the DO errors, this resolves
 * silently (allowing the analysis). Only an explicit over-budget response
 * from the DO throws BudgetExceededError.
 */
export async function chargeBudget(env: Env, source: AnalysisSource): Promise<void> {
  const stub = budgetStub(env);
  if (!stub) return; // not bound (e.g. self-hosted without the DO) — fail open
  const limit = resolveBudgetLimit(env);
  try {
    const resp = await stub.fetch(
      new Request("https://do/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Budget-Limit": String(limit) },
        body: JSON.stringify({ path: source }),
      }),
    );
    if (!resp.ok) {
      logError("analysis budget DO error", { status: resp.status });
      return; // fail open
    }
    const result = (await resp.json()) as { allowed: boolean; count: number; limit: number };
    if (!result.allowed) {
      throw new BudgetExceededError(result.count, result.limit);
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    logError("analysis budget DO error", { error: err instanceof Error ? err.message : String(err) });
    // Fail open on infra errors — never let the budget take down analysis.
  }
}

/**
 * Read today's budget stats. Returns null when the binding is missing or the
 * DO errors (caller renders a "not available" state).
 */
export async function readBudgetStats(env: Env): Promise<BudgetStats | null> {
  const stub = budgetStub(env);
  if (!stub) return null;
  const limit = resolveBudgetLimit(env);
  try {
    const resp = await stub.fetch(
      new Request("https://do/stats", {
        method: "GET",
        headers: { "X-Budget-Limit": String(limit) },
      }),
    );
    if (!resp.ok) return null;
    return (await resp.json()) as BudgetStats;
  } catch (err) {
    logError("analysis budget DO error", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─── Fire-and-forget observability counters ─────────────────────────
// These bump in-memory DO metrics ONLY — no per-request D1/KV writes. They run
// as background work (ctx.waitUntil) so they add zero latency to the response
// and never block it. The hourly cron flushes them into daily_counters.
// Fail-OPEN and silent: instrumentation must never affect a real request.

/** POST /bump to the budget DO. Awaitable, but always swallows errors. */
async function bumpMetric(env: Env, metric: BudgetMetric): Promise<void> {
  const stub = budgetStub(env);
  if (!stub) return;
  try {
    await stub.fetch(
      new Request("https://do/bump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metric }),
      }),
    );
  } catch {
    // Instrumentation is best-effort — never surface or rethrow.
  }
}

/** POST /endpoint to the budget DO. Awaitable, but always swallows errors. */
async function bumpEndpoint(env: Env, endpoint: string): Promise<void> {
  const stub = budgetStub(env);
  if (!stub) return;
  try {
    await stub.fetch(
      new Request("https://do/endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      }),
    );
  } catch {
    // Instrumentation is best-effort — never surface or rethrow.
  }
}

/** Record a successful billable paid-API call (fire-and-forget). */
export function recordApiCall(env: Env, name: "whoisfreaks" | "pagespeed"): void {
  const metric: BudgetMetric = name === "whoisfreaks" ? "whoisfreaks_calls" : "pagespeed_calls";
  backgroundWork(env, bumpMetric(env, metric));
}

/** Record an analysis cache hit (fire-and-forget). */
export function recordCacheHit(env: Env): void {
  backgroundWork(env, bumpMetric(env, "cache_hits"));
}

/** Record an analysis cache miss (fire-and-forget). */
export function recordCacheMiss(env: Env): void {
  backgroundWork(env, bumpMetric(env, "cache_misses"));
}

/**
 * Record one endpoint hit (fire-and-forget). Replaces the per-request
 * endpoint_usage D1 UPSERT: bumps an in-memory DO counter the hourly cron
 * flushes into endpoint_usage, so the hot path never touches D1. Honors
 * DISABLE_ANALYTICS (self-hosted opt-out), matching the old trackUsage gate.
 */
export function recordEndpointHit(env: Env, endpoint: string): void {
  if (env.DISABLE_ANALYTICS) return;
  backgroundWork(env, bumpEndpoint(env, endpoint));
}
