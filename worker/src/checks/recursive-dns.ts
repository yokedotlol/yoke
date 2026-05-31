import type { Check } from "./types";

interface DnsAnswer {
  type: number;
  data: string;
  TTL?: number;
}
interface DnsResponse {
  Status: number;
  Answer?: DnsAnswer[];
}

interface ResolverConfig {
  name: string;
  provider: string;
  urlA: string;
  urlAAAA: string;
  headers: Record<string, string>;
}

async function queryResolver(cfg: ResolverConfig) {
  const start = Date.now();
  let a_records: string[] = [];
  let aaaa_records: string[] = [];
  let ttl: number | null = null;
  let status: "ok" | "nxdomain" | "servfail" | "timeout" | "error" = "ok";

  try {
    const [aRes, aaaaRes] = await Promise.all([
      fetch(cfg.urlA, { headers: cfg.headers, signal: AbortSignal.timeout(5000) }),
      fetch(cfg.urlAAAA, { headers: cfg.headers, signal: AbortSignal.timeout(5000) }),
    ]);

    const aData = (await aRes.json()) as DnsResponse;
    const aaaaData = (await aaaaRes.json()) as DnsResponse;

    const dnsStatus = aData.Status;
    if (dnsStatus === 3) status = "nxdomain";
    else if (dnsStatus === 2) status = "servfail";
    else if (dnsStatus !== 0) status = "error";

    if (aData.Answer) {
      a_records = aData.Answer.filter((a) => a.type === 1).map((a) => a.data);
      const firstTtl = aData.Answer.find((a) => a.type === 1)?.TTL;
      if (firstTtl != null) ttl = firstTtl;
    }
    if (aaaaData.Answer) {
      aaaa_records = aaaaData.Answer.filter((a) => a.type === 28).map((a) => a.data);
      if (ttl == null) {
        const firstTtl = aaaaData.Answer.find((a) => a.type === 28)?.TTL;
        if (firstTtl != null) ttl = firstTtl;
      }
    }
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      status = "timeout";
    } else {
      status = "error";
    }
  }

  return {
    name: cfg.name,
    provider: cfg.provider,
    a_records,
    aaaa_records,
    ttl,
    status,
    response_time_ms: Date.now() - start,
  };
}

/** Run recursive DNS resolution across Google, Cloudflare, and Quad9 public resolvers. */
export async function checkRecursiveDns(domain: string) {
  const resolvers: ResolverConfig[] = [
    {
      name: "Google",
      provider: "8.8.8.8",
      urlA: `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`,
      urlAAAA: `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=AAAA`,
      headers: {},
    },
    {
      name: "Cloudflare",
      provider: "1.1.1.1",
      urlA: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      urlAAAA: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=AAAA`,
      headers: { Accept: "application/dns-json" },
    },
    {
      name: "Quad9",
      provider: "9.9.9.9",
      urlA: `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      urlAAAA: `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(domain)}&type=AAAA`,
      headers: { Accept: "application/dns-json" },
    },
  ];

  const results = await Promise.all(resolvers.map(queryResolver));

  // Consensus: all resolvers with status "ok" return the same sorted A records
  const okResolvers = results.filter((r) => r.status === "ok");
  let consensus = false;
  if (okResolvers.length > 1) {
    const first = okResolvers[0].a_records.slice().sort().join(",");
    consensus = okResolvers.every((r) => r.a_records.slice().sort().join(",") === first);
  } else if (okResolvers.length === 1) {
    consensus = true;
  }

  return {
    domain,
    resolvers: results,
    consensus,
    timestamp: new Date().toISOString(),
  };
}

export const recursiveDnsCheck: Check = {
  key: "recursive_dns",
  label: "Recursive DNS",
  default: null,
  run: (ctx) => checkRecursiveDns(ctx.domain),
};
