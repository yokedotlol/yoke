// Quick scan endpoint: fast DNS + probe infodump, no scoring
// GET /api/quick/{domain} — returns raw probe data as fast as possible

import { checkEmailAuth } from "../actions/analyze/content";
import { checkDns, checkRdap, isSubdomain } from "../actions/analyze/dns";
import { analyzeHttpWithFallback } from "../actions/analyze/http";
import { checkDnssec, checkIpInfo, checkSsl } from "../actions/analyze/network";
import { recordEndpointHit } from "../analysis-budget";
import { cleanDomain, hashIp } from "../helpers";
import { trackRequest } from "../request-tracking";
import { addHeaders, checkRateLimitAuto, json, jsonError, type RouteContext } from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env } = rc;

  // GET /api/quick/{domain}
  if (method !== "GET") return null;
  const match = path.match(/^\/api\/quick\/(.+)$/);
  if (!match) return null;

  const domain = cleanDomain(match[1]);
  if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);

  // Rate limit — shares the /api/analyze bucket
  const clientIP = await hashIp(
    request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown",
    env,
  );
  const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/analyze", env);
  if (rl.blocked) return rl.blocked;

  const t0 = Date.now();
  const baseUrl = rc.baseUrl;

  // ── Quick cache (5 min TTL) ──
  if (env.REFERENCE_DATA) {
    try {
      const raw = await env.REFERENCE_DATA.get(`cache:quick:${domain}`, "text");
      if (raw) {
        const envelope = JSON.parse(raw) as { data: Record<string, unknown>; cached_at: number };
        if (Date.now() - envelope.cached_at < 5 * 60 * 1000) {
          trackRequest(env, request, { endpoint: "quick", domain, status: 200, latencyMs: Date.now() - t0 });
          const meta = envelope.data._meta as Record<string, unknown>;
          return json({
            ...envelope.data,
            _meta: { ...meta, cached: true, cached_at: envelope.cached_at, probe_ms: Date.now() - t0 },
          });
        }
      }
    } catch {
      /* ignore cache failures */
    }
  }

  // ── Fan out all fast probes concurrently ──
  const dnsPromise = checkDns(domain).catch(() => []);
  const rdapPromise = checkRdap(domain, env).catch(() => null);
  const httpPromise = analyzeHttpWithFallback(domain, undefined, env).catch(() => null);
  const dnssecPromise = checkDnssec(domain).catch(
    () => ({ enabled: false, has_dnskey: false, has_ds: false, validated: false }) as const,
  );
  const sslPromise = checkSsl(domain, env).catch(() => null);

  // DNS resolves first (fastest), then fan out IP-dependent checks
  const dnsRecords = await dnsPromise;
  const emailAuthPromise = checkEmailAuth(domain, dnsRecords, env).catch(() => null);
  const ipInfoPromise = checkIpInfo(domain, dnsRecords, env).catch(() => null);

  // Wait for everything
  const [rdap, httpAnalysis, dnssec, ssl, emailAuth, ipInfo] = await Promise.all([
    rdapPromise,
    httpPromise,
    dnssecPromise,
    sslPromise,
    emailAuthPromise,
    ipInfoPromise,
  ]);

  // Consume rate-limit credit
  await rl.record();

  // ── Build result ──
  const httpOk = httpAnalysis && httpAnalysis.status_code >= 200 && httpAnalysis.status_code < 400;

  const result = {
    domain,
    scanned_at: new Date().toISOString(),
    is_subdomain: isSubdomain(domain),
    dns: { records: dnsRecords },
    rdap,
    status: {
      is_up: !!httpOk,
      status_code: httpAnalysis?.status_code ?? null,
      response_time_ms: httpAnalysis?.response_time_ms ?? null,
      error: httpAnalysis ? null : "HTTP probe failed or timed out",
    },
    redirects: httpAnalysis?.redirects ?? [],
    headers: httpOk ? (httpAnalysis?.headers?.raw ?? null) : null,
    ssl,
    ip_info: ipInfo,
    email_auth: emailAuth,
    dnssec,
    tech_stack: httpOk ? (httpAnalysis?.tech_stack ?? null) : null,
    _meta: {
      probe_ms: Date.now() - t0,
      endpoint: `/api/quick/${domain}`,
      docs: `${baseUrl}/api/docs`,
    },
  };

  // ── Cache (5 min, fire-and-forget) ──
  if (env.REFERENCE_DATA) {
    try {
      const envelope = { data: result, cached_at: Date.now() };
      env.REFERENCE_DATA.put(`cache:quick:${domain}`, JSON.stringify(envelope), { expirationTtl: 300 }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  // Track
  recordEndpointHit(env, "quick");
  trackRequest(env, request, { endpoint: "quick", domain, status: 200, latencyMs: Date.now() - t0 });

  return addHeaders(json(result), rl.headers);
}
