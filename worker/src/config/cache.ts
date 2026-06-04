// ─── Centralized Cache TTL Configuration ─────────────────────────────
// All cache TTL values in one place for easy tuning.

/** Default analysis cache: 24 hours. Override with CACHE_TTL_HOURS env var. */
export const ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Get analysis cache TTL, respecting CACHE_TTL_HOURS env override. */
export function getAnalysisCacheTtlMs(env?: { CACHE_TTL_HOURS?: string }): number {
  if (env?.CACHE_TTL_HOURS) {
    const hours = parseFloat(env.CACHE_TTL_HOURS);
    if (!Number.isNaN(hours) && hours >= 0) return hours * 60 * 60 * 1000;
  }
  return ANALYSIS_CACHE_TTL_MS;
}

/** PageSpeed results: 24 hours (aggressive rate-limiting) */
export const PERF_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** AI analysis results: 24 hours */
export const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** HIBP breach catalog: 24 hours */
export const BREACH_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Per-domain breach results: 24 hours */
export const BREACH_RESULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
