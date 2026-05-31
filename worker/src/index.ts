// Minimal Cloudflare Worker router — no external dependencies
// Replaces Hono with a tiny hand-rolled router for zero-dependency deployment

import { buildAIPrompt, getAIAnalysis } from "./actions/ai-analysis";
import { AXIS_WEIGHTS } from "./actions/analyze/contextual-scoring";
import { runAnalysis } from "./actions/analyze/core";
import { analyzeDomainStream } from "./actions/analyze-stream";
import { checkGlobalAvailability } from "./actions/availability";
import { getCompanyInfo } from "./actions/company";
import { compareDomains } from "./actions/compare";
import { getNews } from "./actions/news";
import { getRecentLookups } from "./actions/recent";
import { getReverseIP } from "./actions/reverse-ip";
import { getSocialAccounts } from "./actions/social";
import { scanSubdomains } from "./actions/subdomain-scan";
import { getSubdomains } from "./actions/subdomains";
import { getDomainSuggestions } from "./actions/suggestions";
import { getApiHealth } from "./api-errors";
import { ALL_THRESHOLDS, SEVERITY_SCORES } from "./config/scoring-thresholds";
import { EFFORT_MAP, FIX_DESC_MAP, NON_ACTIONABLE_SIGNALS, TIER_THRESHOLDS } from "./config/signal-registry";
import { loadData } from "./data/kv-loader";
import type { VulnerableLibrary } from "./data/vulnerable-libraries";
import { scanForVulnerableLibraries, VULNERABLE_LIBRARIES } from "./data/vulnerable-libraries";
import type { Env } from "./helpers";

import {
  boundedText,
  CORS_HEADERS,
  cleanDomain,
  getBaseUrl,
  getFromCache,
  safeFetchWithRedirects,
  YOKE_VERSION,
} from "./helpers";
import { logError } from "./logger";
import { getApiDocsHtml } from "./pages";
import { trackRequest } from "./request-tracking";
import {
  handleCompareOgImage,
  handleCompareSharePage,
  handleOgImage,
  handleSharePage,
  handleShareSign,
  matchCompareOgImagePath,
  matchCompareSharePath,
  matchOgImagePath,
  matchSharePath,
} from "./share";
import { getHtmlSecurityHeaders, handleSPARoute, serveAssetOrFallback, wantsJSON } from "./spa";
import { renderStatusPage } from "./status-page";
import { renderUsagePage } from "./usage-page";
import { getUsageStats, trackUsage } from "./usage-tracking";

// ─── Rate Limiting ──────────────────────────────────────────────────

function getRateLimits(env: Env): Record<string, { limit: number; windowSecs: number }> {
  return {
    "/api/analyze": { limit: parseInt(env.RATE_LIMIT_ANALYZE || "50", 10), windowSecs: 3600 },
    "/api/compare": { limit: parseInt(env.RATE_LIMIT_COMPARE || "50", 10), windowSecs: 3600 },
    "/api/subdomain-scan": { limit: parseInt(env.RATE_LIMIT_SUBDOMAIN || "30", 10), windowSecs: 3600 },
    "/api/subdomains": { limit: 50, windowSecs: 3600 },
    "/api/company": { limit: 50, windowSecs: 3600 },
    "/api/news": { limit: 50, windowSecs: 3600 },
    "/api/social": { limit: 50, windowSecs: 3600 },
    "/api/reverse-ip": { limit: 50, windowSecs: 3600 },
    "/api/availability": { limit: parseInt(env.RATE_LIMIT_AVAILABILITY || "60", 10), windowSecs: 3600 },
    "/api/js-audit": { limit: 20, windowSecs: 3600 },
  };
}

let rateLimitTableReady = false;

async function ensureRateLimitTable(db: D1Database): Promise<void> {
  if (rateLimitTableReady) return;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS endpoint_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, endpoint TEXT NOT NULL, ts INTEGER NOT NULL)",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_endpoint_rate_ip_ts ON endpoint_rate_limits(ip, endpoint, ts)"),
  ]);
  rateLimitTableReady = true;
}

// In-memory block cache: skip D1 queries for IPs already known to be rate-limited.
// Key: "ip:endpoint", Value: unix timestamp when the block expires.
// Lives only within a single Worker isolate — no cross-isolate leakage.
const blockCache = new Map<string, number>();

interface RateLimitResult {
  blocked: Response | null;
  headers: Record<string, string>;
  /** Call after the endpoint finishes to record the rate-limit hit.
   *  Skip this call for cached results so cache hits don't burn credits. */
  record: () => Promise<void>;
}

const rateLimitNoop = async () => {};

async function checkRateLimit(db: D1Database, ip: string, endpoint: string, env: Env): Promise<RateLimitResult> {
  const limits = getRateLimits(env);
  const config = limits[endpoint];
  if (!config || config.limit === 0) return { blocked: null, headers: {}, record: rateLimitNoop };

  // Fast path: if this IP+endpoint is in the block cache, return 429 without touching D1
  const cacheKey = `${ip}:${endpoint}`;
  const now = Math.floor(Date.now() / 1000);
  const cachedResetAt = blockCache.get(cacheKey);
  if (cachedResetAt && cachedResetAt > now) {
    const secsLeft = cachedResetAt - now;
    const rlHeaders = {
      "X-RateLimit-Limit": String(config.limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(cachedResetAt),
      "Retry-After": String(secsLeft),
    };
    return {
      blocked: new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          code: "RATE_LIMITED",
          limit: config.limit,
          remaining: 0,
          reset: cachedResetAt,
          window: `${config.windowSecs / 3600} hour`,
          retry_after: secsLeft,
          self_host: "https://github.com/yokedotlol/yoke#self-hosting",
          message: "For heavy usage, self-host Yoke with no limits. See our setup guide.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
            ...rlHeaders,
          },
        },
      ),
      headers: rlHeaders,
      record: rateLimitNoop,
    };
  } else if (cachedResetAt) {
    blockCache.delete(cacheKey); // expired, clean up
  }

  try {
    await ensureRateLimitTable(db);
    const cutoff = now - config.windowSecs;
    // Get count + oldest request in window (to calculate real reset time)
    const [countRow, oldestRow] = await db.batch([
      db
        .prepare("SELECT COUNT(*) as cnt FROM endpoint_rate_limits WHERE ip = ? AND endpoint = ? AND ts > ?")
        .bind(ip, endpoint, cutoff),
      db
        .prepare("SELECT MIN(ts) as oldest FROM endpoint_rate_limits WHERE ip = ? AND endpoint = ? AND ts > ?")
        .bind(ip, endpoint, cutoff),
    ]);
    const count = (countRow.results?.[0] as { cnt: number } | undefined)?.cnt ?? 0;
    const oldest = (oldestRow.results?.[0] as { oldest: number | null } | undefined)?.oldest;
    // Reset = when the oldest request in the window expires (sliding window)
    const resetAt = oldest ? oldest + config.windowSecs : now + config.windowSecs;

    if (count >= config.limit) {
      // Cache the block so subsequent requests skip D1 entirely
      blockCache.set(cacheKey, resetAt);
      const rlHeaders = {
        "X-RateLimit-Limit": String(config.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetAt),
        "Retry-After": String(Math.max(1, resetAt - now)),
      };
      return {
        blocked: new Response(
          JSON.stringify({
            error: "Rate limit exceeded",
            code: "RATE_LIMITED",
            limit: config.limit,
            remaining: 0,
            reset: resetAt,
            window: `${config.windowSecs / 3600} hour`,
            retry_after: config.windowSecs,
            self_host: "https://github.com/yokedotlol/yoke#self-hosting",
            message: "For heavy usage, self-host Yoke with no limits. See our setup guide.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              ...CORS_HEADERS,
              ...rlHeaders,
            },
          },
        ),
        headers: rlHeaders,
        record: rateLimitNoop,
      };
    }
    // Defer recording — callers invoke record() after determining the result isn't cached
    const recordHit = async () => {
      try {
        await db
          .prepare("INSERT INTO endpoint_rate_limits (ip, endpoint, ts) VALUES (?, ?, ?)")
          .bind(ip, endpoint, now)
          .run();
        // Probabilistic cleanup: 2% chance, delete entries older than 2 hours
        if (Math.random() < 0.02) {
          const old = now - 7200;
          await db
            .prepare("DELETE FROM endpoint_rate_limits WHERE ts < ?")
            .bind(old)
            .run()
            .catch(() => {});
        }
      } catch {
        // Best-effort — don't fail the request if recording fails
      }
    };
    const remaining = config.limit - count; // don't subtract 1 yet — record() hasn't been called
    return {
      blocked: null,
      headers: {
        "X-RateLimit-Limit": String(config.limit),
        "X-RateLimit-Remaining": String(Math.max(0, remaining)),
        "X-RateLimit-Reset": String(resetAt),
      },
      record: recordHit,
    };
  } catch (err) {
    logError("rate limit DB error", { error: err instanceof Error ? err.message : String(err) });
    // Fail-open for general endpoints (they don't cost money)
  }
  return { blocked: null, headers: {}, record: rateLimitNoop };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Clone a response with additional headers (used for rate-limit metadata) */
function addHeaders(resp: Response, extra: Record<string, string>): Response {
  if (!Object.keys(extra).length) return resp;
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

/** JSON response without CORS headers — used for admin-only endpoints. */
function adminJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
  });
}

async function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

/** Constant-time string comparison to prevent timing side-channels. */
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Verify admin Basic auth. Returns null if valid, or a Response to return if invalid. */
function checkAdminAuth(request: Request, adminKey: string | undefined): Response | null {
  if (!adminKey)
    return new Response(JSON.stringify({ error: "Admin key not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Basic ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Basic realm="Yoke Admin"' },
    });
  }
  let pass: string;
  try {
    const decoded = atob(authHeader.slice(6));
    [, pass] = decoded.split(":");
  } catch {
    return new Response(JSON.stringify({ error: "Malformed credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Basic realm="Yoke Admin"' },
    });
  }
  if (!pass || !timingSafeEq(pass, adminKey)) {
    return new Response(JSON.stringify({ error: "Invalid credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Basic realm="Yoke Admin"' },
    });
  }
  return null; // auth passed
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Thread execution context for background work
    if (ctx) env._ctx = ctx;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      const allowHeaders = "Content-Type";
      return new Response(null, {
        status: 204,
        headers: { ...CORS_HEADERS, "Access-Control-Allow-Headers": allowHeaders },
      });
    }

    // Static content routes (SEO + LLMO) — URLs derived from request origin
    const baseUrl = getBaseUrl(request, env);
    const host = new URL(baseUrl).hostname;

    // security.txt — vulnerability disclosure contact
    if (method === "GET" && (path === "/.well-known/security.txt" || path === "/security.txt")) {
      return new Response(
        `Contact: mailto:hello@${host}\nExpires: 2027-06-01T00:00:00.000Z\nPreferred-Languages: en\nCanonical: ${baseUrl}/.well-known/security.txt`,
        {
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
            "Cache-Control": "public, max-age=86400",
            ...CORS_HEADERS,
          },
        },
      );
    }

    if (method === "GET" && path === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml`, {
        headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400", ...CORS_HEADERS },
      });
    }

    if (method === "GET" && path === "/sitemap.xml") {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${baseUrl}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>${baseUrl}/about</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n  <url><loc>${baseUrl}/api/docs</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>\n  <url><loc>${baseUrl}/status</loc><changefreq>hourly</changefreq><priority>0.5</priority></url>\n  <url><loc>${baseUrl}/privacy</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n  <url><loc>${baseUrl}/terms</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n</urlset>`,
        {
          headers: {
            "Content-Type": "application/xml;charset=UTF-8",
            "Cache-Control": "public, max-age=86400",
            ...CORS_HEADERS,
          },
        },
      );
    }

    if (method === "GET" && path === "/llms.txt") {
      return new Response(
        `# Yoke — Free Domain Intelligence & OSINT Tool\n\n> Yoke is a free, open-source domain intelligence tool at ${baseUrl}\n\n## What Yoke Does\n\nYoke provides instant, comprehensive analysis of any internet domain. Enter a domain name and get detailed intelligence across security, infrastructure, technology, performance, and business dimensions.\n\n## Key Capabilities\n\n- DNS Analysis: A, AAAA, MX, NS, TXT, CNAME, SOA records with DNSSEC validation\n- SSL/TLS: Certificate details, chain validation, TLS configuration grading, CAA records\n- WHOIS/RDAP: Registrar, registration and expiry dates, domain age\n- Security Audit: HTTP security headers, cookie security\n- Data Breaches: HIBP breach detection with time-decay scoring\n- Threat Intelligence: Shodan port/vulnerability data, GreyNoise IP classification\n- Technology Detection: Frameworks, CMS, CDN, WAF, deep WordPress fingerprinting\n- Email Authentication: SPF, DKIM, DMARC validation\n- Performance: Google PageSpeed, Core Web Vitals (mobile-first 60/40 blend), compression\n- Certificate Transparency: CT log monitoring for subdomain discovery\n- Business Intelligence: Company enrichment via Wikidata, Brandfetch, Crunchbase\n- AI Analysis: LLM-powered analysis from 6 expert personas\n\n## Free JSON API\n\nNo authentication required.\n\ncurl ${host}/stripe.com | jq\ncurl "${host}/stripe.com?pretty"\ncurl -s ${host}/stripe.com | jq '.ssl'\n\n## Links\n\n- Web UI: ${baseUrl}\n- API Docs: ${baseUrl}/api/docs\n- Chrome Extension: Chrome Web Store\n- Source: https://github.com/yokedotlol/yoke\n- License: MIT`,
        {
          headers: {
            "Content-Type": "text/plain;charset=UTF-8",
            "Cache-Control": "public, max-age=86400",
            ...CORS_HEADERS,
          },
        },
      );
    }

    // Status page — server-rendered, public
    if ((method === "GET" || method === "HEAD") && path === "/status") {
      return renderStatusPage(env.STATS_DB, baseUrl);
    }

    // Usage dashboard — admin-only, basic auth with ADMIN_KEY secret
    if (path === "/usage" || path === "/api/usage") {
      const authErr = checkAdminAuth(request, env.ADMIN_KEY);
      if (authErr) return authErr;
      const days = parseInt(url.searchParams.get("days") ?? "30", 10);
      const stats = await getUsageStats(env.STATS_DB, days);
      if (path === "/api/usage") return adminJson(stats);
      return renderUsagePage(env.STATS_DB, days);
    }

    // ── Share card routes ──
    // GET /r/:token — report card page with OG tags
    const shareMatch = method === "GET" ? matchSharePath(path) : null;
    if (shareMatch) {
      return handleSharePage(request, env, shareMatch);
    }
    // GET /og/:token.svg — dynamic OG image
    const ogMatch = method === "GET" ? matchOgImagePath(path) : null;
    if (ogMatch) {
      return handleOgImage(request, env, ogMatch);
    }

    // ── Compare share card routes ──
    // GET /c/:token — compare report card page with OG tags
    const compareShareMatch = method === "GET" ? matchCompareSharePath(path) : null;
    if (compareShareMatch) {
      return handleCompareSharePage(request, env, compareShareMatch);
    }
    // GET /cog/:token.png — dynamic compare OG image
    const compareOgMatch = method === "GET" ? matchCompareOgImagePath(path) : null;
    if (compareOgMatch) {
      return handleCompareOgImage(request, env, compareOgMatch);
    }

    // ── SPA routes: static pages, domain paths with content negotiation, compare paths ──
    const spaResponse = await handleSPARoute(request, env, path);
    if (spaResponse) return spaResponse;

    // API routes
    if (path.startsWith("/api/")) {
      const clientIP =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown";
      const _t0 = Date.now();
      const _track = (endpoint: string, status: number, domain?: string) => {
        trackRequest(env, request, { endpoint, domain, status, latencyMs: Date.now() - _t0 });
      };
      try {
        // POST /api/analyze
        if (method === "POST" && path === "/api/analyze") {
          // Admin key bypasses rate limit (for batch calibration / internal tools)
          const adminBypass = env.ADMIN_KEY && timingSafeEq(request.headers.get("X-Admin-Key") ?? "", env.ADMIN_KEY);
          const rl = adminBypass
            ? { blocked: null, headers: {}, record: rateLimitNoop }
            : await checkRateLimit(env.STATS_DB, clientIP, "/api/analyze", env);
          if (rl.blocked) {
            _track("analyze", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain?: string; force?: boolean }>(request);
          if (!body.domain || typeof body.domain !== "string")
            return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          const skipCache = body.force === true;
          await trackUsage(env.STATS_DB, "analyze");
          // Support SSE streaming when client requests it
          const wantsStream = request.headers.get("Accept") === "text/event-stream";
          if (wantsStream) {
            // Streaming always does real work — record the rate limit hit
            await rl.record();
            _track("analyze", 200, domain);
            return analyzeDomainStream(domain, env, skipCache, rl.headers);
          }
          const coreResult = await runAnalysis(domain, env, skipCache);
          // Only consume rate-limit credit for non-cached results
          if (coreResult.kind !== "cached") await rl.record();
          const resp = new Response(JSON.stringify(coreResult.data), {
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          });
          _track("analyze", resp.status, domain);
          return addHeaders(resp, rl.headers);
        }

        // POST /api/compare
        if (method === "POST" && path === "/api/compare") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/compare", env);
          if (rl.blocked) {
            _track("compare", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain1?: string; domain2?: string }>(request);
          if (!body.domain1 || !body.domain2)
            return json({ error: "domain1 and domain2 are required", code: "MISSING_DOMAIN" }, 400);
          const d1 = cleanDomain(body.domain1);
          const d2 = cleanDomain(body.domain2);
          if (!d1 || !d2) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          await trackUsage(env.STATS_DB, "compare");
          await rl.record();
          const resp = await compareDomains({ domain1: d1, domain2: d2 }, env);
          _track("compare", resp.status, d1);
          return addHeaders(resp, rl.headers);
        }

        // GET /api/recent — internal, capped at 8 results for homepage
        if (method === "GET" && path === "/api/recent") {
          const result = await getRecentLookups(env.REFERENCE_DATA!, 8);
          return json(result);
        }

        // POST /api/subdomains
        if (method === "POST" && path === "/api/subdomains") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/subdomains", env);
          if (rl.blocked) {
            _track("subdomains", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain?: string }>(request);
          if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          const result = await getSubdomains(env.REFERENCE_DATA!, domain, env.STATS_DB);
          if (!result.cached) await rl.record();
          await trackUsage(env.STATS_DB, "subdomains");
          _track("subdomains", 200, domain);
          return addHeaders(json(result), rl.headers);
        }

        // GET /api/subdomains?domain=X — subdomain enumeration (GET alias)
        if (method === "GET" && path === "/api/subdomains") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/subdomains", env);
          if (rl.blocked) {
            _track("subdomains", 429);
            return rl.blocked;
          }
          const domain = cleanDomain(url.searchParams.get("domain") || "");
          if (!domain)
            return json(
              {
                error: "domain query parameter is required (e.g., /api/subdomains?domain=example.com)",
                code: "MISSING_DOMAIN",
              },
              400,
            );
          const result = await getSubdomains(env.REFERENCE_DATA!, domain, env.STATS_DB);
          if (!result.cached) await rl.record();
          await trackUsage(env.STATS_DB, "subdomains");
          _track("subdomains", 200, domain);
          return addHeaders(json(result), rl.headers);
        }

        // POST /api/subdomain-scan
        if (method === "POST" && path === "/api/subdomain-scan") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/subdomain-scan", env);
          if (rl.blocked) {
            _track("subdomain-scan", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain?: string }>(request);
          if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          const result = await scanSubdomains(env.REFERENCE_DATA!, domain);
          if (!result.cached) await rl.record();
          await trackUsage(env.STATS_DB, "subdomain-scan");
          _track("subdomain-scan", 200, domain);
          return addHeaders(json(result), rl.headers);
        }

        // POST /api/company
        if (method === "POST" && path === "/api/company") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/company", env);
          if (rl.blocked) {
            _track("company", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain?: string; force?: boolean }>(request);
          if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          const result = await getCompanyInfo(env.REFERENCE_DATA!, domain, body.force, env.STATS_DB);
          if (!result.cached) await rl.record();
          await trackUsage(env.STATS_DB, "company");
          _track("company", 200, domain);
          return addHeaders(json(result), rl.headers);
        }

        // POST /api/news
        if (method === "POST" && path === "/api/news") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/news", env);
          if (rl.blocked) {
            _track("news", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain?: string }>(request);
          if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          const result = await getNews(env.REFERENCE_DATA!, domain, env.STATS_DB);
          if (!result.cached) await rl.record();
          await trackUsage(env.STATS_DB, "news");
          _track("news", 200, domain);
          return addHeaders(json(result), rl.headers);
        }

        // POST /api/social
        if (method === "POST" && path === "/api/social") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/social", env);
          if (rl.blocked) {
            _track("social", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain?: string }>(request);
          if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          const result = await getSocialAccounts(env.REFERENCE_DATA!, domain, env);
          if (!result.cached) await rl.record();
          await trackUsage(env.STATS_DB, "social");
          _track("social", 200, domain);
          return addHeaders(json(result), rl.headers);
        }

        // POST /api/reverse-ip
        if (method === "POST" && path === "/api/reverse-ip") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/reverse-ip", env);
          if (rl.blocked) {
            _track("reverse-ip", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ ip?: string }>(request);
          if (!body.ip) return json({ error: "ip is required", code: "MISSING_IP" }, 400);
          const ip = body.ip.trim();
          // Validate IPv4 or IPv6 format
          const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
          const ipv6Re = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
          if (!ipv4Re.test(ip) && !ipv6Re.test(ip)) {
            return json({ error: "Invalid IP address format" }, 400);
          }
          const result = await getReverseIP(env.REFERENCE_DATA!, ip);
          if (!result.cached) await rl.record();
          await trackUsage(env.STATS_DB, "reverse-ip");
          _track("reverse-ip", 200);
          return addHeaders(json(result), rl.headers);
        }

        // POST /api/availability
        if (method === "POST" && path === "/api/availability") {
          const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/availability", env);
          if (rl.blocked) {
            _track("availability", 429);
            return rl.blocked;
          }
          const body = await parseBody<{ domain?: string }>(request);
          if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          // CF Workers expose request.cf with IncomingRequestCfProperties
          const cf = (request as Request & { cf?: { colo?: string; country?: string; city?: string } }).cf;
          const result = await checkGlobalAvailability(
            domain,
            { colo: cf?.colo, country: cf?.country, city: cf?.city },
            env,
          );
          await rl.record();
          await trackUsage(env.STATS_DB, "availability");
          _track("availability", 200, domain);
          return addHeaders(json(result), rl.headers);
        }

        // POST /api/suggestions
        if (method === "POST" && path === "/api/suggestions") {
          const body = await parseBody<{ domain?: string }>(request);
          if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const result = await getDomainSuggestions(body.domain, env);
          await trackUsage(env.STATS_DB, "suggestions");
          _track("suggestions", 200, body.domain);
          return json(result);
        }

        // POST /api/ai-analysis — AI-powered domain analysis (10/hr per IP)
        if (method === "POST" && path === "/api/ai-analysis") {
          await trackUsage(env.STATS_DB, "ai-analysis");
          const body = await parseBody<{ domain?: string; stream?: boolean; model?: string }>(request);
          if (!body.domain || typeof body.domain !== "string")
            return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          _track("ai-analysis", 200, domain);
          // BYO API key passthrough — when present, use the client's OpenRouter key
          const byoKey = request.headers.get("X-OpenRouter-Key") || undefined;
          const byoModel = body.model || undefined;
          return getAIAnalysis(domain, env, { clientIP, stream: !!body.stream, ctx, byoKey, byoModel });
        }

        // POST /api/ai-prompt — returns the assembled prompt for the prompt editor (no LLM call)
        if (method === "POST" && path === "/api/ai-prompt") {
          const body = await parseBody<{ domain?: string }>(request);
          if (!body.domain || typeof body.domain !== "string")
            return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          const domain = cleanDomain(body.domain);
          if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
          const normalized = domain.toLowerCase();
          const analysisCache = (await getFromCache(
            env.REFERENCE_DATA!,
            normalized,
            "analysis",
            60 * 60 * 1000,
          )) as Record<string, unknown> | null;
          if (!analysisCache) {
            return json({ error: "Domain not yet analyzed. Run a standard analysis first." }, 400);
          }
          const prompt = buildAIPrompt(analysisCache);
          return json(prompt);
        }

        // GET /api/health — API error observability dashboard
        if (method === "GET" && path === "/api/health") {
          const health = await getApiHealth(env.STATS_DB);
          return json(health);
        }

        // POST /api/share-sign — sign a share card payload
        if (method === "POST" && path === "/api/share-sign") {
          return handleShareSign(request, env);
        }

        // POST /api/track-tab — anonymous tab view analytics
        if (method === "POST" && path === "/api/track-tab") {
          const body = await parseBody<{ domain?: string; tab?: string }>(request);
          if (!body.tab) return json({ error: "tab required" }, 400);
          try {
            await env.STATS_DB.prepare("INSERT INTO tab_views (tab, domain, ts) VALUES (?, ?, ?)")
              .bind(body.tab, body.domain || "", Date.now())
              .run();
          } catch (e: unknown) {
            if (e instanceof Error && e.message?.includes("no such table")) {
              await env.STATS_DB.exec(
                "CREATE TABLE IF NOT EXISTS tab_views (id INTEGER PRIMARY KEY AUTOINCREMENT, tab TEXT NOT NULL, domain TEXT, ts INTEGER NOT NULL)",
              );
              await env.STATS_DB.exec("CREATE INDEX IF NOT EXISTS idx_tab_views_tab ON tab_views(tab, ts)");
              await env.STATS_DB.prepare("INSERT INTO tab_views (tab, domain, ts) VALUES (?, ?, ?)")
                .bind(body.tab, body.domain || "", Date.now())
                .run();
            }
          }
          return json({ ok: true });
        }

        // GET /api/js-audit?domain=x — deep JS vulnerability scan
        // POST /api/js-audit {domain} — deep JS vulnerability scan
        if ((method === "GET" || method === "POST") && path === "/api/js-audit") {
          const adminBypass = env.ADMIN_KEY && timingSafeEq(request.headers.get("X-Admin-Key") ?? "", env.ADMIN_KEY);
          const rl = adminBypass
            ? { blocked: null, headers: {}, record: rateLimitNoop }
            : await checkRateLimit(env.STATS_DB, clientIP, "/api/js-audit", env);
          if (rl.blocked) {
            _track("js-audit", 429);
            return rl.blocked;
          }

          let domain: string | null = null;
          if (method === "GET") {
            domain = url.searchParams.get("domain");
          } else {
            const body = await parseBody<{ domain?: string }>(request);
            domain = body.domain ?? null;
          }
          if (!domain || typeof domain !== "string") {
            return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
          }
          domain = cleanDomain(domain);

          // Fetch the page HTML
          let html = "";
          try {
            const resp = await safeFetchWithRedirects(`https://${domain}`, {
              headers: { "User-Agent": "YokeBot/1.0 (+https://yoke.lol)" },
              timeout: 10_000,
            });
            if (resp.ok) {
              html = await boundedText(resp, 5 * 1024 * 1024);
            }
          } catch (_) {
            // Site unreachable — return empty scan
          }

          if (!html) {
            return addHeaders(
              json({
                domain,
                error: null,
                libraries_found: [],
                total_scripts_scanned: 0,
                scan_date: new Date().toISOString(),
                database: "inline-curated",
                note: "Could not fetch page HTML — site may be unreachable",
              }),
              rl.headers,
            );
          }

          // Try KV for extended vulnerability DB, fall back to inline
          let dbSource = "inline-curated";
          const kvLibs = env.REFERENCE_DATA
            ? await loadData<VulnerableLibrary[]>(env.REFERENCE_DATA, "vulnerable-libraries")
            : null;
          if (kvLibs) dbSource = "kv-reference";

          // Scan using the inline curated library scanner
          const results = scanForVulnerableLibraries(html);

          await rl.record();
          _track("js-audit", 200);
          return addHeaders(
            json({
              domain,
              libraries_found: results.map((r) => ({
                name: r.library,
                version: r.version,
                vulnerable: r.cves.length > 0,
                cves: r.cves,
                severity: r.severity,
                eol: r.eol || false,
              })),
              total_libraries_checked: VULNERABLE_LIBRARIES.length,
              scan_date: new Date().toISOString(),
              database: dbSource,
            }),
            rl.headers,
          );
        }

        // GET /api/scoring — transparent scoring methodology
        if (method === "GET" && path === "/api/scoring") {
          return json(
            {
              description:
                "Yoke domain scoring methodology. All thresholds, weights, and severity mappings used to calculate the 6-category composite score.",
              axis_weights: AXIS_WEIGHTS,
              severity_scores: SEVERITY_SCORES,
              tier_thresholds: TIER_THRESHOLDS,
              non_actionable_signals: NON_ACTIONABLE_SIGNALS,
              effort_map: EFFORT_MAP,
              fix_desc_map: FIX_DESC_MAP,
              thresholds: ALL_THRESHOLDS,
              archetype_note:
                "Anchor-and-adjust scoring: baseline 55, penalties scale by severity×weight (critical -4, high -2.5, medium -1.25, low -0.5), good bonus = 2×weight. Composite uses weighted geometric mean over assessed axes (penalizes weak categories). No per-category hard caps; breach tier cap retained (recent breaches >100M pwned cap at Strong). Categories with <3 scoreable findings are 'Not Assessed' and excluded from composite with weight re-normalization. Tier thresholds: Excellent≥90, Strong≥75, Moderate≥60, Weak≥40, Critical<40. Categories: Security (0.24), Speed (0.18), Foundations (0.18), Reputation (0.15), Discoverability (0.13), Email (0.12).",
            },
            200,
          );
        }

        // DELETE /api/cache/:domain — purge cached analysis for a domain (admin-only)
        // DELETE /api/cache?type=ai_analysis — purge all AI analysis cache (admin-only)
        if (method === "DELETE" && (path.startsWith("/api/cache/") || path === "/api/cache")) {
          const authErr = checkAdminAuth(request, env.ADMIN_KEY);
          if (authErr) return authErr;

          // Bulk type-based purge: DELETE /api/cache?type=ai_analysis
          const cacheType = url.searchParams.get("type");
          if (path === "/api/cache" && cacheType && env.REFERENCE_DATA) {
            try {
              // KV: list all keys with the cache type prefix and delete them
              const prefix = `cache:${cacheType}:`;
              let cursor: string | undefined;
              let deleted = 0;
              do {
                const list = await env.REFERENCE_DATA.list({ prefix, cursor, limit: 1000 });
                for (const key of list.keys) {
                  await env.REFERENCE_DATA.delete(key.name);
                  deleted++;
                }
                cursor = list.list_complete ? undefined : list.cursor;
              } while (cursor);
              return adminJson({ ok: true, type: cacheType, deleted });
            } catch (_e) {
              return adminJson({ error: "Failed to clear cache" }, 500);
            }
          }

          const domain = cleanDomain(path.replace("/api/cache/", ""));
          if (!domain) return adminJson({ error: "Invalid domain" }, 400);
          if (env.REFERENCE_DATA) {
            try {
              // Delete all cache entries for this domain
              const prefix = `cache:`;
              let cursor: string | undefined;
              let deleted = 0;
              do {
                const list = await env.REFERENCE_DATA.list({ prefix, cursor, limit: 1000 });
                for (const key of list.keys) {
                  if (key.name.endsWith(`:${domain}`)) {
                    await env.REFERENCE_DATA.delete(key.name);
                    deleted++;
                  }
                }
                cursor = list.list_complete ? undefined : list.cursor;
              } while (cursor);
              return adminJson({ ok: true, domain, message: `Cache cleared (${deleted} keys)` });
            } catch (_e) {
              return adminJson({ error: "Failed to clear cache" }, 500);
            }
          }
          return adminJson({ ok: true, domain, message: "No KV namespace available" });
        }

        // GET /api/cleanup — scheduled D1 cleanup (admin-only)
        // Deletes old cache entries (>7 days) and expired rate limit records.
        // Can be called via cron or manually.
        if (method === "GET" && path === "/api/cleanup") {
          const authErr = checkAdminAuth(request, env.ADMIN_KEY);
          if (authErr) return authErr;
          const cutoff1d = Date.now() - 24 * 60 * 60 * 1000;
          const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const results: Record<string, string> = {};
          // KV cache: TTL handles expiry automatically — no manual cleanup needed
          results.domain_cache = "KV TTL handles expiry automatically";
          results.domain_lookups = "Recent lookups maintained as KV JSON array";
          try {
            const rlRes = await env.STATS_DB.prepare(
              "DELETE FROM ai_rate_limits WHERE date < date('now', '-1 day')",
            ).run();
            results.ai_rate_limits = `${rlRes.meta?.changes ?? "?"} expired rows deleted`;
          } catch (e) {
            results.ai_rate_limits = `error: ${e instanceof Error ? e.message : String(e)}`;
          }
          try {
            const rlRes2 = await env.STATS_DB.prepare("DELETE FROM endpoint_rate_limits WHERE ts < ?")
              .bind(cutoff1d)
              .run();
            results.endpoint_rate_limits = `${rlRes2.meta?.changes ?? "?"} expired rows deleted`;
          } catch (e) {
            results.endpoint_rate_limits = `error: ${e instanceof Error ? e.message : String(e)}`;
          }
          try {
            const errRes = await env.STATS_DB.prepare("DELETE FROM api_errors WHERE ts < ?").bind(cutoff7d).run();
            results.api_errors = `${errRes.meta?.changes ?? "?"} rows deleted (>7 days old)`;
          } catch (e) {
            results.api_errors = `error: ${e instanceof Error ? e.message : String(e)}`;
          }
          // request_meta: infinite retention — no pruning
          return adminJson({ ok: true, cleaned_at: new Date().toISOString(), results });
        }

        // GET /api/docs — serve HTML for browsers, JSON for API clients
        if (method === "GET" && path === "/api/docs") {
          const accept = request.headers.get("Accept") || "";
          if (accept.includes("text/html")) {
            return new Response(getApiDocsHtml(host), {
              headers: {
                "Content-Type": "text/html;charset=UTF-8",
                "Cache-Control": "public, max-age=3600",
                ...getHtmlSecurityHeaders(baseUrl),
              },
            });
          }
          return json({
            name: "Yoke Domain Intelligence API",
            version: YOKE_VERSION,
            endpoints: {
              "GET /{domain}": {
                description: "Full domain analysis (content negotiation: JSON for curl/API clients, HTML for browsers)",
                rate_limit: "50 req/hr",
              },
              "POST /api/analyze": {
                description:
                  "Full domain analysis. Supports SSE streaming (Accept: text/event-stream) or JSON response.",
                body: '{"domain": "example.com"}',
                rate_limit: "50 req/hr",
              },
              "POST /api/compare": {
                description: "Compare two domains side-by-side",
                body: '{"domain1": "a.com", "domain2": "b.com"}',
                rate_limit: "50 req/hr",
              },
              "POST /api/subdomains": {
                description: "Subdomain enumeration via certificate transparency logs",
                body: '{"domain": "example.com"}',
                rate_limit: "50 req/hr",
              },
              "GET /api/subdomains?domain=example.com": {
                description: "Subdomain enumeration (GET variant)",
                rate_limit: "50 req/hr",
              },
              "POST /api/subdomain-scan": {
                description: "Active subdomain DNS scan — resolves discovered subdomains",
                body: '{"domain": "example.com"}',
                rate_limit: "30 req/hr",
              },
              "POST /api/ai-analysis": {
                description:
                  "AI-powered domain analysis from 6 expert personas. Requires OpenRouter API key via X-OpenRouter-Key header or server-side config.",
                body: '{"domain": "example.com", "model": "optional-model-id"}',
                rate_limit: "none (API-key gated)",
              },
              "POST /api/company": {
                description: "Company/business info via Wikidata, Brandfetch, Crunchbase",
                body: '{"domain": "example.com"}',
                rate_limit: "50 req/hr",
              },
              "POST /api/news": {
                description: "Recent news articles about the domain",
                body: '{"domain": "example.com"}',
                rate_limit: "50 req/hr",
              },
              "POST /api/social": {
                description: "Social media account discovery",
                body: '{"domain": "example.com"}',
                rate_limit: "50 req/hr",
              },
              "POST /api/suggestions": {
                description: "Domain suggestions based on analysis",
                body: '{"domain": "example.com"}',
                rate_limit: "none",
              },
              "POST /api/availability": {
                description: "Global availability check from multiple regions",
                body: '{"domain": "example.com"}',
                rate_limit: "60 req/hr",
              },
              "POST /api/reverse-ip": {
                description: "Reverse IP lookup — other domains on the same IP",
                body: '{"ip": "1.2.3.4"}',
                rate_limit: "50 req/hr",
              },
              "GET /api/js-audit?domain=example.com": {
                description: "Deep JS vulnerability scan — detects outdated/vulnerable client-side libraries",
                rate_limit: "20 req/hr",
              },
              "GET /api/health": {
                description: "Health check",
                rate_limit: "none",
              },
              "GET /api/scoring": {
                description: "Scoring methodology — all thresholds, weights, and severity bands",
                rate_limit: "none",
              },
              "GET /api/recent": {
                description: "Recently analyzed domains",
                rate_limit: "none",
              },
            },
            examples: {
              curl_simple: `curl ${host}/stripe.com`,
              curl_pretty: `curl '${host}/stripe.com?pretty' | less`,
              curl_jq: `curl -s ${host}/stripe.com | jq '.ssl'`,
              curl_post: `curl -X POST ${host}/api/analyze -H 'Content-Type: application/json' -d '{"domain":"stripe.com"}'`,
            },
            source: baseUrl,
          });
        }

        return json({ error: "Not found", code: "NOT_FOUND" }, 404);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Internal server error";
        // Return 400 for JSON parse errors (malformed request body)
        const status = err instanceof SyntaxError ? 400 : 500;
        return json({ error: msg }, status);
      }
    }

    // ── Non-API routes: serve static assets or SPA fallback ──
    // With ASSETS binding, all requests come through the worker.
    // Try serving the exact asset; fall back to index.html for client-side routing.

    // Catch-all: if a non-browser client hits an unrecognized path that doesn't look like a static asset,
    // return a JSON error instead of SPA HTML (helps curl users who mistype domains)
    if (wantsJSON(request) && !path.includes(".")) {
      return json(
        { error: "Invalid domain format", hint: "Use a fully-qualified domain name (e.g., example.com)" },
        400,
      );
    }

    return serveAssetOrFallback(request, env);
  },
};
