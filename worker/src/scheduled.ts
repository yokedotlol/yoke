// ─── Scheduled Handler: Badge Pre-warm ───────────────────────────────
// CF Workers scheduled event handler. Runs every 4h via wrangler.toml
// cron trigger. Sweeps badge_domains table, checks KV for each domain,
// re-analyzes only domains with missing or expired badge cache entries.
//
// Also callable via POST /api/admin/badge-sweep for self-hosters.

import { readBadgeCache } from "./badge-cache";
import type { Env } from "./helpers";
import { logInfo, logWarn } from "./logger";

/** Stale threshold for pre-warm: 24h (more aggressive than SWR's 20h) */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Max concurrent domain refreshes per sweep run */
const CONCURRENCY_CAP = 5;

export interface SweepResult {
  checked: number;
  refreshed: number;
  errors: number;
}

/**
 * Run the badge pre-warm sweep. Called by both the scheduled handler
 * and the admin badge-sweep endpoint.
 */
export async function badgeSweep(env: Env): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, refreshed: 0, errors: 0 };

  if (!env.STATS_DB || !env.REFERENCE_DATA) {
    logWarn("[yoke:badge-sweep] Missing STATS_DB or REFERENCE_DATA binding");
    return result;
  }

  // Fetch all tracked badge domains
  let domains: string[];
  try {
    const rows = await env.STATS_DB.prepare("SELECT domain FROM badge_domains ORDER BY last_requested DESC").all<{
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

  // Process in batches with concurrency cap
  const { runAnalysis } = await import("./actions/analyze/core");

  for (let i = 0; i < domains.length; i += CONCURRENCY_CAP) {
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
    errors: result.errors,
  });

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
