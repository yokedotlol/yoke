// ─── Global Analysis Budget client ──────────────────────────────────
// Thin wrapper around the AnalysisBudgetDO single-instance Durable Object.
// Provides fail-open charge() + stats() helpers and the typed error thrown
// when the daily ceiling is hit.

import { ANALYSIS_BUDGET_DO_NAME, type BudgetStats, DEFAULT_GLOBAL_ANALYSIS_BUDGET } from "./analysis-budget-do";
import type { Env } from "./helpers";
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
