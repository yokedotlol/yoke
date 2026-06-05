import { logApiError } from "../../api-errors";
import { type Env, fetchWithTimeout, flyProbeFetch, getFlyProbeUrl } from "../../helpers";
import type { BlocklistResult, DnsRecord, DnssecResult, IpInfo, ShodanResult, SslResult } from "./types";

// ─── IP Geolocation ──────────────────────────────────────────────────

export async function checkIpInfo(_domain: string, dnsRecords: DnsRecord[], env: Env): Promise<IpInfo | null> {
  const aRecord = dnsRecords.find((r) => r.type === "A");
  if (!aRecord) return null;
  const ip = aRecord.data;

  // Try Fly probe first (MaxMind local DB + API fallbacks, no rate limits)
  try {
    const probeRes = await flyProbeFetch(`${getFlyProbeUrl(env)}/probe-geo?ip=${encodeURIComponent(ip)}`, env, {
      timeout: 8000,
    });
    if (probeRes?.ok) {
      const data = (await probeRes.json()) as {
        ip: string;
        city?: string | null;
        country?: string | null;
        country_code?: string | null;
        lat?: number | null;
        lon?: number | null;
        isp?: string | null;
        org?: string | null;
        asn?: string | null;
        source?: string;
        error?: string | null;
      };
      if (!data.error) {
        const aaaaRecord = dnsRecords.find((r) => r.type === "AAAA");
        let reverseDns: string | null = null;
        try {
          const revRes = await fetchWithTimeout(
            `https://dns.google/resolve?name=${ip.split(".").reverse().join(".")}.in-addr.arpa&type=PTR`,
            { timeout: 3000 },
          );
          const revData = (await revRes.json()) as { Answer?: Array<{ data: string }> };
          if (revData.Answer?.[0]) reverseDns = revData.Answer[0].data.replace(/\.$/, "");
        } catch {
          /* ignore */
        }
        return {
          ip,
          isp: data.isp ?? null,
          org: data.org ?? null,
          asn: data.asn ?? null,
          city: data.city ?? null,
          country: data.country ?? null,
          country_code: data.country_code ?? null,
          lat: data.lat ?? null,
          lon: data.lon ?? null,
          reverse_dns: reverseDns,
          ipv6: aaaaRecord?.data ?? null,
        };
      }
    }
  } catch {
    /* probe unreachable */
  }

  // Fallback: direct ipwho.is from Worker
  try {
    const res = await fetchWithTimeout(`https://ipwho.is/${ip}`, { timeout: 5000 });
    const data = (await res.json()) as {
      success: boolean;
      country?: string;
      country_code?: string;
      city?: string;
      connection?: { isp?: string; org?: string; asn?: number };
      latitude?: number;
      longitude?: number;
    };
    if (!data.success) return null;
    const aaaaRecord = dnsRecords.find((r) => r.type === "AAAA");
    let reverseDns: string | null = null;
    try {
      const revRes = await fetchWithTimeout(
        `https://dns.google/resolve?name=${ip.split(".").reverse().join(".")}.in-addr.arpa&type=PTR`,
        { timeout: 3000 },
      );
      const revData = (await revRes.json()) as { Answer?: Array<{ data: string }> };
      if (revData.Answer?.[0]) reverseDns = revData.Answer[0].data.replace(/\.$/, "");
    } catch {
      /* ignore */
    }
    return {
      ip,
      isp: data.connection?.isp ?? null,
      org: data.connection?.org ?? null,
      asn: data.connection?.asn ? `AS${data.connection.asn}` : null,
      city: data.city ?? null,
      country: data.country ?? null,
      country_code: data.country_code ?? null,
      lat: data.latitude ?? null,
      lon: data.longitude ?? null,
      reverse_dns: reverseDns,
      ipv6: aaaaRecord?.data ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Blocklist Checks ────────────────────────────────────────────────

// ─── Blocklist Configuration ─────────────────────────────────────────
// Infrastructure notes (verified 2026-05-24):
//
// KEEP:
//   Barracuda (b.barracudacentral.org) — reliable, no false positives on major domains
//   SpamCop (bl.spamcop.net) — reliable, low false positive rate
//
// REMOVED:
//   SORBS (dnsbl.sorbs.net) — notorious for listing entire /24 blocks, high false positive
//     rate for shared/CDN IPs. Removed to reduce noise.
//   CBL (cbl.abuseat.org) — redundant with Spamhaus ZEN. CBL is the data source
//     for Spamhaus XBL, which is already included in ZEN. Also returns
//     127.255.255.254 via public resolvers (same issue as Spamhaus).
//
// DNSBL error response codes (NOT real listings):
//   127.255.255.254 = "query via public/open resolver — blocked"
//   127.255.255.255 = "query used incorrect DNSBL name"
//
// Spamhaus legitimate listing codes (these ARE real listings):
//   127.0.0.2    = SBL (Spamhaus Block List)
//   127.0.0.3    = SBL CSS
//   127.0.0.4-7  = XBL (Exploits Block List / CBL data)
//   127.0.0.10-11 = PBL (Policy Block List)
// ─────────────────────────────────────────────────────────────────────

const DNSBL_ERROR_CODES = new Set(["127.255.255.254", "127.255.255.255"]);

export const BLOCKLISTS = [
  { name: "Spamhaus ZEN", zone: "zen.spamhaus.org" },
  { name: "Barracuda", zone: "b.barracudacentral.org" },
  { name: "SpamCop", zone: "bl.spamcop.net" },
] as const;

export async function checkBlocklists(dnsRecords: DnsRecord[]): Promise<BlocklistResult[]> {
  const aRecords = dnsRecords.filter((r) => r.type === "A");
  if (aRecords.length === 0) return [];

  // Known CDN ASN prefixes — skip blocklist checks for CDN IPs since they're
  // shared infrastructure and listings reflect neighbors, not the domain
  // (CDN detection happens elsewhere, but we do a basic check here)
  const results: BlocklistResult[] = [];

  // Check all A records, not just the first
  for (const aRecord of aRecords) {
    const reversed = aRecord.data.split(".").reverse().join(".");
    const checks = BLOCKLISTS.map(async (bl) => {
      try {
        const res = await fetchWithTimeout(`https://dns.google/resolve?name=${reversed}.${bl.zone}&type=A`, {
          timeout: 4000,
        });
        const data = (await res.json()) as { Status: number; Answer?: Array<{ data: string }> };
        const returnIp = data.Answer?.[0]?.data ?? null;

        // Filter out DNSBL error responses — these are NOT real listings.
        const isErrorResponse = returnIp !== null && DNSBL_ERROR_CODES.has(returnIp);
        const listed = data.Status === 0 && !!data.Answer?.length && !isErrorResponse;

        // Distinguish Spamhaus PBL (policy-based, not spam) from SBL (real listings)
        let detail = isErrorResponse ? "query blocked (public resolver)" : listed ? returnIp : null;
        let isPbl = false;
        if (listed && bl.name === "Spamhaus ZEN" && returnIp) {
          // 127.0.0.10-11 = PBL (Policy Block List) — not spam, just residential/dynamic IP policy
          if (returnIp === "127.0.0.10" || returnIp === "127.0.0.11") {
            isPbl = true;
            detail = `PBL (policy-based, not spam): ${returnIp}`;
          }
        }

        // Dedup across A records: keep the most significant result per blocklist.
        // If this IP is listed and we previously recorded not-listed, upgrade the entry.
        const existingIdx = results.findIndex((r) => r.name === bl.name);
        if (existingIdx >= 0) {
          if (listed && !isPbl && !results[existingIdx].listed) {
            // Upgrade: previous entry was not-listed, this IP is truly listed
            results[existingIdx] = { name: bl.name, zone: bl.zone, listed: true, detail };
          }
          // Otherwise skip — already have an equal or better entry
        } else {
          results.push({
            name: bl.name,
            zone: bl.zone,
            listed: listed && !isPbl, // PBL is not a real listing — don't count it
            detail,
          });
        }
      } catch {
        if (!results.some((r) => r.name === bl.name)) {
          results.push({ name: bl.name, zone: bl.zone, listed: false, detail: "check failed" });
        }
      }
    });
    await Promise.allSettled(checks);
  }

  return results;
}

// ─── SSL/TLS + Direct TLS ───────────────────────────────────────────

export async function checkSsl(domain: string, env: Env): Promise<SslResult | null> {
  // Priority 1: Fly probe — direct TLS handshake, most reliable, works for any domain
  const probeResult = await tryFlyProbe(domain, env);
  if (probeResult?.grade) return probeResult;

  // Priority 2: HTTPS connectivity + crt.sh cert lookup
  const httpsResult = await tryHttpsCrtsh(domain, env.STATS_DB);
  if (httpsResult?.grade) return httpsResult;

  // If both fail, return what we got
  return (
    probeResult ??
    httpsResult ?? {
      grade: null,
      issuer: null,
      subject: null,
      valid_from: null,
      valid_to: null,
      protocols: [],
      key_exchange: null,
      ciphers: null,
      ocsp_stapling: null,
      has_scts: null,
      sct_count: null,
      forward_secrecy: null,
      error: "SSL check unavailable — all providers failed",
    }
  );
}

// ─── SSL: Fly Probe (direct TLS handshake) ──────────────────────────

async function tryFlyProbe(domain: string, env: Env): Promise<SslResult | null> {
  try {
    const probeRes = await flyProbeFetch(`${getFlyProbeUrl(env)}/probe-ssl?domain=${encodeURIComponent(domain)}`, env, {
      timeout: 20000,
    });
    if (!probeRes?.ok) {
      logApiError(env.STATS_DB, {
        api: "fly-probe",
        status: probeRes?.status ?? 0,
        message: "SSL probe failed",
        domain,
      });
      return null;
    }

    const data = (await probeRes.json()) as {
      grade: string;
      issuer: string;
      subject: string;
      valid_from: string;
      valid_to: string;
      key_alg: string;
      key_size: number;
      protocols: string[];
      chain_depth: number;
      chain_valid: boolean;
      sans: string[];
      serial: string;
      error: string | null;
      // SSL expansion fields
      ciphers: Array<{ name: string; id: number; strength: string }> | null;
      ocsp_stapling: boolean;
      sct_count: number;
      has_scts: boolean;
      forward_secrecy: boolean;
      key_exchange: string;
    };

    if (!data.grade) return null;

    return {
      grade: data.grade,
      issuer: data.issuer || null,
      subject: data.subject || null,
      valid_from: data.valid_from || null,
      valid_to: data.valid_to || null,
      protocols: data.protocols || [],
      key_exchange: data.key_alg ? `${data.key_alg} ${data.key_size || ""}`.trim() : null,
      error: data.grade === "T" ? data.error || "Certificate trust issue" : null,
      // SSL expansion
      ciphers: data.ciphers ?? null,
      ocsp_stapling: data.ocsp_stapling ?? null,
      has_scts: data.has_scts ?? null,
      sct_count: data.sct_count ?? null,
      forward_secrecy: data.forward_secrecy ?? null,
    };
  } catch (e) {
    logApiError(env.STATS_DB, {
      api: "fly-probe",
      status: 0,
      message: `SSL probe: ${String(e).slice(0, 150)}`,
      domain,
    });
    return null;
  }
}

// ─── SSL: HTTPS fetch + crt.sh cert lookup ──────────────────────────

async function tryHttpsCrtsh(domain: string, statsDb?: D1Database): Promise<SslResult | null> {
  try {
    const httpsRes = await fetchWithTimeout(`https://${domain}/`, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Yoke/1.0; +https://github.com/yokedotlol/yoke)" },
    });
    if (!httpsRes.ok && httpsRes.status === 0) return null;

    // HTTPS responded (any status code means TLS succeeded)
    let issuer: string | null = null;
    let validFrom: string | null = null;
    let validTo: string | null = null;

    try {
      const crtRes = await fetchWithTimeout(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`, {
        timeout: 6000,
      });
      if (crtRes.ok) {
        const certs = (await crtRes.json()) as Array<{
          issuer_name?: string;
          not_before?: string;
          not_after?: string;
          common_name?: string;
          name_value?: string;
        }>;
        const matching = certs
          .filter((c) => c.common_name === domain || c.name_value?.split("\n").includes(domain))
          .sort((a, b) => new Date(b.not_before ?? 0).getTime() - new Date(a.not_before ?? 0).getTime());
        const latest = matching[0];
        if (latest) {
          issuer = latest.issuer_name ?? null;
          validFrom = latest.not_before ? new Date(latest.not_before).toISOString() : null;
          validTo = latest.not_after ? new Date(latest.not_after).toISOString() : null;
        }
      }
    } catch (e) {
      if (statsDb)
        logApiError(statsDb, {
          api: "crt.sh",
          status: 0,
          message: `SSL cert lookup: ${String(e).slice(0, 150)}`,
          domain,
        });
    }

    return {
      grade: "Valid",
      issuer,
      subject: null,
      valid_from: validFrom,
      valid_to: validTo,
      protocols: [],
      key_exchange: null,
      error: null,
      ciphers: null,
      ocsp_stapling: null,
      has_scts: null,
      sct_count: null,
      forward_secrecy: null,
    };
  } catch {
    return null;
  }
}

// ─── Live Status Check ───────────────────────────────────────────────

export async function checkStatus(
  domain: string,
  env: Env,
): Promise<{
  is_up: boolean;
  status_code: number | null;
  response_time_ms: number | null;
  error: string | null;
  status_label: string;
  http_blocked: boolean;
  http2?: boolean;
  http3?: boolean;
  alt_svc?: string | null;
}> {
  // Try Fly.io proxy first (avoids CF Worker IP blocks for sites like meta.com)
  try {
    const probeRes = await flyProbeFetch(
      `${getFlyProbeUrl(env)}/probe-status?domain=${encodeURIComponent(domain)}`,
      env,
      { timeout: 15000 },
    );
    if (probeRes?.ok) {
      const data = (await probeRes.json()) as {
        is_up: boolean;
        status_code: number | null;
        response_time_ms: number;
        error: string | null;
        status_label: string;
        http_blocked: boolean;
        http2?: boolean;
        http3?: boolean;
        alt_svc?: string | null;
      };
      return {
        is_up: data.is_up,
        status_code: data.status_code ?? null,
        response_time_ms: data.response_time_ms,
        error: data.error ?? null,
        status_label: data.status_label ?? "DOWN",
        http_blocked: data.http_blocked ?? false,
        http2: data.http2 ?? false,
        http3: data.http3 ?? false,
        alt_svc: data.alt_svc ?? null,
      };
    } else {
      logApiError(env.STATS_DB, {
        api: "fly-probe",
        status: probeRes?.status ?? 0,
        message: "Status probe failed",
        domain,
      });
    }
  } catch (e) {
    logApiError(env.STATS_DB, {
      api: "fly-probe",
      status: 0,
      message: `Status probe: ${String(e).slice(0, 150)}`,
      domain,
    });
  }

  // Fallback: direct probe from CF Worker
  const start = Date.now();
  try {
    // Use a realistic browser User-Agent and follow redirects manually to track final status
    let currentUrl = `https://${domain}`;
    let finalStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await fetchWithTimeout(currentUrl, {
        timeout: 10000,
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      finalStatus = res.status;
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location) {
          currentUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
          continue;
        }
      }
      break;
    }
    const elapsed = Date.now() - start;
    const isUp = finalStatus >= 200 && finalStatus < 400;
    const isBlocked = finalStatus === 403 || finalStatus === 503 || finalStatus === 502 || finalStatus === 429;
    return {
      is_up: isUp || isBlocked, // blocked means the site is UP, just blocking us
      status_code: finalStatus,
      response_time_ms: elapsed,
      error: isBlocked ? `Site returned HTTP ${finalStatus} — may be blocking automated requests` : null,
      status_label: isUp ? "UP" : isBlocked ? "RESTRICTED" : "DOWN",
      http_blocked: isBlocked,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      is_up: false,
      status_code: null,
      response_time_ms: elapsed > 100 ? elapsed : null,
      error: err instanceof Error ? err.message : "Connection failed",
      status_label: "DOWN",
      http_blocked: false,
    };
  }
}

// ─── NEW: Shodan InternetDB ─────────────────────────────────────────

export async function checkShodan(ip: string, statsDb?: D1Database): Promise<ShodanResult | null> {
  try {
    const res = await fetchWithTimeout(`https://internetdb.shodan.io/${ip}`, { timeout: 6000 });
    if (!res.ok) {
      if (statsDb)
        logApiError(statsDb, { api: "shodan", status: res.status, message: "InternetDB lookup failed", domain: ip });
      return null;
    }
    const data = (await res.json()) as {
      cpes?: string[];
      hostnames?: string[];
      ip?: string;
      ports?: number[];
      tags?: string[];
      vulns?: string[];
    };
    return {
      ports: data.ports ?? [],
      cpes: data.cpes ?? [],
      vulns: data.vulns ?? [],
      tags: data.tags ?? [],
      hostnames: data.hostnames ?? [],
    };
  } catch (e) {
    if (statsDb) logApiError(statsDb, { api: "shodan", status: 0, message: String(e).slice(0, 200), domain: ip });
    return null;
  }
}

// ─── NEW: DNSSEC Validation ─────────────────────────────────────────

export async function checkDnssec(domain: string): Promise<DnssecResult> {
  const result: DnssecResult = { enabled: false, has_dnskey: false, has_ds: false, validated: false };
  const [dnskeyRes, dsRes, adRes] = await Promise.allSettled([
    fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=DNSKEY`, { timeout: 5000 }),
    fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=DS`, { timeout: 5000 }),
    fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A&cd=false`, {
      timeout: 5000,
    }),
  ]);

  if (dnskeyRes.status === "fulfilled" && dnskeyRes.value.ok) {
    try {
      const data = (await dnskeyRes.value.json()) as { Status: number; Answer?: Array<{ data: string }> };
      if (data.Status === 0 && data.Answer?.length) result.has_dnskey = true;
    } catch {
      /* ignore */
    }
  }

  if (dsRes.status === "fulfilled" && dsRes.value.ok) {
    try {
      const data = (await dsRes.value.json()) as { Status: number; Answer?: Array<{ data: string }> };
      if (data.Status === 0 && data.Answer?.length) result.has_ds = true;
    } catch {
      /* ignore */
    }
  }

  if (adRes.status === "fulfilled" && adRes.value.ok) {
    try {
      const data = (await adRes.value.json()) as { AD?: boolean };
      if (data.AD === true) result.validated = true;
    } catch {
      /* ignore */
    }
  }

  result.enabled = result.has_dnskey || result.has_ds || result.validated;
  return result;
}
