// ─── Scheduled Handler: Badge Pre-warm ───────────────────────────────
// CF Workers scheduled event handler. Runs hourly via wrangler.toml
// cron trigger. Sweeps badge_domains table (most stale first), checks
// KV for each domain, re-analyzes only domains with missing or expired
// badge cache entries. Time-budgeted to 10 minutes per run.
//
// Also callable via POST /api/admin/badge-sweep for self-hosters.

import { readBadgeCache } from "./badge-cache";
import type { Env } from "./helpers";
import { logInfo, logWarn } from "./logger";

/** Stale threshold for pre-warm: 24h (more aggressive than SWR's 20h) */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Max concurrent domain refreshes per batch */
const CONCURRENCY_CAP = 5;

/** Wall-clock budget per sweep run (10 minutes) */
const BUDGET_MS = 10 * 60 * 1000;

export interface SweepResult {
  checked: number;
  refreshed: number;
  skipped: number;
  errors: number;
  budget_exhausted: boolean;
}

/**
 * Run the badge pre-warm sweep. Called by both the scheduled handler
 * and the admin badge-sweep endpoint.
 *
 * Processes domains ordered by last_requested ASC (most stale first).
 * Stops when the 10-minute wall-clock budget is exhausted.
 */
export async function badgeSweep(env: Env): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, refreshed: 0, skipped: 0, errors: 0, budget_exhausted: false };
  const startTime = Date.now();

  if (!env.STATS_DB || !env.REFERENCE_DATA) {
    logWarn("[yoke:badge-sweep] Missing STATS_DB or REFERENCE_DATA binding");
    return result;
  }

  // Fetch all tracked badge domains, most stale first
  let domains: string[];
  try {
    const rows = await env.STATS_DB.prepare("SELECT domain FROM badge_domains ORDER BY last_requested ASC").all<{
      domain: string;
    }>();
    domains = rows.results.map((r) => r.domain);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("no such table")) {
      logInfo("[yoke:badge-sweep] badge_domains table not found, nothing to sweep");
      return result;
    }
    logWarn("[yoke:badge-sweep] Failed to query badge_domains", { error: msg });
    return result;
  }

  if (domains.length === 0) {
    logInfo("[yoke:badge-sweep] No domains to sweep");
    return result;
  }

  // Process in batches with concurrency cap, respecting time budget
  const { runAnalysis } = await import("./actions/analyze/core");

  for (let i = 0; i < domains.length; i += CONCURRENCY_CAP) {
    // Check budget before starting a new batch
    if (Date.now() - startTime >= BUDGET_MS) {
      result.skipped = domains.length - i;
      result.budget_exhausted = true;
      break;
    }

    const batch = domains.slice(i, i + CONCURRENCY_CAP);
    const promises = batch.map(async (domain) => {
      result.checked++;
      try {
        const cached = await readBadgeCache(domain, env);
        if (cached) {
          const age = Date.now() - new Date(cached.analyzedAt).getTime();
          if (age < STALE_THRESHOLD_MS) return; // Still fresh
        }
        // Missing or expired — re-analyze
        await runAnalysis(domain, env, false);
        result.refreshed++;
      } catch (e) {
        result.errors++;
        logWarn("[yoke:badge-sweep] Domain refresh failed", {
          domain,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
    await Promise.all(promises);
  }

  logInfo("[yoke:badge-sweep] Sweep complete", {
    checked: result.checked,
    refreshed: result.refreshed,
    skipped: result.skipped,
    errors: result.errors,
    budget_exhausted: result.budget_exhausted,
    elapsed_ms: Date.now() - startTime,
  });

  if (result.skipped > 0) {
    logWarn("[yoke:badge-sweep] Budget exhausted — skipped domains remain. Consider increasing cron frequency.", {
      skipped: result.skipped,
      total: domains.length,
    });
  }

  return result;
}

/**
 * Cloudflare Workers scheduled event handler.
 * Wired up in index.ts as the `scheduled` export.
 */
export async function handleScheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  env._ctx = ctx;
  await badgeSweep(env);
}
