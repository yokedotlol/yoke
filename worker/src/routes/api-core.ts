// Core API routes: analyze, compare, subdomains, subdomain-scan, suggestions
import { runAnalysis } from "../actions/analyze/core";
import { analyzeDomainStream } from "../actions/analyze-stream";
import { compareDomains } from "../actions/compare";
import { scanSubdomains } from "../actions/subdomain-scan";
import { getSubdomains } from "../actions/subdomains";
import { getDomainSuggestions } from "../actions/suggestions";
import { CORS_HEADERS, cleanDomain, getBaseUrl } from "../helpers";
import { buildPdfUrl } from "../pdf-route";
import { injectPercentiles } from "../percentiles";
import { buildShareUrl } from "../share";
import { trackUsage } from "../usage-tracking";
import { addHeaders, checkRateLimit, json, parseBody, type RouteContext, rateLimitNoop, timingSafeEq } from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, url, path, method, env, clientIP, track: _track } = rc;

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
    await trackUsage(env.STATS_DB, "analyze", !!env.DISABLE_ANALYTICS);
    // Support SSE streaming when client requests it
    const wantsStream = request.headers.get("Accept") === "text/event-stream";
    if (wantsStream) {
      // Streaming always does real work — record the rate limit hit
      await rl.record();
      _track("analyze", 200, domain);
      return analyzeDomainStream(domain, env, request, skipCache, rl.headers);
    }
    const coreResult = await runAnalysis(domain, env, skipCache);
    // Only consume rate-limit credit for non-cached results
    if (coreResult.kind !== "cached") await rl.record();

    // Inject share_url into _meta if scoring data is available
    const resultData = coreResult.data as Record<string, unknown>;
    const ds = resultData.domain_score as
      | { composite?: number; tier?: string; axes?: Record<string, { score?: number }> }
      | undefined;
    if (ds?.composite != null && ds.tier && ds.axes) {
      const analyzedAt = (resultData.analyzed_at as string) || new Date().toISOString();
      const shareUrl = await buildShareUrl(
        domain,
        ds.composite,
        ds.tier,
        ds.axes,
        analyzedAt,
        getBaseUrl(request, env),
        env,
      );
      if (shareUrl) {
        resultData._meta = {
          ...((resultData._meta as Record<string, unknown>) || {}),
          share_url: shareUrl,
        };
      }

      // Inject pdf_url alongside share_url
      const pdfUrl = await buildPdfUrl(domain, analyzedAt, getBaseUrl(request, env), env);
      if (pdfUrl) {
        resultData._meta = {
          ...((resultData._meta as Record<string, unknown>) || {}),
          pdf_url: pdfUrl,
        };
      }
    }

    // Inject percentiles (non-blocking lookup, swallow errors)
    await injectPercentiles(resultData, env);

    const resp = new Response(JSON.stringify(resultData), {
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
    await trackUsage(env.STATS_DB, "compare", !!env.DISABLE_ANALYTICS);
    await rl.record();
    const resp = await compareDomains({ domain1: d1, domain2: d2 }, env);
    _track("compare", resp.status, d1);
    return addHeaders(resp, rl.headers);
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
    await trackUsage(env.STATS_DB, "subdomains", !!env.DISABLE_ANALYTICS);
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
    await trackUsage(env.STATS_DB, "subdomains", !!env.DISABLE_ANALYTICS);
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
    await trackUsage(env.STATS_DB, "subdomain-scan", !!env.DISABLE_ANALYTICS);
    _track("subdomain-scan", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  // POST /api/suggestions
  if (method === "POST" && path === "/api/suggestions") {
    const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/suggestions", env);
    if (rl.blocked) return rl.blocked;
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain) return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
    const result = await getDomainSuggestions(body.domain, env);
    await rl.record();
    await trackUsage(env.STATS_DB, "suggestions", !!env.DISABLE_ANALYTICS);
    _track("suggestions", 200, body.domain);
    return addHeaders(json(result), rl.headers);
  }

  return null; // not handled
}
