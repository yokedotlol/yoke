// SPA serving logic — ported from build_combined.py
// Handles: content negotiation, OG tag injection, security headers, static pages, asset passthrough

import type { Env } from "./helpers";
import { getBaseUrl, YOKE_VERSION } from "./helpers";
import { ABOUT_HTML, PRIVACY_HTML, SECURITY_TXT, TERMS_HTML } from "./pages";

// ─── Security Headers ────────────────────────────────────────────────
// Applied to all HTML responses served by the worker.

export function getHtmlSecurityHeaders(baseUrl?: string): Record<string, string> {
  const connectSrc = baseUrl ? `'self' ${baseUrl}` : "'self'";
  return {
    "X-Content-Type-Options": "nosniff",
    "X-XSS-Protection": "0",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), ambient-light-sensor=(), accelerometer=(), gyroscope=(), magnetometer=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      `img-src 'self' data: https:; connect-src ${connectSrc} https://*.googleapis.com; ` +
      "font-src 'self'; frame-ancestors 'self' https://*.chromiumapp.org; base-uri 'self'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Frame-Options": "SAMEORIGIN",
  };
}

// Default headers for backward compat (used by serveAssetOrFallback before request context is available)
export const HTML_SECURITY_HEADERS: Record<string, string> = getHtmlSecurityHeaders();

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

  // ── Static pages ──
  if (method === "GET" && (path === "/.well-known/security.txt" || path === "/security.txt")) {
    return textResponse(SECURITY_TXT, "text/plain;charset=UTF-8");
  }
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
  if ((method === "GET" || method === "HEAD") && path === "/privacy") {
    return htmlResponse(PRIVACY_HTML, { "Cache-Control": "public, max-age=86400" }, baseUrl);
  }
  if ((method === "GET" || method === "HEAD") && path === "/terms") {
    return htmlResponse(TERMS_HTML, { "Cache-Control": "public, max-age=86400" }, baseUrl);
  }
  if ((method === "GET" || method === "HEAD") && path === "/about") {
    return htmlResponse(ABOUT_HTML, { "Cache-Control": "public, max-age=86400" }, baseUrl);
  }
  // Client-side rendered pages — serve the SPA shell
  if ((method === "GET" || method === "HEAD") && (path === "/cli" || path === "/status" || path === "/usage")) {
    const indexHtml = await getIndexHtml(env, request.url);
    return htmlResponse(indexHtml, { "Cache-Control": "public, max-age=1800" }, baseUrl);
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
      path.endsWith(".woff2")
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
      title: `${domain} — Yoke Domain Intelligence`,
      description: `Free domain intelligence report for ${domain} — DNS, SSL, WHOIS, security audit, tech stack, performance, and more.`,
      url: `${baseUrl}/${domain}`,
    });
    return htmlResponse(ogHtml, { "Cache-Control": "public, max-age=1800", Vary: "Accept" }, baseUrl);
  }

  // ── Compare path: SPA with OG tags ──
  const compareMatch = matchComparePath(path);
  if (compareMatch && method === "GET") {
    const [d1, d2] = compareMatch;
    const indexHtml = await getIndexHtml(env, request.url);
    const ogHtml = injectOgTags(indexHtml, {
      title: `${d1} vs ${d2} — Yoke Domain Intelligence`,
      description: `Side-by-side domain comparison of ${d1} and ${d2} — security, performance, infrastructure, trust, and visibility scores.`,
      url: `${baseUrl}/compare/${d1}/${d2}`,
    });
    return htmlResponse(ogHtml, { "Cache-Control": "public, max-age=1800", Vary: "Accept" }, baseUrl);
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

async function serveDomainJSON(request: Request, env: Env, domain: string): Promise<Response> {
  const url = new URL(request.url);
  const pretty = url.searchParams.has("pretty");
  const baseUrl = getBaseUrl(request, env);

  try {
    // Reuse the existing analyze endpoint by synthesizing a POST request.
    // We import dynamically to avoid circular dependency issues — the analyze
    // function is already wired up in index.ts, so we call the worker itself
    // via internal routing. But to keep it simple, we directly import.
    const { analyzeDomain } = await import("./actions/analyze");
    const { cleanDomain } = await import("./helpers");

    const clean = cleanDomain(domain);
    if (!clean) {
      return jsonResponse({ error: "Invalid domain format" }, 400);
    }

    const analyzeResp = await analyzeDomain(clean, env, false);
    const data = await analyzeResp.json();

    // Add _meta field
    (data as Record<string, unknown>)._meta = {
      api_version: YOKE_VERSION,
      analyzed_at: new Date().toISOString(),
      docs: `${baseUrl}/api/docs`,
      source: new URL(baseUrl).hostname,
    };

    const body = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    const isCached = !!(data as Record<string, unknown>).cached;

    return new Response(body, {
      status: analyzeResp.status,
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "X-Yoke-Cache": isCached ? "HIT" : "MISS",
        "X-Yoke-Version": YOKE_VERSION,
        "X-Yoke-Docs": `${baseUrl}/api/docs`,
        "Cache-Control": "public, max-age=1800",
        Vary: "Accept",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    return jsonResponse({ error: msg, _meta: { api_version: YOKE_VERSION, docs: `${baseUrl}/api/docs` } }, 500);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── Asset Passthrough + SPA Fallback ────────────────────────────────
// Try serving from Wrangler assets; if no match, serve index.html for client-side routing.

export async function serveAssetOrFallback(request: Request, env: Env): Promise<Response> {
  // Try serving the exact asset
  const assetResp = await env.ASSETS.fetch(request);

  // If we got a valid asset response, return it (with security headers for HTML)
  if (assetResp.ok) {
    const ct = assetResp.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      // Clone and add security headers + consistent cache policy
      return new Response(assetResp.body, {
        status: assetResp.status,
        headers: {
          ...Object.fromEntries(assetResp.headers.entries()),
          ...HTML_SECURITY_HEADERS,
          "Cache-Control": "public, max-age=1800",
        },
      });
    }

    // Apply aggressive caching for content-hashed assets and fonts
    const url = new URL(request.url);
    const path = url.pathname;
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
  return htmlResponse(indexHtml, { "Cache-Control": "public, max-age=1800" });
}
