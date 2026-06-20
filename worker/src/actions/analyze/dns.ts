import { recordApiCall } from "../../analysis-budget";
import { logApiError } from "../../api-errors";
import type { Env } from "../../helpers";
import { fetchWithTimeout, MULTI_PART_TLDS } from "../../helpers";
import type { DnsRecord, RdapResult } from "./types";

// ─── DNS ─────────────────────────────────────────────────────────────

export const DNS_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "CAA"] as const;

// DoH resolvers — try Google first, fall back to Cloudflare
const DOH_RESOLVERS = ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"] as const;

/** Query a DoH resolver with fallback. Returns parsed JSON response or null. */
async function dohQuery(
  name: string,
  type: string,
  timeout = 5000,
): Promise<{ Status: number; Answer?: Array<{ name: string; type: number; TTL: number; data: string }> } | null> {
  for (const resolver of DOH_RESOLVERS) {
    try {
      const res = await fetchWithTimeout(`${resolver}?name=${encodeURIComponent(name)}&type=${type}`, {
        timeout,
        headers: resolver.includes("cloudflare") ? { Accept: "application/dns-json" } : undefined,
      });
      if (res.ok) {
        return (await res.json()) as {
          Status: number;
          Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
        };
      }
    } catch {
      /* resolver failed, try next */
    }
  }
  return null;
}

export { dohQuery };

export async function checkDns(domain: string): Promise<DnsRecord[]> {
  const results: DnsRecord[] = [];

  // Standard record types for the root domain
  const queries = DNS_TYPES.map(async (type) => {
    try {
      const data = await dohQuery(domain, type);
      if (data && data.Status === 0 && data.Answer) {
        for (const ans of data.Answer) {
          results.push({ type, name: ans.name.replace(/\.$/, ""), ttl: ans.TTL, data: ans.data });
        }
      }
    } catch {
      /* individual type failure is fine */
    }
  });

  await Promise.allSettled(queries);

  // Wildcard DNS detection: probe a random subdomain to see if it resolves.
  // Domains with wildcard records (*.example.com) will resolve ANY subdomain,
  // producing false positives for _ans / _agents TXT lookups.
  let hasWildcardDns = false;
  try {
    const probe = await dohQuery(`_yoke-wildcard-probe-${Date.now()}.${domain}`, "A", 3000);
    if (probe && probe.Status === 0 && probe.Answer?.length) {
      hasWildcardDns = true;
    }
  } catch {
    /* probe failure = no wildcard */
  }

  // Agent discovery records (ANS + DNS-AID subdomains) — skip if wildcard DNS detected
  if (!hasWildcardDns) {
    const agentQueries = [
      { prefix: "_ans", label: "TXT" },
      { prefix: "_agents", label: "TXT" },
      { prefix: "_agentid", label: "TXT" },
    ].map(async ({ prefix, label }) => {
      try {
        const data = await dohQuery(`${prefix}.${domain}`, label);
        if (data && data.Status === 0 && data.Answer) {
          for (const ans of data.Answer) {
            results.push({ type: label, name: ans.name.replace(/\.$/, ""), ttl: ans.TTL, data: ans.data });
          }
        }
      } catch {
        /* agent record lookup failure is fine */
      }
    });
    await Promise.allSettled(agentQueries);
  }
  return results;
}

// ─── Subdomain Detection ─────────────────────────────────────────────

export function getParentDomain(domain: string): string | null {
  const parts = domain.split(".");
  // Handles multi-part TLDs: .co.uk, .com.au, etc.
  const multiPartTlds = MULTI_PART_TLDS;
  const domainLower = domain.toLowerCase();
  for (const mpt of multiPartTlds) {
    if (domainLower.endsWith(`.${mpt}`)) {
      // e.g. blog.example.co.uk → parts = [blog, example, co, uk] → need 4+ parts
      if (parts.length > mpt.split(".").length + 1) {
        return parts.slice(1).join(".");
      }
      return null; // It's already a base domain for this multi-part TLD
    }
  }
  // Standard TLDs: blog.example.com → parts = [blog, example, com]
  if (parts.length > 2) return parts.slice(1).join(".");
  return null;
}

export function isSubdomain(domain: string): boolean {
  return getParentDomain(domain) !== null;
}

// ─── RDAP ────────────────────────────────────────────────────────────

// Known RDAP endpoints — curated for TLDs NOT reliably in the IANA bootstrap
export const RDAP_ENDPOINTS: Record<string, string> = {
  // === Generic TLDs ===
  com: "https://rdap.verisign.com/com/v1",
  net: "https://rdap.verisign.com/net/v1",
  org: "https://rdap.publicinterestregistry.org/rdap",
  info: "https://rdap.identitydigital.services/rdap",
  biz: "https://rdap.nic.biz/",
  xyz: "https://rdap.centralnic.com/xyz",
  lol: "https://rdap.centralnic.com/lol",

  // === Google TLDs (single endpoint) ===
  app: "https://pubapi.registry.google/rdap",
  dev: "https://pubapi.registry.google/rdap",
  page: "https://pubapi.registry.google/rdap",
  day: "https://pubapi.registry.google/rdap",
  "new": "https://pubapi.registry.google/rdap",
  how: "https://pubapi.registry.google/rdap",
  soy: "https://pubapi.registry.google/rdap",
  meme: "https://pubapi.registry.google/rdap",
  mov: "https://pubapi.registry.google/rdap",
  zip: "https://pubapi.registry.google/rdap",
  foo: "https://pubapi.registry.google/rdap",

  // === Verisign-operated ccTLDs ===
  cc: "https://tld-rdap.verisign.com/cc/v1",
  tv: "https://rdap.nic.tv",

  // === Identity Digital (formerly Donuts/Afilias) ===
  ai: "https://rdap.identitydigital.services/rdap",
  mu: "https://rdap.identitydigital.services/rdap",

  // === CentralNic ===
  fm: "https://rdap.centralnic.com/fm",

  // === ccTLDs NOT in IANA bootstrap (curated) ===
  io: "https://rdap.nic.io",
  co: "https://rdap.nic.co",
  me: "https://rdap.nic.me",
  us: "https://rdap.nic.us",
  so: "https://rdap.nic.so",
  de: "https://rdap.denic.de",
  uk: "https://rdap.nominet.uk/uk",
  fr: "https://rdap.nic.fr",
  nl: "https://rdap.sidn.nl",
  au: "https://rdap.cctld.au/rdap/",
  ca: "https://rdap.ca.fury.ca/rdap",
  eu: "https://rdap.eurid.eu",
  be: "https://rdap.dns.be",
  se: "https://rdap.iis.se",
  ch: "https://rdap.nic.ch",
  at: "https://rdap.nic.at",
  nz: "https://rdap.nzrs.net.nz",
  jp: "https://rdap.jprs.jp/rdap",
  gov: "https://rdap.nic.gov/rdap",

  // === ccTLDs in IANA bootstrap (recently added) ===
  ly: "https://rdap.nic.ly",
  in: "https://rdap.nixiregistry.in/rdap",
  pl: "https://rdap.dns.pl",
  id: "https://rdap.pandi.id/rdap/",
  is: "https://rdap.isnic.is/rdap",
  no: "https://rdap.norid.no",
  br: "https://rdap.registro.br",
  ar: "https://rdap.nic.ar",
  cz: "https://rdap.nic.cz",
  si: "https://rdap.register.si",
  fi: "https://rdap.fi/rdap/rdap",
  ua: "https://rdap.hostmaster.ua",
  th: "https://rdap.thains.co.th",
  tw: "https://ccrdap.twnic.tw/tw",
  sg: "https://rdap.sgnic.sg/rdap/",
  ec: "https://rdap.registry.ec/",
  ke: "https://rdap.kenic.or.ke",

  // === Popular gTLDs (IANA bootstrap) ===
  blog: "https://rdap.blog.fury.ca/rdap/",
  cloud: "https://rdap.registry.cloud/rdap/",
  design: "https://rdap.nic.design/",
  icu: "https://rdap.centralnic.com/icu/",
  online: "https://rdap.radix.host/rdap/",
  pro: "https://rdap.identitydigital.services/rdap/",
  shop: "https://rdap.gmoregistry.net/rdap/",
  site: "https://rdap.radix.host/rdap/",
  store: "https://rdap.radix.host/rdap/",
  tech: "https://rdap.radix.host/rdap/",

  // === Additional ccTLDs (IANA bootstrap) ===
  uz: "https://rdap.cctld.uz/",
  ng: "https://rdap.nic.net.ng/",
};

// ─── IANA Bootstrap (Dynamic TLD→RDAP map, cached in-memory) ─────────

const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
let bootstrapCache: Map<string, string> | null = null;
let bootstrapFetchedAt = 0;
const BOOTSTRAP_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Parse IANA RDAP bootstrap JSON into a TLD→URL map. */
export function parseIanaBootstrap(data: { services: [string[], string[]][] }): Map<string, string> {
  const map = new Map<string, string>();
  if (!data?.services) return map;
  for (const [tlds, urls] of data.services) {
    if (!urls?.length) continue;
    const url = urls[0].replace(/\/+$/, "");
    for (const t of tlds) {
      map.set(t.toLowerCase(), url);
    }
  }
  return map;
}

async function getBootstrapEndpoint(tld: string): Promise<string | null> {
  const now = Date.now();
  if (!bootstrapCache || now - bootstrapFetchedAt > BOOTSTRAP_TTL) {
    try {
      const res = await fetchWithTimeout(IANA_BOOTSTRAP_URL, { timeout: 8000 });
      if (res.ok) {
        const data = (await res.json()) as { services: [string[], string[]][] };
        bootstrapCache = parseIanaBootstrap(data);
        bootstrapFetchedAt = now;
      }
    } catch {
      // keep using stale cache or fall through
    }
  }
  return bootstrapCache?.get(tld) ?? null;
}

// ─── Registrar Name Extraction (with fallbacks) ─────────────────────

export function extractRegistrar(
  entities: Array<{
    roles?: string[];
    vcardArray?: [string, Array<[string, Record<string, unknown>, string, string]>];
    handle?: string;
    publicIds?: Array<{ type: string; identifier: string }>;
  }>,
): string | null {
  for (const entity of entities) {
    if (!entity.roles?.includes("registrar")) continue;

    // Try vcardArray first (most common)
    if (entity.vcardArray) {
      const fn = entity.vcardArray[1]?.find((v) => v[0] === "fn");
      if (fn?.[3]) return fn[3];
    }

    // Fallback: publicIds (IANA Registrar ID)
    if (entity.publicIds) {
      const ianaId = entity.publicIds.find((p) => p.type === "IANA Registrar ID");
      if (ianaId) return `Registrar ID: ${ianaId.identifier}`;
    }

    // Fallback: handle (sometimes contains registrar name)
    if (entity.handle) return entity.handle;
  }
  return null;
}

// ─── Parse RDAP Response ─────────────────────────────────────────────

function parseRdapResponse(data: {
  events?: Array<{ eventAction: string; eventDate: string }>;
  nameservers?: Array<{ ldhName: string }>;
  status?: string[];
  entities?: Array<{
    roles?: string[];
    vcardArray?: [string, Array<[string, Record<string, unknown>, string, string]>];
    handle?: string;
    publicIds?: Array<{ type: string; identifier: string }>;
  }>;
}): RdapResult {
  const registrar = data.entities ? extractRegistrar(data.entities) : null;

  const events = data.events ?? [];
  const regEvent = events.find((e) => e.eventAction === "registration");
  const expEvent = events.find((e) => e.eventAction === "expiration");
  const chgEvent = events.find((e) => e.eventAction === "last changed");

  const now = Date.now();
  let domainAgeDays: number | null = null;
  let daysUntilExpiry: number | null = null;
  if (regEvent?.eventDate) domainAgeDays = Math.floor((now - new Date(regEvent.eventDate).getTime()) / 86400000);
  if (expEvent?.eventDate) daysUntilExpiry = Math.floor((new Date(expEvent.eventDate).getTime() - now) / 86400000);

  return {
    registrar,
    registration_date: regEvent?.eventDate ?? null,
    expiration_date: expEvent?.eventDate ?? null,
    last_changed: chgEvent?.eventDate ?? null,
    nameservers: (data.nameservers ?? []).map((ns) => ns.ldhName),
    status: data.status ?? [],
    domain_age_days: domainAgeDays,
    days_until_expiry: daysUntilExpiry,
  };
}

// ─── WhoisFreaks Fallback ────────────────────────────────────────────

async function whoisFreaksFallback(domain: string, env?: Env): Promise<RdapResult | null> {
  const apiKey = env?.WHOISFREAKS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetchWithTimeout(
      `https://api.whoisfreaks.com/v1.0/whois?apiKey=${encodeURIComponent(apiKey)}&whois=live&domainName=${encodeURIComponent(domain)}`,
      { timeout: 10000 },
    );
    if (!res.ok) {
      if (env?.STATS_DB)
        logApiError(env.STATS_DB, { api: "whoisfreaks", status: res.status, message: `WHOIS lookup failed`, domain });
      return null;
    }
    // Billable call succeeded — record for the cost dashboard (fire-and-forget).
    if (env) recordApiCall(env, "whoisfreaks");
    const data = (await res.json()) as {
      create_date?: string;
      update_date?: string;
      expiry_date?: string;
      domain_registrar?: { registrar_name?: string };
      name_servers?: string[];
      domain_status?: string[];
      whois_raw_domain?: string;
    };

    // Extract registrar — try structured field first, then parse from raw WHOIS
    let registrar = data.domain_registrar?.registrar_name ?? null;
    if (!registrar && data.whois_raw_domain) {
      const match = data.whois_raw_domain.match(/registrar:\s*(.+)/i);
      if (match) registrar = match[1].trim();
    }

    const now = Date.now();
    let domainAgeDays: number | null = null;
    let daysUntilExpiry: number | null = null;
    if (data.create_date) domainAgeDays = Math.floor((now - new Date(data.create_date).getTime()) / 86400000);
    if (data.expiry_date) daysUntilExpiry = Math.floor((new Date(data.expiry_date).getTime() - now) / 86400000);

    return {
      registrar,
      registration_date: data.create_date ?? null,
      expiration_date: data.expiry_date ?? null,
      last_changed: data.update_date ?? null,
      nameservers: data.name_servers ?? [],
      status: data.domain_status ?? [],
      domain_age_days: domainAgeDays,
      days_until_expiry: daysUntilExpiry,
    };
  } catch (e) {
    if (env?.STATS_DB)
      logApiError(env.STATS_DB, { api: "whoisfreaks", status: 0, message: String(e).slice(0, 200), domain });
    return null;
  }
}

// ─── RDAP Lookup (with retry, bootstrap, and WhoisFreaks fallback) ───

export async function tryRdap(domain: string, env?: Env): Promise<RdapResult | null> {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";

  // Build ordered list of RDAP URLs to try:
  // 1. Static curated endpoint (covers TLDs not in IANA bootstrap)
  // 2. Dynamic IANA bootstrap endpoint
  const urls: string[] = [];

  const knownEndpoint = RDAP_ENDPOINTS[tld];
  if (knownEndpoint) {
    urls.push(`${knownEndpoint}/domain/${encodeURIComponent(domain)}`);
  }

  // Try IANA bootstrap as second option (or first if no static entry)
  const bootstrapEndpoint = await getBootstrapEndpoint(tld);
  if (bootstrapEndpoint) {
    const bootstrapUrl = `${bootstrapEndpoint.replace(/\/+$/, "")}/domain/${encodeURIComponent(domain)}`;
    // Only add if different from the static endpoint
    if (!urls.includes(bootstrapUrl)) {
      urls.push(bootstrapUrl);
    }
  }

  // Try each URL with single-retry on timeout/5xx
  for (const rdapUrl of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(rdapUrl, { timeout: 8000 });
        if (res.status >= 500) {
          // 5xx → retry once
          if (attempt === 0) continue;
          if (env?.STATS_DB)
            logApiError(env.STATS_DB, {
              api: "rdap",
              status: res.status,
              message: `RDAP 5xx from ${new URL(rdapUrl).hostname}`,
              domain,
            });
          break; // give up on this URL after retry
        }
        if (!res.ok) break; // 4xx → skip to next URL
        const data = (await res.json()) as Parameters<typeof parseRdapResponse>[0];
        return parseRdapResponse(data);
      } catch (e) {
        // Timeout or network error → retry once
        if (attempt === 0) continue;
        if (env?.STATS_DB)
          logApiError(env.STATS_DB, {
            api: "rdap",
            status: 0,
            message: `${new URL(rdapUrl).hostname}: ${String(e).slice(0, 150)}`,
            domain,
          });
        break; // give up on this URL after retry
      }
    }
  }

  // All RDAP sources failed — try WhoisFreaks as final fallback
  return whoisFreaksFallback(domain, env);
}

export async function checkRdap(domain: string, env?: Env): Promise<RdapResult | null> {
  // For subdomains, skip the subdomain RDAP lookup entirely — go straight to parent
  const parent = getParentDomain(domain);
  if (parent) {
    return tryRdap(parent, env);
  }

  // For base domains, try RDAP directly
  return tryRdap(domain, env);
}
