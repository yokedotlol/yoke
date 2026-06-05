// ─── Network Health Analysis ────────────────────────────────────────
// DNS propagation, RIPE routing, outage page detection, connection timing.
// All checks degrade gracefully — null on failure, never throws.

import { type Env, fetchWithTimeout, flyProbeFetch, getFlyProbeUrl } from "../../helpers";

// ─── Types ───────────────────────────────────────────────────────────

export interface DnsResolverResult {
  name: string;
  ips: string[];
  response_time_ms: number;
  status: "ok" | "timeout" | "error";
}

export interface DnsPropagation {
  resolvers: DnsResolverResult[];
  consistent: boolean;
  unique_ips: string[];
}

export interface RipeRouting {
  asn: number | null;
  asn_name: string | null;
  prefix: string | null;
  visibility: { seen_by: number; total: number; percentage: number } | null;
  bgp_updates_24h: number | null;
  routing_stability: "stable" | "moderate" | "unstable" | null;
}

export interface OutageLinks {
  downdetector: { exists: boolean; url: string };
  isitdown: { exists: boolean; url: string };
}

export interface ConnectionTiming {
  dns_ms: number;
  tcp_ms: number;
  tls_ms: number;
  total_ms: number;
  ip: string | null;
  tls_version: string | null;
}

export interface NetworkHealth {
  dns_propagation: DnsPropagation | null;
  ripe_routing: RipeRouting | null;
  connection_timing: ConnectionTiming | null;
  outage_links: OutageLinks | null;
}

// ─── DNS Propagation Check ───────────────────────────────────────────
// Query A records from multiple public DoH resolvers in parallel.

interface DohAnswer {
  data: string;
  type: number;
}
interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

const DOH_RESOLVERS: Array<{ name: string; url: (domain: string) => string; headers?: Record<string, string> }> = [
  {
    name: "Google",
    url: (d) => `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=A`,
  },
  {
    name: "Cloudflare",
    url: (d) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=A`,
    headers: { Accept: "application/dns-json" },
  },
  {
    name: "AdGuard",
    url: (d) => `https://dns.adguard-dns.com/resolve?name=${encodeURIComponent(d)}&type=A`,
  },
];

export async function checkDnsPropagation(domain: string): Promise<DnsPropagation | null> {
  try {
    const results = await Promise.allSettled(
      DOH_RESOLVERS.map(async (resolver): Promise<DnsResolverResult> => {
        const start = Date.now();
        try {
          const res = await fetchWithTimeout(resolver.url(domain), {
            timeout: 3000,
            headers: resolver.headers ?? {},
          });
          const elapsed = Date.now() - start;
          if (!res.ok) {
            return { name: resolver.name, ips: [], response_time_ms: elapsed, status: "error" };
          }
          const data = (await res.json()) as DohResponse;
          // Type 1 = A record
          const ips = (data.Answer ?? [])
            .filter((a) => a.type === 1)
            .map((a) => a.data)
            .sort();
          return { name: resolver.name, ips, response_time_ms: elapsed, status: "ok" };
        } catch (err) {
          const elapsed = Date.now() - start;
          const isTimeout = err instanceof Error && (err.message.includes("timeout") || err.message.includes("abort"));
          return { name: resolver.name, ips: [], response_time_ms: elapsed, status: isTimeout ? "timeout" : "error" };
        }
      }),
    );

    const resolvers = results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { name: "Unknown", ips: [] as string[], response_time_ms: 0, status: "error" as const },
    );

    // Determine consistency — use overlap analysis instead of exact match.
    // CDN/GeoDNS/load balancers intentionally return different IP subsets to
    // different resolvers. Only flag inconsistency when a resolver returns IPs
    // with ZERO overlap with ALL other resolvers, or returns NXDOMAIN while
    // others succeed.
    const successfulSets = resolvers.filter((r) => r.status === "ok" && r.ips.length > 0).map((r) => new Set(r.ips));
    const failedWithNoIps = resolvers.filter((r) => r.status === "ok" && r.ips.length === 0);
    const hasNxdomainWhileOthersSucceed = failedWithNoIps.length > 0 && successfulSets.length > 0;

    let consistent = true;
    if (hasNxdomainWhileOthersSucceed) {
      // One resolver says the domain doesn't exist while others return IPs
      consistent = false;
    } else if (successfulSets.length >= 2) {
      // Check each resolver's IPs against all others — flag only if a resolver
      // has ZERO overlap with every other resolver
      for (let i = 0; i < successfulSets.length; i++) {
        const setA = successfulSets[i];
        let hasOverlapWithAny = false;
        for (let j = 0; j < successfulSets.length; j++) {
          if (i === j) continue;
          for (const ip of setA) {
            if (successfulSets[j].has(ip)) {
              hasOverlapWithAny = true;
              break;
            }
          }
          if (hasOverlapWithAny) break;
        }
        // If only one resolver and it returned IPs, that's fine
        if (successfulSets.length === 1) {
          hasOverlapWithAny = true;
        }
        if (!hasOverlapWithAny) {
          consistent = false;
          break;
        }
      }
    }

    // Collect unique IPs across all resolvers
    const allIps = new Set<string>();
    for (const r of resolvers) {
      for (const ip of r.ips) allIps.add(ip);
    }

    return { resolvers, consistent, unique_ips: [...allIps].sort() };
  } catch {
    return null;
  }
}

// ─── RIPE RIS Routing Data ───────────────────────────────────────────
// Free API, no key needed. Runs in sequence: prefix lookup → visibility + BGP updates.

export async function checkRipeRouting(ip: string): Promise<RipeRouting | null> {
  try {
    // Step 1: Get ASN and prefix for this IP
    const prefixRes = await fetchWithTimeout(
      `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(ip)}`,
      { timeout: 5000 },
    );
    if (!prefixRes.ok) return null;
    const prefixData = (await prefixRes.json()) as {
      data?: {
        asns?: Array<{ asn: number; holder: string }>;
        resource?: string;
      };
    };

    const asn = prefixData.data?.asns?.[0]?.asn ?? null;
    const asnName = prefixData.data?.asns?.[0]?.holder ?? null;
    const prefix = prefixData.data?.resource ?? null;

    if (!prefix) {
      return { asn, asn_name: asnName, prefix: null, visibility: null, bgp_updates_24h: null, routing_stability: null };
    }

    // Step 2: Visibility + BGP updates in parallel
    const [visResult, bgpResult] = await Promise.allSettled([
      fetchWithTimeout(`https://stat.ripe.net/data/routing-status/data.json?resource=${encodeURIComponent(prefix)}`, {
        timeout: 5000,
      }),
      fetchWithTimeout(
        `https://stat.ripe.net/data/bgp-updates/data.json?resource=${encodeURIComponent(prefix)}&starttime=${new Date(Date.now() - 86400000).toISOString().replace(/\.\d+Z$/, "")}`,
        { timeout: 5000 },
      ),
    ]);

    // Parse visibility
    let visibility: RipeRouting["visibility"] = null;
    if (visResult.status === "fulfilled" && visResult.value.ok) {
      try {
        const visData = (await visResult.value.json()) as {
          data?: {
            visibility?: { v4_full_table?: { total_peers: number; seeing_peers: number } };
          };
        };
        const v4 = visData.data?.visibility?.v4_full_table;
        if (v4 && v4.total_peers > 0) {
          visibility = {
            seen_by: v4.seeing_peers,
            total: v4.total_peers,
            percentage: Math.round((v4.seeing_peers / v4.total_peers) * 100),
          };
        }
      } catch {
        /* ignore parse errors */
      }
    }

    // Parse BGP updates count
    let bgpUpdates: number | null = null;
    if (bgpResult.status === "fulfilled" && bgpResult.value.ok) {
      try {
        const bgpData = (await bgpResult.value.json()) as {
          data?: { nr_updates?: number; updates?: unknown[] };
        };
        bgpUpdates = bgpData.data?.nr_updates ?? bgpData.data?.updates?.length ?? null;
      } catch {
        /* ignore parse errors */
      }
    }

    // Determine stability — anycast/CDN providers (Cloudflare, Akamai, Fastly,
    // AWS, GCP, Azure, etc.) legitimately generate high BGP update counts for
    // traffic engineering, DDoS mitigation, and PoP failover. Use relaxed
    // thresholds for known anycast ASNs to avoid false positives.
    const ANYCAST_ASNS = new Set([
      13335, // Cloudflare
      20940, // Akamai
      16509, // Amazon/AWS
      15169, // Google
      8075, // Microsoft/Azure
      54113, // Fastly
      16625, // Akamai (alt)
      14618, // Amazon (alt)
      396982, // Google Cloud
      209242, // Cloudflare (alt)
      32934, // Meta
      714, // Apple
      2906, // Netflix
      16276, // OVH
      36459, // GitHub
      46489, // Twitch
      19551, // Incapsula/Imperva
      30148, // Sucuri
      24940, // Hetzner
      63949, // Akamai/Linode
      398101, // StackPath/Highwinds
      13414, // Twitter/X
      36183, // Akamai (CDN)
      16591, // Google Fiber
    ]);
    const isAnycast = asn !== null && ANYCAST_ASNS.has(asn);
    let stability: RipeRouting["routing_stability"] = null;
    if (bgpUpdates !== null) {
      if (isAnycast) {
        // Anycast networks: much higher thresholds
        if (bgpUpdates < 50) stability = "stable";
        else if (bgpUpdates <= 500) stability = "moderate";
        else stability = "unstable";
      } else {
        if (bgpUpdates < 10) stability = "stable";
        else if (bgpUpdates <= 100) stability = "moderate";
        else stability = "unstable";
      }
    }

    return { asn, asn_name: asnName, prefix, visibility, bgp_updates_24h: bgpUpdates, routing_stability: stability };
  } catch {
    return null;
  }
}

// ─── Outage Page Detection ───────────────────────────────────────────
// Lightweight HEAD requests to check if Downdetector / IsItDown pages exist.

function getBaseDomain(domain: string): string {
  return domain.replace(/^www\./i, "");
}

export async function checkOutagePages(domain: string): Promise<OutageLinks | null> {
  const base = getBaseDomain(domain);

  const ddUrl = `https://downdetector.com/status/${encodeURIComponent(base)}/`;
  const iidUrl = `https://www.isitdownrightnow.com/${encodeURIComponent(base)}.html`;

  try {
    const [ddResult, iidResult] = await Promise.allSettled([
      fetchWithTimeout(ddUrl, {
        timeout: 3000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Yoke/1.0)" },
        redirect: "follow",
      }),
      fetchWithTimeout(iidUrl, {
        timeout: 3000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Yoke/1.0)" },
        redirect: "follow",
      }),
    ]);

    const ddExists = ddResult.status === "fulfilled" && ddResult.value.ok;
    const iidExists = iidResult.status === "fulfilled" && iidResult.value.ok;

    return {
      downdetector: { exists: ddExists, url: ddUrl },
      isitdown: { exists: iidExists, url: iidUrl },
    };
  } catch {
    return null;
  }
}

// ─── TCP Connection Timing (via Fly Probe) ───────────────────────────
// Measures DNS lookup, TCP handshake, and TLS handshake times separately.
// Requires the Fly probe to be running with the /probe-timing endpoint.

export async function checkConnectionTiming(domain: string, env: Env): Promise<ConnectionTiming | null> {
  const probeUrl = getFlyProbeUrl(env);
  if (!probeUrl) return null;

  try {
    const res = await flyProbeFetch(`${probeUrl}/probe-timing?host=${encodeURIComponent(domain)}`, env, {
      timeout: 8000,
    });
    if (!res?.ok) return null;

    const data = (await res.json()) as {
      dns_ms: number;
      tcp_ms: number;
      tls_ms: number;
      total_ms: number;
      ip: string | null;
      tls_version: string | null;
      error: string | null;
    };

    if (data.error) return null;

    return {
      dns_ms: data.dns_ms,
      tcp_ms: data.tcp_ms,
      tls_ms: data.tls_ms,
      total_ms: data.total_ms,
      ip: data.ip ?? null,
      tls_version: data.tls_version ?? null,
    };
  } catch {
    return null;
  }
}
