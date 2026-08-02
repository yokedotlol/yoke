// Enrichment API routes: company, news, social, reverse-ip, availability
import { checkGlobalAvailability } from "../actions/availability";
import { getCompanyInfo } from "../actions/company";
import { getNews } from "../actions/news";
import { getReverseIP } from "../actions/reverse-ip";
import { getSocialAccounts } from "../actions/social";
import { recordEndpointHit } from "../analysis-budget";
import { cleanDomain } from "../helpers";
import { addHeaders, checkRateLimitAuto, json, jsonError, parseBody, type RouteContext, rateLimitNoop } from "./shared";

// ── Cache probe helper — fleet-wide rule: cache hits skip rate limits ──
async function isCached(
  env: { REFERENCE_DATA?: KVNamespace },
  cacheType: string,
  key: string,
  ttlMs: number,
): Promise<boolean> {
  if (!env.REFERENCE_DATA) return false;
  try {
    const raw = await env.REFERENCE_DATA.get(`cache:${cacheType}:${key}`, "text");
    if (!raw) return false;
    const envelope = JSON.parse(raw) as { cached_at: number };
    return Date.now() - envelope.cached_at < ttlMs;
  } catch {
    return false;
  }
}

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env, clientIP, track: _track } = rc;

  // POST /api/company — 24h cache, force bypasses cache + RL
  if (method === "POST" && path === "/api/company") {
    const body = await parseBody<{ domain?: string; force?: boolean }>(request);
    if (!body.domain) return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    const skipCache = body.force === true;
    const hit = !skipCache && (await isCached(env, "company_info", domain, 24 * 60 * 60 * 1000));
    const rl = hit
      ? { blocked: null, headers: {}, record: rateLimitNoop }
      : await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/company", env);
    if (rl.blocked) {
      _track("company", 429);
      return rl.blocked;
    }
    const result = await getCompanyInfo(env.REFERENCE_DATA, domain, body.force, env.STATS_DB);
    recordEndpointHit(env, "company");
    _track("company", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  // POST /api/news — 4h cache
  if (method === "POST" && path === "/api/news") {
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain) return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    const hit = await isCached(env, "news", domain, 4 * 60 * 60 * 1000);
    const rl = hit
      ? { blocked: null, headers: {}, record: rateLimitNoop }
      : await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/news", env);
    if (rl.blocked) {
      _track("news", 429);
      return rl.blocked;
    }
    const result = await getNews(env.REFERENCE_DATA, domain, env.STATS_DB);
    recordEndpointHit(env, "news");
    _track("news", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  // POST /api/social — 24h cache
  if (method === "POST" && path === "/api/social") {
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain) return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    const hit = await isCached(env, "social_accounts", domain, 24 * 60 * 60 * 1000);
    const rl = hit
      ? { blocked: null, headers: {}, record: rateLimitNoop }
      : await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/social", env);
    if (rl.blocked) {
      _track("social", 429);
      return rl.blocked;
    }
    const result = await getSocialAccounts(env.REFERENCE_DATA, domain, env);
    recordEndpointHit(env, "social");
    _track("social", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  // POST /api/reverse-ip — 24h cache (keyed by IP)
  if (method === "POST" && path === "/api/reverse-ip") {
    const body = await parseBody<{ ip?: string }>(request);
    if (!body.ip) return jsonError("ip is required", "MISSING_IP", 400);
    const ip = body.ip.trim();
    // Validate IPv4 or IPv6 format
    const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Re = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    if (!ipv4Re.test(ip) && !ipv6Re.test(ip)) {
      return jsonError("Invalid IP address format", "INVALID_IP", 400);
    }
    const hit = await isCached(env, "reverse_ip", ip, 24 * 60 * 60 * 1000);
    const rl = hit
      ? { blocked: null, headers: {}, record: rateLimitNoop }
      : await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/reverse-ip", env);
    if (rl.blocked) {
      _track("reverse-ip", 429);
      return rl.blocked;
    }
    const result = await getReverseIP(env.REFERENCE_DATA, ip);
    recordEndpointHit(env, "reverse-ip");
    _track("reverse-ip", 200);
    return addHeaders(json(result), rl.headers);
  }

  // POST /api/availability
  if (method === "POST" && path === "/api/availability") {
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/availability", env);
    if (rl.blocked) {
      _track("availability", 429);
      return rl.blocked;
    }
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain) return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    // CF Workers expose request.cf with IncomingRequestCfProperties
    const cf = (request as Request & { cf?: { colo?: string; country?: string; city?: string } }).cf;
    const result = await checkGlobalAvailability(domain, { colo: cf?.colo, country: cf?.country, city: cf?.city }, env);
    recordEndpointHit(env, "availability");
    _track("availability", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  return null; // not handled
}
