// SPA serving logic — ported from build_combined.py
// Handles: content negotiation, OG tag injection, security headers, static pages, asset passthrough

import { runAnalysis } from "./actions/analyze/core";
import { finalizeResult } from "./actions/analyze/finalize";
import { BudgetExceededError } from "./analysis-budget";
import { tierFromComposite } from "./config/signal-registry";
import type { Env } from "./helpers";
import {
  CORS_HEADERS,
  cleanDomain as cleanDomainHelper,
  getBaseUrl,
  getBranding,
  hashIp,
  MIN_CLIENT_VERSION,
  YOKE_VERSION,
} from "./helpers";
import { checkRateLimitAuto, timingSafeEq } from "./routes/shared";
import { trackUsage } from "./usage-tracking";

// ─── Security Headers ────────────────────────────────────────────────
// Applied to all HTML responses served by the worker.

export function getHtmlSecurityHeaders(baseUrl?: string): Record<string, string> {
  const connectSrc = baseUrl ? `'self' ${baseUrl}` : "'self'";
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "X-XSS-Protection": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), ambient-light-sensor=(), accelerometer=(), gyroscope=(), magnetometer=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'sha256-uc4Eo0eLbA2bnen9IAsmPVnrCkYfuaETrxr4nohh0Mk='; " +
      "style-src 'self' 'unsafe-inline'; " +
      `img-src 'self' data: https:; connect-src ${connectSrc} https://*.googleapis.com; ` +
      "font-src 'self'; frame-ancestors 'self' https://*.chromiumapp.org chrome-extension://*; base-uri 'self'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function htmlResponse(body: string, extra?: Record<string, string>, baseUrl?: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      ...getHtmlSecurityHeaders(baseUrl),
      ...extra,
    },
  });
}

function textResponse(body: string, contentType: string, cacheSeconds = 86400): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${cacheSeconds}`,
    },
  });
}

// ─── Content Negotiation ─────────────────────────────────────────────
// Determines whether a request wants JSON (API client) or HTML (browser).

const DOMAIN_PATH_RE =
  /^\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9-]+))$/;
// Matches /domain.tld/anything — used to strip trailing path segments
const DOMAIN_WITH_PATH_RE =
  /^\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9-]+))\/.+$/;
const COMPARE_PATH_RE =
  /^\/compare\/([a-zA-Z0-9][a-zA-Z0-9.-]+\.(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9-]+))\/([a-zA-Z0-9][a-zA-Z0-9.-]+\.(?:[a-zA-Z]{2,}|xn--[a-zA-Z0-9-]+))$/;

export function wantsJSON(request: Request): boolean {
  const accept = request.headers.get("Accept") || "";
  // Browsers send text/html — give them the SPA
  if (accept.includes("text/html")) return false;
  // Explicit JSON request
  if (accept.includes("application/json")) return true;
  // curl/wget/httpie/fetch send */* or nothing — give them JSON
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  if (
    ua.includes("curl") ||
    ua.includes("wget") ||
    ua.includes("httpie") ||
    ua.includes("python") ||
    ua.includes("node") ||
    ua.includes("go-http") ||
    ua.includes("ruby") ||
    ua.includes("java") ||
    ua.includes("php")
  )
    return true;
  // Link-preview fetchers (Signal, WhatsApp, Slack, IG, etc.) send Accept: */*
  // but need HTML with OG tags — catch them before the programmatic fallback
  if (
    ua.includes("signal") ||
    ua.includes("whatsapp") ||
    ua.includes("slackbot") ||
    ua.includes("slack-imgproxy") ||
    ua.includes("telegrambot") ||
    ua.includes("discordbot") ||
    ua.includes("linkedinbot") ||
    ua.includes("twitterbot") ||
    ua.includes("facebookexternalhit") ||
    ua.includes("facebot") ||
    ua.includes("instagram") || // Instagrambot + IG in-app browser
    ua.includes("fban") || // FB/IG app embedded browser (FBAN/FBIOS)
    ua.includes("fbav") || // FB/IG app version marker
    ua.includes("applebot") ||
    ua.includes("iframely") ||
    ua.includes("embedly") ||
    ua.includes("preview") ||
    ua.includes("googlebot") || // Google's crawler
    ua.includes("bingbot") || // Bing's crawler
    ua.includes("yandex") || // Yandex
    ua.includes("baiduspider") || // Baidu
    ua.includes("duckduckbot") || // DuckDuckGo
    ua.includes("pinterestbot") || // Pinterest
    ua.includes("redditbot") // Reddit
  )
    return false;
  // */* with no text/html preference = likely programmatic
  if (accept === "*/*" || accept === "") return true;
  return false;
}

export function matchDomainPath(path: string): string | null {
  const m = DOMAIN_PATH_RE.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/** Match /domain.tld/trailing-path — returns the domain portion only. */
export function matchDomainWithPath(path: string): string | null {
  const m = DOMAIN_WITH_PATH_RE.exec(path);
  return m ? m[1].toLowerCase() : null;
}

export function matchComparePath(path: string): [string, string] | null {
  const m = COMPARE_PATH_RE.exec(path);
  return m ? [m[1].toLowerCase(), m[2].toLowerCase()] : null;
}

// ─── OG Tag Injection ────────────────────────────────────────────────

/** Escape a string for safe injection into HTML attribute values. */
function escHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape a string for safe injection into HTML text content (e.g. <title>). */
function escHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function injectOgTags(html: string, opts: { title: string; description: string; url: string }): string {
  const title = escHtmlAttr(opts.title);
  const description = escHtmlAttr(opts.description);
  const url = escHtmlAttr(opts.url);
  const titleText = escHtmlText(opts.title);
  let h = html;
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${titleText}</title>`);
  h = h.replace(/property="og:title" content="[^"]*"/, `property="og:title" content="${title}"`);
  h = h.replace(/property="og:description" content="[^"]*"/, `property="og:description" content="${description}"`);
  h = h.replace(/property="og:url" content="[^"]*"/, `property="og:url" content="${url}"`);
  h = h.replace(/name="twitter:title" content="[^"]*"/, `name="twitter:title" content="${title}"`);
  h = h.replace(/name="twitter:description" content="[^"]*"/, `name="twitter:description" content="${description}"`);
  h = h.replace(/name="description" content="[^"]*"/, `name="description" content="${description}"`);
  h = h.replace(/rel="canonical" href="[^"]*"/, `rel="canonical" href="${url}"`);
  return h;
}

// ─── Index HTML Fetching ─────────────────────────────────────────────

async function getIndexHtml(env: Env, requestUrl: string): Promise<string> {
  const origin = new URL(requestUrl).origin;
  const resp = await env.ASSETS.fetch(new Request(`${origin}/index.html`));
  return resp.text();
}

// ─── SPA Route Handler ───────────────────────────────────────────────
// Handles non-API routes: static pages, domain paths with OG tags, and SPA fallback.
// Returns null if the route is not handled (caller should proceed to API routing).

export async function handleSPARoute(request: Request, env: Env, path: string): Promise<Response | null> {
  const method = request.method;
  const baseUrl = getBaseUrl(request, env);
  const brand = getBranding(request, env);

  // ── Static pages ──
  // Bluesky domain handle verification — proves yoke.lol owns this Bluesky account
  if (method === "GET" && path === "/.well-known/atproto-did") {
    return textResponse("did:plc:jx7ot6zjijwxh7phk7sv2taj", "text/plain;charset=UTF-8");
  }
  if (method === "GET" && path === "/install.sh") {
    return new Response("", {
      status: 302,
      headers: { Location: "https://raw.githubusercontent.com/yokedotlol/yoke/main/cli/install.sh" },
    });
  }
  // Client-side rendered pages — serve the SPA shell
  if (
    (method === "GET" || method === "HEAD") &&
    (path === "/" ||
      path === "/cli" ||
      path === "/about" ||
      path === "/docs" ||
      path === "/privacy" ||
      path === "/terms" ||
      path === "/status" ||
      false) // /usage handled by admin route, not SPA
  ) {
    const indexHtml = await getIndexHtml(env, request.url);
    const pageUrl = `${baseUrl}${path === "/" ? "" : path}`;
    const ogHtml = injectOgTags(indexHtml, {
      title:
        path === "/"
          ? `${brand.name} — Free Domain Intelligence & OSINT`
          : `${path.slice(1).charAt(0).toUpperCase() + path.slice(2)} — ${brand.name}`,
      description:
        "Free domain intelligence and OSINT tool. Analyze DNS, SSL, WHOIS, security headers, tech stack, performance, breach history, and more.",
      url: pageUrl,
    });
    return htmlResponse(ogHtml, { "Cache-Control": "no-cache" }, baseUrl);
  }

  // ── Domain path: content negotiation ──
  // GET /stripe.com → JSON for curl, SPA with OG tags for browsers
  const domainMatch = matchDomainPath(path);
  if (domainMatch && method === "GET") {
    // Skip paths that look like static files, not domains
    if (
      path.endsWith(".js") ||
      path.endsWith(".css") ||
      path.endsWith(".map") ||
      path.endsWith(".ico") ||
      path.endsWith(".png") ||
      path.endsWith(".svg") ||
      path.endsWith(".woff2") ||
      path.endsWith(".json")
    ) {
      return null; // let asset handler deal with it
    }

    if (wantsJSON(request)) {
      // Content negotiation: serve JSON analysis for API clients
      return serveDomainJSON(request, env, domainMatch);
    }

    // Browser: serve SPA with dynamic OG tags
    const indexHtml = await getIndexHtml(env, request.url);
    const domain = domainMatch;
    const ogHtml = injectOgTags(indexHtml, {
      title: `${domain} — ${brand.name} Domain Intelligence`,
      description: `Free domain intelligence report for ${domain} — DNS, SSL, WHOIS, security audit, tech stack, performance, and more.`,
      url: `${baseUrl}/${domain}`,
    });
    return htmlResponse(ogHtml, { "Cache-Control": "public, max-age=3600", Vary: "Accept" }, baseUrl);
  }

  // ── Compare path: SPA with OG tags ──
  const compareMatch = matchComparePath(path);
  if (compareMatch && method === "GET") {
    const [d1, d2] = compareMatch;
    const indexHtml = await getIndexHtml(env, request.url);
    const ogHtml = injectOgTags(indexHtml, {
      title: `${d1} vs ${d2} — ${brand.name} Domain Intelligence`,
      description: `Side-by-side domain comparison of ${d1} and ${d2} — security, performance, infrastructure, trust, and visibility scores.`,
      url: `${baseUrl}/compare/${d1}/${d2}`,
    });
    return htmlResponse(ogHtml, { "Cache-Control": "public, max-age=3600", Vary: "Accept" }, baseUrl);
  }

  // ── Domain with trailing path: /github.com/kurtpayne → redirect to /github.com ──
  const domainWithPathMatch = matchDomainWithPath(path);
  if (domainWithPathMatch && method === "GET") {
    return new Response(null, {
      status: 301,
      headers: { Location: `${baseUrl}/${domainWithPathMatch}` },
    });
  }

  // Not a SPA route we handle — return null to let caller continue
  return null;
}

// ─── Domain JSON (Content Negotiation) ───────────────────────────────

/** Standard JSON response headers for content-negotiated GET /{domain} path */
function jsonHeaders(baseUrl: string, isCached: boolean): Record<string, string> {
  return {
    "Content-Type": "application/json;charset=UTF-8",
    ...CORS_HEADERS,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "frame-ancestors 'self' https://*.chromiumapp.org chrome-extension://*",
    "X-Yoke-Cache": isCached ? "HIT" : "MISS",
    "X-Yoke-Version": YOKE_VERSION,
    "X-Yoke-Min-Client": MIN_CLIENT_VERSION,
    "X-Yoke-Docs": `${baseUrl}/api/docs`,
    "Cache-Control": "public, max-age=3600",
    Vary: "Accept",
  };
}

async function serveDomainJSON(request: Request, env: Env, domain: string): Promise<Response> {
  const url = new URL(request.url);
  const pretty = url.searchParams.has("pretty");
  const summary = url.searchParams.has("summary");
  const baseUrl = getBaseUrl(request, env);

  try {
    const clean = cleanDomainHelper(domain);
    if (!clean) {
      return new Response(JSON.stringify({ error: "Invalid domain format", code: "INVALID_DOMAIN", status: 400 }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // Rate limit the curl/JSON API. Shares the "/api/analyze" per-IP bucket so a
    // GET+POST combo can't double the effective ceiling. Admin key bypasses
    // (mirrors POST /api/analyze). The credit is only consumed on a cache MISS —
    // cached responses stay free, same as POST /api/analyze.
    const adminBypass = env.ADMIN_KEY && timingSafeEq(request.headers.get("X-Admin-Key") ?? "", env.ADMIN_KEY);
    let rl: Awaited<ReturnType<typeof checkRateLimitAuto>> | null = null;
    if (!adminBypass) {
      const ip = await hashIp(
        request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown",
        env,
      );
      rl = await checkRateLimitAuto(env.STATS_DB, ip, "/api/analyze", env);
      if (rl.blocked) return rl.blocked;
    }

    // Use the same runAnalysis + finalizeResult path as POST /api/analyze
    let coreResult: Awaited<ReturnType<typeof runAnalysis>>;
    try {
      coreResult = await runAnalysis(clean, env, false, undefined, "curl");
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return new Response(
          JSON.stringify({ error: "Analysis budget reached, try later", code: "BUDGET_EXCEEDED", status: 429 }),
          { status: 429, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
        );
      }
      throw err;
    }
    const resultData = coreResult.data as Record<string, unknown>;

    // Only consume rate-limit credit for non-cached results (cached stays free).
    if (rl && coreResult.kind !== "cached") await rl.record();

    // Shared enrichment: share URLs, badge URLs, percentiles, badge cache write
    await finalizeResult(clean, resultData, request, env);

    // Track usage — mirrors POST /api/analyze tracking
    trackUsage(env.STATS_DB, "analyze", !!env.DISABLE_ANALYTICS).catch(() => {});

    const isCached = coreResult.kind === "cached";

    // ── Summary mode: return compact ~500 byte response ──
    if (summary) {
      const domainScore = resultData.domain_score as
        | {
            composite?: number;
            tier?: string;
            axes?: Record<string, { score?: number }>;
            balance?: string;
            balanceStdDev?: number;
          }
        | undefined;
      const analyzedAt = (resultData.analyzed_at as string) || new Date().toISOString();
      const axes: Record<string, { score: number | null; tier: string }> = {};
      if (domainScore?.axes) {
        for (const [axis, info] of Object.entries(domainScore.axes)) {
          const axisInfo = info as { score?: number };
          const s = axisInfo.score ?? null;
          axes[axis] = { score: s, tier: s != null ? tierFromComposite(s) : "Unknown" };
        }
      }
      const summaryData = {
        domain: clean,
        score: {
          composite: domainScore?.composite ?? null,
          tier: domainScore?.tier ?? "Unknown",
          balance: domainScore?.balance ?? null,
          balanceStdDev: domainScore?.balanceStdDev ?? null,
        },
        axes,
        scanned_at: analyzedAt,
        full_results: `${baseUrl}/${clean}`,
        _meta: { summary: true, api_version: YOKE_VERSION, source: new URL(baseUrl).hostname },
      };
      const summaryBody = pretty ? JSON.stringify(summaryData, null, 2) : JSON.stringify(summaryData);
      return new Response(summaryBody, { headers: jsonHeaders(baseUrl, isCached) });
    }

    const body = pretty ? JSON.stringify(resultData, null, 2) : JSON.stringify(resultData);
    return new Response(body, { headers: jsonHeaders(baseUrl, isCached) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    return new Response(
      JSON.stringify({
        error: msg,
        code: "ANALYSIS_FAILED",
        status: 500,
        _meta: { api_version: YOKE_VERSION, docs: `${baseUrl}/api/docs` },
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
}

// ─── Asset Passthrough + SPA Fallback ────────────────────────────────
// Try serving from Wrangler assets; if no match, serve index.html for client-side routing.

export async function serveAssetOrFallback(request: Request, env: Env): Promise<Response> {
  const baseUrl = getBaseUrl(request, env);
  const url = new URL(request.url);
  const path = url.pathname;

  // Try serving the exact asset
  const assetResp = await env.ASSETS.fetch(request);

  // If we got a valid asset response, return it (with security headers for HTML)
  if (assetResp.ok) {
    const ct = assetResp.headers.get("content-type") || "";

    // BIMI logo needs cross-origin access for email clients
    if (path === "/bimi-logo.svg") {
      return new Response(assetResp.body, {
        status: assetResp.status,
        headers: {
          ...Object.fromEntries(assetResp.headers.entries()),
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    if (ct.includes("text/html")) {
      // Clone and add security headers + consistent cache policy
      return new Response(assetResp.body, {
        status: assetResp.status,
        headers: {
          ...Object.fromEntries(assetResp.headers.entries()),
          ...getHtmlSecurityHeaders(baseUrl),
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Apply aggressive caching for content-hashed assets and fonts
    const isHashedAsset = /\/assets\/[^/]+-[a-z0-9]{8,}\.\w+$/.test(path);
    const isFont = path.startsWith("/fonts/") && path.endsWith(".woff2");
    if (isHashedAsset || isFont) {
      return new Response(assetResp.body, {
        status: assetResp.status,
        headers: {
          ...Object.fromEntries(assetResp.headers.entries()),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    return assetResp;
  }

  // No matching asset — SPA fallback: serve index.html for client-side routing
  const indexHtml = await getIndexHtml(env, request.url);
  return htmlResponse(indexHtml, { "Cache-Control": "no-cache" }, baseUrl);
}
