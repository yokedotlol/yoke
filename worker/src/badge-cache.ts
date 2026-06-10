// ─── Badge Cache ─────────────────────────────────────────────────────
// Read/write badge cache entries in KV. Badge cache is a separate derived
// key from the analysis cache — smaller payload, longer TTL (48h).
//
// KV key pattern: badge:<domain>
// Written as a side effect of every successful analysis via finalizeResult().

import type { Env } from "./helpers";
import { logWarn } from "./logger";

/** Compact badge cache payload stored in KV */
export interface BadgeCacheEntry {
  /** Composite score 0-100 */
  composite: number;
  /** Tier label (Excellent, Strong, Moderate, Weak, Critical) */
  tier: string;
  /** Per-axis scores (abbreviated keys for compactness) */
  axes: {
    sec: number;
    spd: number;
    fnd: number;
    rep: number;
    dsc: number;
    eml: number;
  };
  /** ISO timestamp of when the analysis was performed */
  analyzedAt: string;
}

/** Badge cache TTL in seconds (48 hours) */
const BADGE_CACHE_TTL = 48 * 60 * 60;

/** Axis name mapping: full → abbreviated */
const AXIS_ABBREV: Record<string, keyof BadgeCacheEntry["axes"]> = {
  security: "sec",
  speed: "spd",
  foundations: "fnd",
  reputation: "rep",
  discoverability: "dsc",
  email: "eml",
};

/** Reverse axis name mapping: abbreviated → full */
export const AXIS_FULL: Record<string, string> = {
  sec: "security",
  spd: "speed",
  fnd: "foundations",
  rep: "reputation",
  dsc: "discoverability",
  eml: "email",
};

/**
 * Write a badge cache entry to KV. Non-blocking, never throws.
 * Called from finalizeResult() as background work.
 */
export async function writeBadgeCache(
  domain: string,
  domainScore: { composite: number; tier: string; axes: Record<string, { score?: number }> },
  env: Env,
): Promise<void> {
  if (!env.REFERENCE_DATA) return;
  try {
    const axes = {} as BadgeCacheEntry["axes"];
    for (const [full, abbr] of Object.entries(AXIS_ABBREV)) {
      axes[abbr] = domainScore.axes[full]?.score ?? 0;
    }
    const entry: BadgeCacheEntry = {
      composite: domainScore.composite,
      tier: domainScore.tier,
      axes,
      analyzedAt: new Date().toISOString(),
    };
    await env.REFERENCE_DATA.put(`badge:${domain}`, JSON.stringify(entry), {
      expirationTtl: BADGE_CACHE_TTL,
    });
  } catch (e) {
    logWarn("[yoke:badge-cache] KV write failed", {
      domain,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Read a badge cache entry from KV. Returns null on miss or error.
 */
export async function readBadgeCache(domain: string, env: Env): Promise<BadgeCacheEntry | null> {
  if (!env.REFERENCE_DATA) return null;
  try {
    const raw = await env.REFERENCE_DATA.get(`badge:${domain}`);
    if (!raw) return null;
    return JSON.parse(raw) as BadgeCacheEntry;
  } catch {
    return null;
  }
}
