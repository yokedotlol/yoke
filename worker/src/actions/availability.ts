// Global Availability Check
//
// Primary: check-host.net via Fly.io proxy (yoke-probe.fly.dev) — 20 worldwide HTTP probe nodes
// The proxy exists because check-host.net blocks Cloudflare Worker IPs directly.
// Fallback: direct HTTP probes from CF Worker edge (if proxy is unavailable)
// Plus: DNS resolution checks from major public resolvers
//
// Note: check-host.net returns 403 from Cloudflare Worker IPs as of May 2026.
// Fallback probes from the CF edge nearest to the requesting user. The edge
// datacenter is identified via request.cf metadata so the UI can show where
// the probe originated.

import { logApiError } from "../api-errors";
import { type Env, fetchWithTimeout, flyProbeFetch, getFlyProbeUrl } from "../helpers";

// ─── Types ───────────────────────────────────────────────────────────

interface AvailabilityNode {
  country_code: string;
  country: string;
  city: string;
  ip: string;
  asn: string;
}

interface AvailabilityResult {
  node: string;
  location: AvailabilityNode;
  status: "up" | "down" | "pending" | "error";
  type: "http" | "dns";
  status_code: number | null;
  response_time_ms: number | null;
  ip: string | null;
  message: string | null;
}

interface EdgeInfo {
  colo?: string;
  country?: string;
  city?: string;
}

// ─── DNS Resolution ──────────────────────────────────────────────────

const DNS_RESOLVERS = [
  {
    name: "Cloudflare",
    url: "https://cloudflare-dns.com/dns-query",
    country_code: "US",
    country: "United States",
    city: "Cloudflare",
  },
  {
    name: "Google",
    url: "https://dns.google/resolve",
    country_code: "US",
    country: "United States",
    city: "Google DNS",
  },
  { name: "NextDNS", url: "https://dns.nextdns.io/dns-query", country_code: "EU", country: "Europe", city: "NextDNS" },
];

async function resolveViaDoH(domain: string, resolverUrl: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${resolverUrl}?name=${encodeURIComponent(domain)}&type=A`, {
      timeout: 5000,
      headers: { Accept: "application/dns-json" },
    });
    if (!res.ok) return [];
    // DoH JSON response shape
    const data = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
    return (data.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
  } catch {
    return [];
  }
}

async function checkDnsResolvers(domain: string): Promise<AvailabilityResult[]> {
  const results = await Promise.allSettled(DNS_RESOLVERS.map((r) => resolveViaDoH(domain, r.url)));

  return DNS_RESOLVERS.map((resolver, i) => {
    const r = results[i];
    const ips = r.status === "fulfilled" ? r.value : [];
    return {
      node: `dns-${resolver.name.toLowerCase()}`,
      location: {
        country_code: resolver.country_code,
        country: resolver.country,
        city: resolver.city,
        ip: "",
        asn: "",
      },
      type: "dns" as const,
      status: (ips.length > 0 ? "up" : "error") as "up" | "error",
      status_code: null,
      response_time_ms: null,
      ip: ips[0] ?? null,
      message: ips.length > 0 ? `Resolves to ${ips.join(", ")}` : "DNS did not resolve",
    };
  });
}

// ─── check-host.net multi-location HTTP probes ───────────────────────

interface CheckHostStartResponse {
  ok: number;
  request_id: string;
  permanent_link: string;
  nodes: Record<string, [string, string, string, string, string]>;
}

type CheckHostResultEntry = [[number, number, string, string, string]] | null;
type CheckHostResults = Record<string, CheckHostResultEntry>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkHostProbes(
  domain: string,
  env: Env,
): Promise<{
  results: AvailabilityResult[];
  request_id: string | null;
  permanent_link: string | null;
} | null> {
  // Step 1: Start the check
  let startRes: Response | null;
  try {
    startRes = await flyProbeFetch(
      `${getFlyProbeUrl(env)}/check-http?host=${encodeURIComponent(domain)}&max_nodes=20`,
      env,
      { timeout: 10000, headers: { Accept: "application/json" } },
    );
  } catch (e) {
    logApiError(env.STATS_DB, {
      api: "fly-probe",
      status: 0,
      message: `check-host start: ${String(e).slice(0, 150)}`,
      domain,
    });
    return null;
  }
  if (!startRes?.ok) {
    logApiError(env.STATS_DB, {
      api: "fly-probe",
      status: startRes?.status ?? 0,
      message: "check-host start failed",
      domain,
    });
    return null;
  }

  let check: CheckHostStartResponse;
  try {
    check = (await startRes.json()) as CheckHostStartResponse;
  } catch {
    return null;
  }
  if (!check.ok || !check.request_id) return null;

  const nodeEntries = Object.entries(check.nodes);

  // Step 2: Poll for results — 3 attempts (wait 3s, then 2s, then 2s)
  let rawResults: CheckHostResults | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(attempt === 0 ? 3000 : 2000);
    try {
      const pollRes = await flyProbeFetch(`${getFlyProbeUrl(env)}/check-result/${check.request_id}`, env, {
        timeout: 10000,
        headers: { Accept: "application/json" },
      });
      if (pollRes?.ok) {
        rawResults = (await pollRes.json()) as CheckHostResults;
        // Check if all nodes reported
        const allDone = nodeEntries.every(([name]) => rawResults?.[name] != null);
        if (allDone) break;
      }
    } catch {
      // continue to next attempt
    }
  }

  if (!rawResults) return null;

  // Step 3: Map to AvailabilityResult
  const results: AvailabilityResult[] = nodeEntries.map(([nodeName, nodeInfo]) => {
    const [cc, country, city, nodeIp, asn] = nodeInfo;
    const entry = rawResults?.[nodeName];

    if (!entry || !Array.isArray(entry) || !entry[0]) {
      return {
        node: nodeName,
        type: "http" as const,
        status: "pending" as const,
        location: { country_code: cc, country, city, ip: nodeIp, asn },
        status_code: null,
        response_time_ms: null,
        ip: null,
        message: "Still checking...",
      };
    }

    const r = entry[0];
    const success = r[0] === 1;
    const timeSec = typeof r[1] === "number" ? r[1] : null;
    const statusText = typeof r[2] === "string" ? r[2] : null;
    const statusCode = typeof r[3] === "string" ? parseInt(r[3], 10) : null;
    const resolvedIp = typeof r[4] === "string" ? r[4] : null;

    return {
      node: nodeName,
      type: "http" as const,
      location: { country_code: cc, country, city, ip: nodeIp, asn },
      status: success ? ("up" as const) : ("down" as const),
      status_code: !Number.isNaN(statusCode ?? NaN) ? statusCode : null,
      response_time_ms: timeSec != null ? Math.round(timeSec * 1000) : null,
      ip: resolvedIp,
      message: statusText,
    };
  });

  // Sort by response time (fastest first, nulls last)
  results.sort((a, b) => {
    if (a.response_time_ms == null && b.response_time_ms == null) return 0;
    if (a.response_time_ms == null) return 1;
    if (b.response_time_ms == null) return -1;
    return a.response_time_ms - b.response_time_ms;
  });

  return {
    results,
    request_id: check.request_id,
    permanent_link: check.permanent_link
      ? check.permanent_link
          .replace("yoke-probe.fly.dev:443", "check-host.net")
          .replace("yoke-probe.fly.dev", "check-host.net")
      : null,
  };
}

// ─── Fallback: enhanced edge probes ──────────────────────────────────

async function edgeProbes(domain: string, edge: EdgeInfo): Promise<AvailabilityResult[]> {
  const edgeCity = edge.city ?? edge.colo ?? "Edge";
  const edgeCountry = edge.country ?? "🌐";

  const results: AvailabilityResult[] = [];

  // Get IPs via quick DNS lookup for the IP probe
  let ips: string[] = [];
  try {
    const dnsRes = await fetchWithTimeout(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      { timeout: 3000, headers: { Accept: "application/dns-json" } },
    );
    if (dnsRes.ok) {
      // DoH JSON response shape
      const dnsData = (await dnsRes.json()) as { Answer?: Array<{ type: number; data: string }> };
      ips = (dnsData.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
    }
  } catch {
    /* ignore */
  }

  // HTTPS + HTTP direct probes
  const probes = await Promise.allSettled(
    ["https", "http"].map(async (proto) => {
      const url = `${proto}://${domain}`;
      const start = Date.now();
      try {
        const res = await fetchWithTimeout(url, {
          method: "HEAD",
          timeout: 8000,
          redirect: "follow",
          headers: { "User-Agent": "Yoke/1.0 (Domain Intelligence)" },
        });
        return { proto, ok: res.ok, status: res.status, time_ms: Date.now() - start, error: null as string | null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown";
        return {
          proto,
          ok: false,
          status: null as number | null,
          time_ms: Date.now() - start,
          error: msg.includes("abort") ? "Timeout" : msg,
        };
      }
    }),
  );

  for (const r of probes) {
    if (r.status !== "fulfilled") continue;
    const { proto, ok, status, time_ms, error } = r.value;
    results.push({
      node: `edge-${proto}`,
      type: "http",
      location: {
        country_code: edgeCountry,
        country: edgeCountry,
        city: `${edgeCity} (${proto.toUpperCase()})`,
        ip: "",
        asn: edge.colo ? `CF ${edge.colo}` : "",
      },
      status: ok ? "up" : error ? "error" : "down",
      status_code: status,
      response_time_ms: time_ms,
      ip: ips[0] ?? null,
      message: error ?? (ok ? "OK" : `HTTP ${status}`),
    });
  }

  // Per-IP HTTPS probes for each unique IP
  const uniqueIps = [...new Set(ips)].slice(0, 3);
  if (uniqueIps.length > 0) {
    const ipProbes = await Promise.allSettled(
      uniqueIps.map(async (ip) => {
        const start = Date.now();
        try {
          const res = await fetchWithTimeout(`https://${domain}`, {
            method: "HEAD",
            timeout: 8000,
            redirect: "follow",
            headers: { "User-Agent": "Yoke/1.0", Host: domain },
          });
          return { ip, ok: res.ok, status: res.status, time_ms: Date.now() - start, error: null as string | null };
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unknown";
          return {
            ip,
            ok: false,
            status: null as number | null,
            time_ms: Date.now() - start,
            error: msg.includes("abort") ? "Timeout" : msg,
          };
        }
      }),
    );

    for (const r of ipProbes) {
      if (r.status !== "fulfilled") continue;
      const { ip, ok, status, time_ms, error } = r.value;
      results.push({
        node: `ip-${ip}`,
        type: "http",
        location: {
          country_code: edgeCountry,
          country: edgeCountry,
          city: `${edgeCity} → ${ip}`,
          ip,
          asn: edge.colo ? `CF ${edge.colo}` : "",
        },
        status: ok ? "up" : error ? "error" : "down",
        status_code: status,
        response_time_ms: time_ms,
        ip,
        message: error ?? (ok ? "OK" : `HTTP ${status}`),
      });
    }
  }

  return results;
}

// ─── Main entry point ────────────────────────────────────────────────

export async function checkGlobalAvailability(
  domain: string,
  edge?: EdgeInfo,
  env?: Env,
): Promise<{
  results: AvailabilityResult[];
  request_id: string | null;
  permanent_link: string | null;
  source: "check-host" | "edge";
  edge_colo: string | null;
}> {
  // Run DNS checks and check-host.net probes in parallel
  const [dnsResults, checkHostResult] = await Promise.all([checkDnsResolvers(domain), checkHostProbes(domain, env!)]);

  let httpResults: AvailabilityResult[];
  let requestId: string | null = null;
  let permanentLink: string | null = null;
  let source: "check-host" | "edge";

  if (checkHostResult && checkHostResult.results.length > 0) {
    httpResults = checkHostResult.results;
    requestId = checkHostResult.request_id;
    permanentLink = checkHostResult.permanent_link;
    source = "check-host";
  } else {
    httpResults = await edgeProbes(domain, edge ?? {});
    source = "edge";
  }

  return {
    results: [...httpResults, ...dnsResults],
    request_id: requestId,
    permanent_link: permanentLink,
    source,
    edge_colo: edge?.colo ?? null,
  };
}
