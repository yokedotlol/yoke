// ─── Badge Routes ────────────────────────────────────────────────────
// GET /badge/<domain>.svg — Direct SVG badge
// GET /badge/<domain>.json — Shields.io endpoint JSON
//
// Pure KV reads — never triggers synchronous analysis.
// Background work for stale-while-revalidate and cold start.

import { AXIS_FULL, type BadgeCacheEntry, readBadgeCache, writeBadgeCache } from "../badge-cache";
import { neutralBadgeOptions, renderBadgeSvg, scoreBadgeOptions } from "../badge-svg";
import { tierFromComposite } from "../config/signal-registry";
import type { Env } from "../helpers";
import { backgroundWork, CORS_HEADERS, cleanDomain, YOKE_VERSION } from "../helpers";
import { logInfo, logWarn } from "../logger";
import type { RouteContext } from "./shared";

// TODO(badge): serve-time SSL/cliff eval — deferred, needs cert notAfter in badge payload

/** Default refresh-on-view interval in hours (env: BADGE_REFRESH_INTERVAL_HRS). */
const DEFAULT_REFRESH_INTERVAL_HRS = 6;

/** Default stale-decay window in days (env: BADGE_STALE_DAYS). */
const DEFAULT_STALE_DAYS = 30;

/** Lock TTL to prevent cache stampede (60 seconds) */
const PENDING_LOCK_TTL = 60;

/** Refresh-on-view threshold (ms): re-analyze an already-scanned domain after this age. */
function refreshThresholdMs(env: Env): number {
  const hrs = env.BADGE_REFRESH_INTERVAL_HRS ? Number.parseInt(env.BADGE_REFRESH_INTERVAL_HRS, 10) : Number.NaN;
  return (Number.isFinite(hrs) && hrs > 0 ? hrs : DEFAULT_REFRESH_INTERVAL_HRS) * 60 * 60 * 1000;
}

/** Stale-decay threshold (ms): serve "stale — re-scan" once a badge is older than this. */
function staleThresholdMs(env: Env): number {
  const days = env.BADGE_STALE_DAYS ? Number.parseInt(env.BADGE_STALE_DAYS, 10) : Number.NaN;
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_STALE_DAYS) * 24 * 60 * 60 * 1000;
}

/**
 * Cache-Control for a scored badge (analyzedAt present): 1h fresh, then serve
 * stale while revalidating for up to a day. A zone-level CF Cache Rule on
 * /badge/* (respect_origin) honours these origin TTLs at the edge.
 */
const SCORED_CACHE_CONTROL = "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

/**
 * Cache-Control for a cold/neutral badge (analyzedAt null, i.e. "not yet
 * scanned"): kept short so a freshly-scanned domain's badge flips to a real
 * score within ~a minute instead of being stuck for an hour.
 */
const NEUTRAL_CACHE_CONTROL = "public, max-age=60, s-maxage=60";

/** Pick the Cache-Control header value based on whether the badge is scored. */
function cacheControlFor(analyzedAt: string | null): string {
  return analyzedAt ? SCORED_CACHE_CONTROL : NEUTRAL_CACHE_CONTROL;
}

/** Tier → shields.io color name mapping */
const TIER_SHIELD_COLORS: Record<string, string> = {
  Excellent: "brightgreen",
  Strong: "green",
  Moderate: "yellow",
  Weak: "orange",
  Critical: "red",
};

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { path, method, url, env } = rc;

  if (method !== "GET") return null;
  if (!path.startsWith("/badge/")) return null;

  // Parse: /badge/<domain>.<ext>
  const rest = path.slice("/badge/".length);
  const dotSvg = rest.endsWith(".svg");
  const dotJson = rest.endsWith(".json");
  if (!dotSvg && !dotJson) return null;

  const rawDomain = rest.slice(0, dotSvg ? -4 : -5);
  const domain = cleanDomain(rawDomain);
  if (!domain) {
    return new Response(JSON.stringify({ error: "Invalid domain format", code: "INVALID_DOMAIN", status: 400 }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Query params
  const axisParam = url.searchParams.get("axis");
  const labelParam = url.searchParams.get("label");
  const styleParam = url.searchParams.get("style") as "flat" | "flat-square" | null;
  const style = styleParam === "flat-square" ? "flat-square" : "flat";

  // Validate axis parameter if provided
  const VALID_AXES = new Set(["security", "speed", "foundations", "reputation", "discoverability", "email"]);
  if (axisParam && !VALID_AXES.has(axisParam.toLowerCase())) {
    return new Response(
      JSON.stringify({
        error: `Invalid axis: "${axisParam}". Valid axes: ${[...VALID_AXES].join(", ")}`,
        code: "INVALID_AXIS",
        status: 400,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      },
    );
  }

  // White-label badge label
  const siteName = env.SITE_NAME || "Yoke";
  const defaultLabel = axisParam ? `${siteName} ${capitalize(axisParam)}` : siteName;
  const label = labelParam || defaultLabel;

  const refreshMs = refreshThresholdMs(env);
  const staleMs = staleThresholdMs(env);

  // Read badge cache — single KV get
  const cached = await readBadgeCache(domain, env);

  if (cached) {
    const age = Date.now() - new Date(cached.analyzedAt).getTime();

    // Stale-decay: a long-untouched badge no longer reflects reality — serve a
    // neutral "stale — re-scan" badge rather than a misleading old score.
    if (age > staleMs) {
      if (dotJson) return shieldsJson(label, null, null, null, "stale — re-scan");
      return svgResponse(neutralBadgeOptions(label, style, "stale — re-scan"), null);
    }

    // Refresh-on-view: this domain was legitimately analyzed (badge cache exists),
    // so a demand-driven refresh is allowed once it ages past the interval.
    if (age > refreshMs) {
      triggerBackgroundAnalysis(domain, env);
    }

    // Resolve score: specific axis or composite
    const { score, tier } = resolveScore(cached, axisParam);

    // Track badge domain (non-blocking) — only for already-analyzed domains.
    trackBadgeDomain(domain, env);

    if (dotJson) {
      return shieldsJson(label, score, tier, cached.analyzedAt);
    }
    return svgResponse(scoreBadgeOptions(label, score, tier, style), cached.analyzedAt);
  }

  // Badge cache miss — try analysis cache before returning "not yet scanned"
  const fromAnalysis = await readAnalysisCacheScore(domain, env);
  if (fromAnalysis) {
    const age = Date.now() - new Date(fromAnalysis.analyzedAt).getTime();

    // Stale-decay applies to the analysis-cache path too.
    if (age > staleMs) {
      if (dotJson) return shieldsJson(label, null, null, null, "stale — re-scan");
      return svgResponse(neutralBadgeOptions(label, style, "stale — re-scan"), null);
    }

    // Write badge cache in the background so next request is fast
    backgroundWork(env, writeBadgeCache(domain, fromAnalysis, env));
    trackBadgeDomain(domain, env);

    // Refresh-on-view: already analyzed, so a demand-driven refresh is allowed.
    if (age > refreshMs) {
      triggerBackgroundAnalysis(domain, env);
    }

    const { score, tier } = resolveScoreFromRaw(fromAnalysis, axisParam);
    if (dotJson) {
      return shieldsJson(label, score, tier, fromAnalysis.analyzedAt);
    }
    return svgResponse(scoreBadgeOptions(label, score, tier, style), fromAnalysis.analyzedAt);
  }

  // True cold start — no badge cache, no analysis cache. PURE READ:
  // serve a neutral "not yet scanned" badge. Do NOT trigger analysis and do NOT
  // seed badge_domains — a crafted badge URL must not provoke an expensive scan.
  if (dotJson) {
    return shieldsJson(label, null, null, null);
  }
  return svgResponse(neutralBadgeOptions(label, style), null);
}

/** Resolve score from cache: specific axis or composite */
function resolveScore(cached: BadgeCacheEntry, axisParam: string | null): { score: number; tier: string } {
  if (axisParam) {
    // Try abbreviated key first, then full name mapping
    const abbr = Object.entries(AXIS_FULL).find(([, full]) => full === axisParam.toLowerCase())?.[0];
    if (abbr && abbr in cached.axes) {
      const score = cached.axes[abbr as keyof typeof cached.axes];
      return { score, tier: tierFromComposite(score) };
    }
  }
  return { score: cached.composite, tier: cached.tier };
}

/** Return shields.io endpoint JSON */
function shieldsJson(
  label: string,
  score: number | null,
  tier: string | null,
  analyzedAt: string | null,
  neutralMessage = "not yet scanned",
): Response {
  const message = score != null && tier ? `${score} ${tier}` : neutralMessage;
  const color = tier ? TIER_SHIELD_COLORS[tier] || "lightgrey" : "lightgrey";

  const body = {
    schemaVersion: 1,
    label,
    message,
    color,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": cacheControlFor(analyzedAt),
    "X-Yoke-Version": YOKE_VERSION,
    ...CORS_HEADERS,
  };

  if (analyzedAt) {
    headers.ETag = `"${score}-${new Date(analyzedAt).getTime()}"`;
  }

  return new Response(JSON.stringify(body), { headers });
}

/** Return SVG badge response */
function svgResponse(opts: ReturnType<typeof scoreBadgeOptions>, analyzedAt: string | null): Response {
  const svg = renderBadgeSvg(opts);

  const headers: Record<string, string> = {
    "Content-Type": "image/svg+xml",
    "Cache-Control": cacheControlFor(analyzedAt),
    "X-Yoke-Version": YOKE_VERSION,
    ...CORS_HEADERS,
  };

  if (analyzedAt) {
    const score = opts.message.split(" ")[0];
    headers.ETag = `"${score}-${new Date(analyzedAt).getTime()}"`;
  }

  return new Response(svg, { headers });
}

/** Trigger background analysis (non-blocking, with stampede lock) */
function triggerBackgroundAnalysis(domain: string, env: Env): void {
  backgroundWork(
    env,
    (async () => {
      if (!env.REFERENCE_DATA) return;

      // Stampede lock: skip if another request already triggered analysis
      const lockKey = `badge-pending:${domain}`;
      const existing = await env.REFERENCE_DATA.get(lockKey);
      if (existing) return;

      try {
        await env.REFERENCE_DATA.put(lockKey, "1", { expirationTtl: PENDING_LOCK_TTL });
      } catch {
        return; // KV unavailable, skip
      }

      try {
        // Dynamic import to avoid circular dependency
        const { runAnalysis } = await import("../actions/analyze/core");
        const { BudgetExceededError } = await import("../analysis-budget");
        logInfo("[yoke:badge] Background analysis triggered", { domain });
        try {
          // source="badge" → counts toward the badge bucket; over-budget is silently skipped.
          await runAnalysis(domain, env, false, undefined, "badge");
        } catch (e) {
          if (e instanceof BudgetExceededError) {
            logInfo("[yoke:badge] Refresh skipped — global budget reached", { domain });
            return; // serve stale; do not surface an error
          }
          throw e;
        }
      } catch (e) {
        logWarn("[yoke:badge] Background analysis failed", {
          domain,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })(),
  );
}

/** Track domain in badge_domains D1 table (non-blocking, self-healing).
 *
 *  Uses INSERT OR IGNORE — records each domain once on first-seen only. The
 *  previous per-hit `ON CONFLICT … DO UPDATE` (bumping last_requested /
 *  request_count on every badge request) was removed because:
 *    (a) it was a D1 write on the hot path — the expensive op per badge hit; and
 *    (b) it was already inaccurate once badges are edge-cached (cached hits
 *        never reach the origin), so the counts under-reported real traffic.
 *  Real usage analytics should come from Cloudflare Analytics / logs instead.
 *  The badge sweep only needs the domain list, not live per-hit counts. */
function trackBadgeDomain(domain: string, env: Env): void {
  backgroundWork(
    env,
    (async () => {
      if (!env.STATS_DB) return;
      const now = new Date().toISOString();
      try {
        await env.STATS_DB.prepare(
          `INSERT OR IGNORE INTO badge_domains (domain, first_requested, last_requested, request_count)
           VALUES (?, ?, ?, 1)`,
        )
          .bind(domain, now, now)
          .run();
      } catch (e) {
        // Self-healing: create table if it doesn't exist
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("no such table")) {
          try {
            await env.STATS_DB.exec(
              `CREATE TABLE IF NOT EXISTS badge_domains (domain TEXT PRIMARY KEY, first_requested TEXT NOT NULL, last_requested TEXT NOT NULL, request_count INTEGER DEFAULT 1)`,
            );
            await env.STATS_DB.prepare(
              `INSERT OR IGNORE INTO badge_domains (domain, first_requested, last_requested, request_count)
               VALUES (?, ?, ?, 1)`,
            )
              .bind(domain, now, now)
              .run();
          } catch {
            logWarn("[yoke:badge] Failed to create badge_domains table", { domain });
          }
        }
      }
    })(),
  );
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** Score data extracted from analysis cache */
interface AnalysisCacheScore {
  composite: number;
  tier: string;
  axes: Record<string, { score?: number }>;
  analyzedAt: string;
}

/** Read score data from analysis cache when badge cache misses.
 *  This handles the case where a domain was analyzed before badges existed. */
async function readAnalysisCacheScore(domain: string, env: Env): Promise<AnalysisCacheScore | null> {
  if (!env.REFERENCE_DATA) return null;
  try {
    const raw = await env.REFERENCE_DATA.get(`cache:analysis:${domain}`, "text");
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { data: Record<string, unknown>; cached_at: number };
    const ds = envelope.data?.domain_score as
      | { composite?: number; tier?: string; axes?: Record<string, { score?: number }> }
      | undefined;
    if (!ds?.composite || !ds.tier || !ds.axes) return null;
    const analyzedAt = (envelope.data?.analyzed_at as string) || new Date(envelope.cached_at).toISOString();
    return {
      composite: ds.composite,
      tier: ds.tier,
      axes: ds.axes,
      analyzedAt,
    };
  } catch {
    return null;
  }
}

/** Resolve score from raw analysis cache data */
function resolveScoreFromRaw(data: AnalysisCacheScore, axisParam: string | null): { score: number; tier: string } {
  if (axisParam) {
    const axisKey = axisParam.toLowerCase();
    if (axisKey in data.axes) {
      const score = data.axes[axisKey]?.score ?? 0;
      return { score, tier: tierFromComposite(score) };
    }
  }
  return { score: data.composite, tier: data.tier };
}
