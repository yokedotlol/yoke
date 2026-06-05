// ─── Badge Routes ────────────────────────────────────────────────────
// GET /badge/<domain>.svg — Direct SVG badge
// GET /badge/<domain>.json — Shields.io endpoint JSON
//
// Pure KV reads — never triggers synchronous analysis.
// Background work for stale-while-revalidate and cold start.

import { AXIS_FULL, type BadgeCacheEntry, readBadgeCache } from "../badge-cache";
import { neutralBadgeOptions, renderBadgeSvg, scoreBadgeOptions } from "../badge-svg";
import { tierFromComposite } from "../config/signal-registry";
import type { Env } from "../helpers";
import { backgroundWork, CORS_HEADERS, cleanDomain, YOKE_VERSION } from "../helpers";
import { logInfo, logWarn } from "../logger";
import type { RouteContext } from "./shared";

/** Stale threshold: trigger background refresh after 20 hours */
const STALE_THRESHOLD_MS = 20 * 60 * 60 * 1000;

/** Lock TTL to prevent cache stampede (60 seconds) */
const PENDING_LOCK_TTL = 60;

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
    return new Response(JSON.stringify({ error: "Invalid domain format", code: "INVALID_DOMAIN" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Query params
  const axisParam = url.searchParams.get("axis");
  const labelParam = url.searchParams.get("label");
  const styleParam = url.searchParams.get("style") as "flat" | "flat-square" | null;
  const style = styleParam === "flat-square" ? "flat-square" : "flat";

  // White-label badge label
  const siteName = env.SITE_NAME || "Yoke";
  const defaultLabel = axisParam ? `${siteName} ${capitalize(axisParam)}` : siteName;
  const label = labelParam || defaultLabel;

  // Read badge cache — single KV get
  const cached = await readBadgeCache(domain, env);

  if (cached) {
    // Check staleness — trigger background refresh if > 20h old
    const age = Date.now() - new Date(cached.analyzedAt).getTime();
    if (age > STALE_THRESHOLD_MS) {
      triggerBackgroundAnalysis(domain, env);
    }

    // Resolve score: specific axis or composite
    const { score, tier } = resolveScore(cached, axisParam);

    // Track badge domain (non-blocking)
    trackBadgeDomain(domain, env);

    if (dotJson) {
      return shieldsJson(label, score, tier, cached.analyzedAt);
    }
    return svgResponse(scoreBadgeOptions(label, score, tier, style), cached.analyzedAt);
  }

  // Cache miss — neutral badge + trigger analysis
  trackBadgeDomain(domain, env);
  triggerBackgroundAnalysis(domain, env);

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
function shieldsJson(label: string, score: number | null, tier: string | null, analyzedAt: string | null): Response {
  const message = score != null && tier ? `${score} ${tier}` : "not yet scanned";
  const color = tier ? TIER_SHIELD_COLORS[tier] || "lightgrey" : "lightgrey";

  const body = {
    schemaVersion: 1,
    label,
    message,
    color,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "max-age=300, s-maxage=300",
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
    "Cache-Control": "max-age=300, s-maxage=300",
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
        logInfo("[yoke:badge] Background analysis triggered", { domain });
        await runAnalysis(domain, env, false);
      } catch (e) {
        logWarn("[yoke:badge] Background analysis failed", {
          domain,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })(),
  );
}

/** Track domain in badge_domains D1 table (non-blocking, self-healing) */
function trackBadgeDomain(domain: string, env: Env): void {
  backgroundWork(
    env,
    (async () => {
      if (!env.STATS_DB) return;
      const now = new Date().toISOString();
      try {
        await env.STATS_DB.prepare(
          `INSERT INTO badge_domains (domain, first_requested, last_requested, request_count)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(domain) DO UPDATE SET
             last_requested = excluded.last_requested,
             request_count = request_count + 1`,
        )
          .bind(domain, now, now)
          .run();
      } catch (e) {
        // Self-healing: create table if it doesn't exist
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("no such table")) {
          try {
            await env.STATS_DB.exec(
              `CREATE TABLE IF NOT EXISTS badge_domains (
                domain TEXT PRIMARY KEY,
                first_requested TEXT NOT NULL,
                last_requested TEXT NOT NULL,
                request_count INTEGER DEFAULT 1
              )`,
            );
            await env.STATS_DB.prepare(
              `INSERT INTO badge_domains (domain, first_requested, last_requested, request_count)
               VALUES (?, ?, ?, 1)
               ON CONFLICT(domain) DO UPDATE SET
                 last_requested = excluded.last_requested,
                 request_count = request_count + 1`,
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
