// Enrichment API routes: company, news, social, reverse-ip, availability
import { checkGlobalAvailability } from "../actions/availability";
import { getCompanyInfo } from "../actions/company";
import { getNews } from "../actions/news";
import { getReverseIP } from "../actions/reverse-ip";
import { getSocialAccounts } from "../actions/social";
import { cleanDomain } from "../helpers";
import { trackUsage } from "../usage-tracking";
import { addHeaders, checkRateLimit, json, jsonError, parseBody, type RouteContext } from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env, clientIP, track: _track } = rc;

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
    await trackUsage(env.STATS_DB, "company", !!env.DISABLE_ANALYTICS);
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
    await trackUsage(env.STATS_DB, "news", !!env.DISABLE_ANALYTICS);
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
    await trackUsage(env.STATS_DB, "social", !!env.DISABLE_ANALYTICS);
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
      return jsonError("Invalid IP address format", "INVALID_IP", 400);
    }
    const result = await getReverseIP(env.REFERENCE_DATA!, ip);
    if (!result.cached) await rl.record();
    await trackUsage(env.STATS_DB, "reverse-ip", !!env.DISABLE_ANALYTICS);
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
    const result = await checkGlobalAvailability(domain, { colo: cf?.colo, country: cf?.country, city: cf?.city }, env);
    await rl.record();
    await trackUsage(env.STATS_DB, "availability", !!env.DISABLE_ANALYTICS);
    _track("availability", 200, domain);
    return addHeaders(json(result), rl.headers);
  }

  return null; // not handled
}
