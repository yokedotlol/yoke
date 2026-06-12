// Core API routes: analyze, compare, subdomains, subdomain-scan, suggestions

import { runAnalysis } from "../actions/analyze/core";
import { finalizeResult } from "../actions/analyze/finalize";
import { analyzeDomainStream } from "../actions/analyze-stream";
import { compareDomains } from "../actions/compare";
import { scanSubdomains } from "../actions/subdomain-scan";
import { getSubdomains } from "../actions/subdomains";
import { getDomainSuggestions } from "../actions/suggestions";
import { BudgetExceededError, recordEndpointHit } from "../analysis-budget";
import { CORS_HEADERS, cleanDomain } from "../helpers";
import {
  addHeaders,
  checkRateLimitAuto,
  json,
  jsonError,
  parseBody,
  type RouteContext,
  rateLimitNoop,
  timingSafeEq,
} from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, url, path, method, env, clientIP, track: _track } = rc;

  // POST /api/analyze
  if (method === "POST" && path === "/api/analyze") {
    // Admin key bypasses rate limit (for batch calibration / internal tools)
    const adminBypass = env.ADMIN_KEY && timingSafeEq(request.headers.get("X-Admin-Key") ?? "", env.ADMIN_KEY);
    const rl = adminBypass
      ? { blocked: null, headers: {}, record: rateLimitNoop }
      : await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/analyze", env);
    if (rl.blocked) {
      _track("analyze", 429);
      return rl.blocked;
    }
    const body = await parseBody<{ domain?: string; force?: boolean }>(request);
    if (!body.domain || typeof body.domain !== "string") return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    const skipCache = body.force === true;
    recordEndpointHit(env, "analyze");
    // Support SSE streaming when client requests it
    const wantsStream = request.headers.get("Accept") === "text/event-stream";
    if (wantsStream) {
      _track("analyze", 200, domain);
      return analyzeDomainStream(domain, env, request, skipCache, rl.headers);
    }
    let coreResult: Awaited<ReturnType<typeof runAnalysis>>;
    try {
      coreResult = await runAnalysis(domain, env, skipCache, undefined, "analyze");
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        _track("analyze", 429, domain);
        return addHeaders(jsonError("Analysis budget reached, try later", "BUDGET_EXCEEDED", 429), rl.headers);
      }
      throw err;
    }

    // NXDOMAIN — domain doesn't exist
    if (coreResult.kind === "nxdomain") {
      _track("analyze", 422, domain);
      return addHeaders(jsonError(`Domain not registered (NXDOMAIN): ${domain}`, "DOMAIN_NOT_FOUND", 422), rl.headers);
    }

    // Only consume rate-limit credit for non-cached results
    // (hits are recorded eagerly on check — this comment retained for clarity)

    // Enrich result with share URLs, badge URLs, and percentiles
    const resultData = coreResult.data as Record<string, unknown>;
    await finalizeResult(domain, resultData, request, env);

    const resp = new Response(JSON.stringify(resultData), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
    _track("analyze", resp.status, domain);
    return addHeaders(resp, rl.headers);
  }

  // POST /api/compare
  if (method === "POST" && path === "/api/compare") {
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/compare", env);
    if (rl.blocked) {
      _track("compare", 429);
      return rl.blocked;
    }
    const body = await parseBody<{ domain1?: string; domain2?: string }>(request);
    if (!body.domain1 || !body.domain2) return jsonError("domain1 and domain2 are required", "MISSING_DOMAIN", 400);
    const d1 = cleanDomain(body.domain1);
    const d2 = cleanDomain(body.domain2);
    if (!d1 || !d2) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    recordEndpointHit(env, "compare");
    const resp = await compareDomains({ domain1: d1, domain2: d2 }, env);
    _track("compare", resp.status, d1);
    return addHeaders(resp, rl.headers);
  }

  // POST /api/subdomains
  if (method === "POST" && path === "/api/subdomains") {
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/subdomains", env);
    if (rl.blocked) {
      _track("subdomains", 429);
      return rl.blocked;
    }
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain) return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    const result = await getSubdomains(env.REFERENCE_DATA!, domain, env.STATS_DB);
    recordEndpointHit(env, "subdomains");
    _track("subdomains", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  // GET /api/subdomains?domain=X — subdomain enumeration (GET alias)
  if (method === "GET" && path === "/api/subdomains") {
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/subdomains", env);
    if (rl.blocked) {
      _track("subdomains", 429);
      return rl.blocked;
    }
    const domain = cleanDomain(url.searchParams.get("domain") || "");
    if (!domain)
      return jsonError(
        "domain query parameter is required (e.g., /api/subdomains?domain=example.com)",
        "MISSING_DOMAIN",
        400,
      );
    const result = await getSubdomains(env.REFERENCE_DATA!, domain, env.STATS_DB);
    recordEndpointHit(env, "subdomains");
    _track("subdomains", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  // POST /api/subdomain-scan
  if (method === "POST" && path === "/api/subdomain-scan") {
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/subdomain-scan", env);
    if (rl.blocked) {
      _track("subdomain-scan", 429);
      return rl.blocked;
    }
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain) return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    const result = await scanSubdomains(env.REFERENCE_DATA!, domain);
    recordEndpointHit(env, "subdomain-scan");
    _track("subdomain-scan", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  // POST /api/suggestions
  if (method === "POST" && path === "/api/suggestions") {
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/suggestions", env);
    if (rl.blocked) return rl.blocked;
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain) return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const result = await getDomainSuggestions(body.domain, env);
    recordEndpointHit(env, "suggestions");
    _track("suggestions", 200, body.domain);
    return addHeaders(json(result), rl.headers);
  }

  return null; // not handled
}
