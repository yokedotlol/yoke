// Percentile distribution computation + lookup
//
// Histogram-based: 101 buckets per axis (index = score 0–100, value = domain count).
// Scales to any number of domains with fixed ~2.8KB storage.
// Cached in KV for 6h (shorter during seeder sprint). Percentile = prefix-sum lookup, no sorting needed.

import type { Env } from "./helpers";

// ─── Types ──────────────────────────────────────────────────────────

/** 101-element histogram: index = score (0–100), value = count of domains at that score. */
type Histogram = number[];

export interface PercentileDistribution {
  composite: Histogram;
  security: Histogram;
  speed: Histogram;
  foundations: Histogram;
  reputation: Histogram;
  discoverability: Histogram;
  sample_size: number;
  computed_at: string;
}

export interface PercentileData {
  composite: number;
  axes: {
    security: number | null;
    speed: number | null;
    foundations: number | null;
    reputation: number | null;
    discoverability: number | null;
    email: number | null; // always null — not tracked in D1
  };
  sample_size: number;
  computed_at: string;
}

// ─── Constants ──────────────────────────────────────────────────────

const BUCKET_COUNT = 101; // scores 0–100 inclusive
const KV_KEY = "percentiles:distribution";
const KV_TTL_SECS = 21600; // 6h — shorter while seeder is filling the pool
const MIN_SAMPLE_SIZE = 10; // don't show percentiles with fewer domains

// D1 column → axis mapping
// The domain_scores table uses legacy column names:
//   performance_score → speed, reliability_score → foundations,
//   trust_score → reputation, visibility_score → discoverability
// email is not stored in D1 at all.

// ─── Histogram Lookup ───────────────────────────────────────────────

function emptyHistogram(): Histogram {
  return new Array(BUCKET_COUNT).fill(0);
}

/** Percentile rank via prefix sum: % of values strictly less than `score`. */
function percentileRank(histogram: Histogram, score: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  let below = 0;
  let total = 0;
  for (let i = 0; i < BUCKET_COUNT; i++) {
    total += histogram[i];
    if (i < clamped) below += histogram[i];
  }
  if (total === 0) return 0;
  return Math.round((below / total) * 100);
}

// ─── Distribution Computation ───────────────────────────────────────

async function computeDistribution(db: D1Database): Promise<PercentileDistribution | null> {
  try {
    // Latest score per unique domain — equal weight regardless of scan frequency
    const result = await db
      .prepare(
        `WITH latest AS (
          SELECT domain, composite_score, security_score, performance_score,
                 reliability_score, trust_score, visibility_score,
                 ROW_NUMBER() OVER (PARTITION BY domain ORDER BY scored_at DESC) AS rn
          FROM domain_scores
        )
        SELECT composite_score, security_score, performance_score,
               reliability_score, trust_score, visibility_score
        FROM latest WHERE rn = 1`,
      )
      .all();

    if (!result.results || result.results.length < MIN_SAMPLE_SIZE) return null;

    const composite = emptyHistogram();
    const security = emptyHistogram();
    const speed = emptyHistogram();
    const foundations = emptyHistogram();
    const reputation = emptyHistogram();
    const discoverability = emptyHistogram();

    let sampleSize = 0;

    for (const row of result.results) {
      const r = row as Record<string, unknown>;
      if (typeof r.composite_score === "number") {
        composite[Math.max(0, Math.min(100, Math.round(r.composite_score)))]++;
        sampleSize++;
      }
      if (typeof r.security_score === "number") {
        security[Math.max(0, Math.min(100, Math.round(r.security_score)))]++;
      }
      if (typeof r.performance_score === "number") {
        speed[Math.max(0, Math.min(100, Math.round(r.performance_score)))]++;
      }
      if (typeof r.reliability_score === "number") {
        foundations[Math.max(0, Math.min(100, Math.round(r.reliability_score)))]++;
      }
      if (typeof r.trust_score === "number") {
        reputation[Math.max(0, Math.min(100, Math.round(r.trust_score)))]++;
      }
      if (typeof r.visibility_score === "number") {
        discoverability[Math.max(0, Math.min(100, Math.round(r.visibility_score)))]++;
      }
    }

    if (sampleSize < MIN_SAMPLE_SIZE) return null;

    return {
      composite,
      security,
      speed,
      foundations,
      reputation,
      discoverability,
      sample_size: sampleSize,
      computed_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Cache Layer ────────────────────────────────────────────────────

async function getCachedDistribution(kv: KVNamespace): Promise<PercentileDistribution | null> {
  try {
    const raw = await kv.get(KV_KEY, "text");
    if (!raw) return null;
    return JSON.parse(raw) as PercentileDistribution;
  } catch {
    return null;
  }
}

async function cacheDistribution(kv: KVNamespace, dist: PercentileDistribution): Promise<void> {
  try {
    await kv.put(KV_KEY, JSON.stringify(dist), { expirationTtl: KV_TTL_SECS });
  } catch {
    /* non-critical */
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/** Get or compute the percentile distribution (cached in KV). */
export async function getDistribution(env: Env): Promise<PercentileDistribution | null> {
  if (!env.REFERENCE_DATA) return computeDistribution(env.STATS_DB);

  // Try cache first
  const cached = await getCachedDistribution(env.REFERENCE_DATA);
  if (cached) return cached;

  // Compute fresh
  const dist = await computeDistribution(env.STATS_DB);
  if (dist) {
    await cacheDistribution(env.REFERENCE_DATA, dist);
  }
  return dist;
}

/** Look up percentiles for a given set of scores. */
export function lookupPercentiles(
  dist: PercentileDistribution,
  scores: {
    composite: number;
    security?: number | null;
    speed?: number | null;
    foundations?: number | null;
    reputation?: number | null;
    discoverability?: number | null;
  },
): PercentileData {
  return {
    composite: percentileRank(dist.composite, scores.composite),
    axes: {
      security: scores.security != null ? percentileRank(dist.security, scores.security) : null,
      speed: scores.speed != null ? percentileRank(dist.speed, scores.speed) : null,
      foundations: scores.foundations != null ? percentileRank(dist.foundations, scores.foundations) : null,
      reputation: scores.reputation != null ? percentileRank(dist.reputation, scores.reputation) : null,
      discoverability:
        scores.discoverability != null ? percentileRank(dist.discoverability, scores.discoverability) : null,
      email: null, // not tracked in D1
    },
    sample_size: dist.sample_size,
    computed_at: dist.computed_at,
  };
}

/** Convenience: get distribution + look up percentiles in one call. Returns null if insufficient data. */
export async function getPercentiles(
  env: Env,
  scores: {
    composite: number;
    security?: number | null;
    speed?: number | null;
    foundations?: number | null;
    reputation?: number | null;
    discoverability?: number | null;
  },
): Promise<PercentileData | null> {
  const dist = await getDistribution(env);
  if (!dist) return null;
  return lookupPercentiles(dist, scores);
}

/** Look up composite percentile only (for recent feed). */
export function lookupCompositePercentile(dist: PercentileDistribution, composite: number): number {
  return percentileRank(dist.composite, composite);
}

/** Inject percentile data into an analysis result object. Non-blocking, swallows errors. */
export async function injectPercentiles(data: Record<string, unknown>, env: Env): Promise<void> {
  try {
    const ds = data.domain_score as { composite?: number; axes?: Record<string, { score?: number }> } | undefined;
    if (ds?.composite != null && ds.axes) {
      const pctile = await getPercentiles(env, {
        composite: ds.composite,
        security: ds.axes.security?.score,
        speed: ds.axes.speed?.score,
        foundations: ds.axes.foundations?.score,
        reputation: ds.axes.reputation?.score,
        discoverability: ds.axes.discoverability?.score,
      });
      if (pctile) {
        data.percentiles = pctile;
      }
    }
  } catch {
    /* percentile injection is non-critical */
  }
}
