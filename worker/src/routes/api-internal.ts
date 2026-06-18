// Internal API endpoints — consumed by .lol family tools via CF service bindings.
// These are NOT public-facing. Authenticated via SERVICE_KEY or ADMIN_KEY.
//
// POST /api/internal/domain-signals
//   Returns email auth + DNSSEC for a domain. Serves from KV cache when
//   available (any domain previously scanned on yoke.lol), otherwise runs
//   only the DNS-based checks — no HTTP probes, no PageSpeed, no scoring.

import { checkEmailAuth } from "../actions/analyze/content";
import { checkDnssec } from "../actions/analyze/network";
import type { DnsRecord, DnssecResult, EmailAuthResult } from "../actions/analyze/types";
import { getAnalysisCacheTtlMs } from "../config/cache";
import type { Env } from "../helpers";
import { cleanDomain } from "../helpers";
import { json, jsonError, parseBody, type RouteContext, timingSafeEq } from "./shared";

/** Response shape for domain-signals endpoint */
export interface DomainSignalsResponse {
  domain: string;
  email_auth: EmailAuthResult;
  dnssec: DnssecResult;
  cached: boolean;
  source: "yoke";
}

const DEFAULT_DNSSEC: DnssecResult = { enabled: false, has_dnskey: false, has_ds: false, validated: false };

/** Verify the caller is an authorized service (same-account binding or API key). */
function isAuthorized(request: Request, env: Env): boolean {
  const key = request.headers.get("X-Service-Key") ?? request.headers.get("X-Admin-Key") ?? "";
  if (!key) return false;
  // Accept either SERVICE_KEY or ADMIN_KEY
  if (env.SERVICE_KEY && timingSafeEq(key, env.SERVICE_KEY)) return true;
  if (env.ADMIN_KEY && timingSafeEq(key, env.ADMIN_KEY)) return true;
  return false;
}

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env } = rc;

  // POST /api/internal/domain-signals
  if (method === "POST" && path === "/api/internal/domain-signals") {
    if (!isAuthorized(request, env)) {
      return jsonError("Unauthorized", "UNAUTHORIZED", 401);
    }

    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain || typeof body.domain !== "string") {
      return jsonError("domain is required", "MISSING_DOMAIN", 400);
    }

    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);

    // ── Try KV cache first — free, instant ──
    if (env.REFERENCE_DATA) {
      try {
        const raw = await env.REFERENCE_DATA.get(`cache:analysis:${domain}`, "text");
        if (raw) {
          const envelope = JSON.parse(raw) as { data: Record<string, unknown>; cached_at: number };
          if (Date.now() - envelope.cached_at < getAnalysisCacheTtlMs(env)) {
            const data = envelope.data;
            const emailAuth = (data.email_auth ?? null) as EmailAuthResult | null;
            const dnssec = (data.dnssec ?? DEFAULT_DNSSEC) as DnssecResult;
            if (emailAuth) {
              const resp: DomainSignalsResponse = {
                domain,
                email_auth: emailAuth,
                dnssec,
                cached: true,
                source: "yoke",
              };
              return json(resp);
            }
          }
        }
      } catch {
        /* KV miss or parse error — fall through to fresh checks */
      }
    }

    // ── Fresh DNS-only checks (no HTTP probes, no scoring) ──
    // Resolve base DNS records for checkEmailAuth (needs TXT/MX)
    const dnsRecords: DnsRecord[] = [];
    try {
      const [txtRes, mxRes] = await Promise.all([
        fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=TXT`, {
          signal: AbortSignal.timeout(5000),
        }),
        fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      const [txtData, mxData] = await Promise.all([
        txtRes.json() as Promise<{ Answer?: Array<{ type: number; name: string; TTL: number; data: string }> }>,
        mxRes.json() as Promise<{ Answer?: Array<{ type: number; name: string; TTL: number; data: string }> }>,
      ]);
      for (const a of txtData.Answer ?? [])
        dnsRecords.push({ type: "TXT", name: a.name ?? domain, ttl: a.TTL ?? 0, data: a.data });
      for (const a of mxData.Answer ?? [])
        dnsRecords.push({ type: "MX", name: a.name ?? domain, ttl: a.TTL ?? 0, data: a.data });
    } catch {
      /* DNS failure — proceed with empty records, checkEmailAuth handles gracefully */
    }

    const [emailAuth, dnssec] = await Promise.all([checkEmailAuth(domain, dnsRecords, env), checkDnssec(domain)]);

    const resp: DomainSignalsResponse = {
      domain,
      email_auth: emailAuth,
      dnssec,
      cached: false,
      source: "yoke",
    };
    return json(resp);
  }

  return null; // Not handled
}
