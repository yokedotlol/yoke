import type { CookieAudit, CookieSecurityResult, DnsRecord, HostingResult, IpInfo } from "./types";

// ─── Cloudflare Worker Header Sanitization ──────────────────────────
// CF Workers inject their own headers (server: cloudflare, cf-ray, cf-cache-status, etc.)
// into ALL fetch responses, even for non-CF origins. We must strip these when the target
// site is NOT actually behind Cloudflare to avoid false CDN/security/tech detection.

export const CF_INJECTED_HEADERS = [
  "cf-ray",
  "cf-cache-status",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-visitor",
  "cf-worker",
  "nel",
  "report-to",
];

/** Check if a domain is genuinely behind Cloudflare (not just Worker fetch pollution) */
export function isActuallyCloudflare(dnsRecords: DnsRecord[], ipInfo: IpInfo | null): boolean {
  // Check 1: NS records point to Cloudflare nameservers
  const nsRecords = dnsRecords.filter((r) => r.type === "NS");
  const hasCfNameservers = nsRecords.some((r) => /\.ns\.cloudflare\.com\.?$/i.test(r.data));
  if (hasCfNameservers) return true;

  // Check 2: IP belongs to Cloudflare ASN (AS13335)
  if (ipInfo?.asn && /AS13335/i.test(ipInfo.asn)) return true;

  // Check 3: Reverse DNS points to Cloudflare
  if (ipInfo?.reverse_dns && /cloudflare/i.test(ipInfo.reverse_dns)) return true;

  return false;
}

/** Strip CF Worker-injected headers from a response header map */
export function sanitizeCfHeaders(headers: Record<string, string>): Record<string, string> {
  const cleaned = { ...headers };
  for (const key of CF_INJECTED_HEADERS) {
    delete cleaned[key];
  }
  // Remove the injected `server: cloudflare` header — restore original if possible
  if (cleaned.server && /^cloudflare$/i.test(cleaned.server)) {
    delete cleaned.server;
  }
  return cleaned;
}

// ─── NEW: Hosting Provider / WAF / CDN Detection ────────────────────

export const HOSTING_PATTERNS: Array<{
  name: string;
  type: "provider" | "cdn" | "waf";
  patterns: { org?: RegExp[]; rdns?: RegExp[]; headers?: Record<string, RegExp> };
}> = [
  // CDN / WAF (check first as they front the real host)
  // NOTE: Cloudflare detection is handled separately via isActuallyCloudflare() + nameserver/ASN check.
  // The header-only pattern is kept but will only match when headers haven't been sanitized (i.e., site IS behind CF).
  { name: "Cloudflare", type: "cdn", patterns: { headers: { server: /cloudflare/i } } },
  {
    name: "AWS CloudFront",
    type: "cdn",
    patterns: { headers: { "x-amz-cf-id": /./, via: /CloudFront/i }, rdns: [/cloudfront\.net$/] },
  },
  { name: "Akamai", type: "cdn", patterns: { headers: { "x-akamai-transformed": /./ }, rdns: [/akamai/i] } },
  {
    name: "Fastly",
    type: "cdn",
    patterns: { headers: { "x-served-by": /cache/, via: /varnish/i }, rdns: [/fastly/i] },
  },
  {
    name: "BunnyCDN",
    type: "cdn",
    patterns: { headers: { server: /^bunnycdn/i, "cdn-pullzone": /./ } },
  },
  {
    name: "KeyCDN",
    type: "cdn",
    patterns: { headers: { server: /^keycdn$/i, "x-edge-location": /./ } },
  },
  {
    name: "Azure CDN",
    type: "cdn",
    patterns: { headers: { "x-azure-ref": /./, "x-msedge-ref": /./ } },
  },
  {
    name: "Google Cloud CDN",
    type: "cdn",
    patterns: { headers: { via: /\bgoogle\b/i } },
  },
  {
    name: "StackPath",
    type: "cdn",
    patterns: { headers: { "x-hw": /./ }, rdns: [/stackpath/i, /highwinds/i] },
  },
  { name: "Sucuri WAF", type: "waf", patterns: { headers: { "x-sucuri-id": /./, server: /sucuri/i } } },
  { name: "Imperva/Incapsula", type: "waf", patterns: { headers: { "x-iinfo": /./, "x-cdn": /incapsula/i } } },
  // Hosting providers
  { name: "AWS", type: "provider", patterns: { org: [/amazon|aws/i], rdns: [/amazonaws\.com$/, /\.aws\./i] } },
  {
    name: "Google Cloud",
    type: "provider",
    patterns: { org: [/google cloud/i], rdns: [/googleusercontent\.com$/, /1e100\.net$/] },
  },
  {
    name: "Microsoft Azure",
    type: "provider",
    patterns: { org: [/microsoft/i], rdns: [/azure/i, /\.microsoft\.com$/] },
  },
  { name: "Vercel", type: "provider", patterns: { headers: { "x-vercel-id": /./, server: /vercel/i } } },
  { name: "Netlify", type: "provider", patterns: { headers: { server: /netlify/i, "x-nf-request-id": /./ } } },
  { name: "DigitalOcean", type: "provider", patterns: { org: [/digitalocean/i], rdns: [/digitalocean/i] } },
  { name: "Hetzner", type: "provider", patterns: { org: [/hetzner/i], rdns: [/hetzner/i] } },
  { name: "OVH", type: "provider", patterns: { org: [/ovh/i], rdns: [/ovh\./i] } },
  { name: "GoDaddy", type: "provider", patterns: { org: [/godaddy/i], rdns: [/secureserver\.net$/] } },
  { name: "Shopify", type: "provider", patterns: { headers: { "x-shopify-stage": /./ }, rdns: [/shopify/i] } },
  { name: "WP Engine", type: "provider", patterns: { headers: { "x-powered-by": /WP Engine/i }, rdns: [/wpengine/i] } },
  {
    name: "Squarespace",
    type: "provider",
    patterns: { headers: { "x-servedby": /squarespace/i }, rdns: [/squarespace/i] },
  },
  { name: "Wix", type: "provider", patterns: { headers: { "x-wix-request-id": /./ } } },
  { name: "Fly.io", type: "provider", patterns: { headers: { "fly-request-id": /./ }, rdns: [/fly\.dev$/] } },
  { name: "Railway", type: "provider", patterns: { rdns: [/railway\.app$/] } },
  { name: "Render", type: "provider", patterns: { rdns: [/onrender\.com$/] } },
  { name: "GitHub Pages", type: "provider", patterns: { headers: { server: /GitHub\.com/i }, rdns: [/github\.io$/] } },
  { name: "Linode/Akamai", type: "provider", patterns: { org: [/linode|akamai/i], rdns: [/linode/i] } },
];

export function detectHosting(ipInfo: IpInfo | null, headers: Record<string, string> | null): HostingResult {
  const result: HostingResult = { provider: null, cdn: null, waf: null };
  if (!headers && !ipInfo) return result;

  for (const hp of HOSTING_PATTERNS) {
    let matched = false;

    if (hp.patterns.headers && headers) {
      for (const [key, regex] of Object.entries(hp.patterns.headers)) {
        if (headers[key] && regex.test(headers[key])) {
          matched = true;
          break;
        }
      }
    }
    if (!matched && hp.patterns.rdns && ipInfo?.reverse_dns) {
      for (const regex of hp.patterns.rdns) {
        if (regex.test(ipInfo.reverse_dns)) {
          matched = true;
          break;
        }
      }
    }
    if (!matched && hp.patterns.org && ipInfo?.org) {
      for (const regex of hp.patterns.org) {
        if (regex.test(ipInfo.org)) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      if (hp.type === "cdn" && !result.cdn) result.cdn = hp.name;
      else if (hp.type === "waf" && !result.waf) result.waf = hp.name;
      else if (hp.type === "provider" && !result.provider) result.provider = hp.name;
    }
  }

  return result;
}

// ─── NEW: Cookie Security Audit ─────────────────────────────────────

export function auditCookies(headers: Record<string, string> | null): CookieSecurityResult | null {
  if (!headers) return null;
  const setCookieHeader = headers["set-cookie"];
  if (!setCookieHeader) return null;

  // set-cookie headers can be combined with commas, but cookies can contain commas in dates
  // (e.g., "Expires=Thu, 01 Jan 2026"). Split carefully: a new cookie starts with a
  // token=value pattern after a comma, but date strings have commas inside Expires values.
  // Use a more robust regex that won't split on commas inside date values.
  const cookieStrings: string[] = [];
  // First try splitting on newlines (multi-header format)
  const rawParts = setCookieHeader.split(/\n/);
  for (const part of rawParts) {
    // Within each line, split on commas that are followed by a cookie name=value pattern
    // but not preceded by a day name (Mon, Tue, etc.) which indicates a date
    const subParts = part.split(/,(?=\s*[a-zA-Z0-9_][a-zA-Z0-9_.!#$%&'*+\-^`|~]*=)/);
    cookieStrings.push(...subParts);
  }
  const cookies: CookieAudit[] = [];
  const issues: string[] = [];

  for (const cs of cookieStrings) {
    const trimmed = cs.trim();
    if (!trimmed) continue;
    const nameMatch = trimmed.match(/^([^=]+)=/);
    if (!nameMatch) continue;
    const name = nameMatch[1]?.trim() ?? "";
    const lower = trimmed.toLowerCase();
    const secure = lower.includes("secure");
    const httponly = lower.includes("httponly");
    const sameSiteMatch = lower.match(/samesite=(strict|lax|none)/);
    const samesite = sameSiteMatch?.[1] ?? null;

    cookies.push({ name, secure, httponly, samesite });

    if (!secure) issues.push(`${name}: missing Secure flag`);
    // __Host- prefix already enforces Secure + Path=/ + no Domain; HttpOnly is orthogonal
    // to those guarantees (it controls JS access, not transport), so we skip the check.
    // _ga cookies are analytics and commonly set without HttpOnly.
    if (!httponly && !name.startsWith("__Host-") && !name.startsWith("_ga")) {
      issues.push(`${name}: missing HttpOnly flag`);
    }
    if (!samesite) {
      // Chrome 80+ (Feb 2020) defaults missing SameSite to Lax — don't flag as issue
    }
    if (samesite === "none" && !secure) issues.push(`${name}: SameSite=None requires Secure flag`);
  }

  if (cookies.length === 0) return null;
  return { cookies, issues };
}
