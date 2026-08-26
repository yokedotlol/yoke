import { boundedText, fetchWithTimeout, safeFetchWithRedirects } from "../../helpers";
import type {
  CaaDisplayResult,
  CertIssuance,
  CertTransparencyResult,
  DnsRecord,
  GreenHostingResult,
  GreynoiseResult,
  SecurityTxtResult,
  WellKnownEndpoint,
  WellKnownResult,
} from "./types";

// ─── Tier 1: Certificate Transparency (CertSpotter) ─────────────────

/** Extract CN from a full X.509 Distinguished Name string (e.g. "C=US, O=Let's Encrypt, CN=R3" → "R3") */
function extractCN(dn: string | undefined | null): string | null {
  if (!dn) return null;
  const match = dn.match(/CN=([^,]+)/i);
  return match?.[1]?.trim() ?? null;
}

export async function checkCertTransparency(domain: string): Promise<CertTransparencyResult> {
  try {
    const res = await fetchWithTimeout(
      `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&include_subdomains=true&expand=dns_names&expand=issuer`,
      { timeout: 10000 },
    );
    if (!res.ok)
      return {
        subdomains: [],
        total_certs: 0,
        has_wildcard: false,
        issuers: [],
        certs: [],
        error: `HTTP ${res.status}`,
      };
    const issuances = (await res.json()) as Array<{
      dns_names: string[];
      issuer?: { name?: string; friendly_name?: string };
      not_before?: string;
      not_after?: string;
    }>;
    const allNames = new Set<string>();
    const issuersSet = new Set<string>();
    const certs: CertIssuance[] = [];
    let hasWildcard = false;
    for (const iss of issuances) {
      const dnsNames: string[] = [];
      if (iss.dns_names) {
        for (const name of iss.dns_names) {
          if (name.startsWith("*.")) {
            hasWildcard = true;
          } else {
            allNames.add(name.toLowerCase());
          }
          dnsNames.push(name);
        }
      }
      const issuerName = iss.issuer?.friendly_name ?? extractCN(iss.issuer?.name) ?? "Unknown";
      if (issuerName !== "Unknown") issuersSet.add(issuerName);
      if (iss.not_before) {
        certs.push({
          issuer: issuerName,
          not_before: iss.not_before,
          not_after: iss.not_after ?? "",
          dns_names: dnsNames,
        });
      }
    }
    // Remove the domain itself and sort
    allNames.delete(domain.toLowerCase());
    const subdomains = [...allNames].filter((n) => n.endsWith(`.${domain.toLowerCase()}`)).sort();
    return {
      subdomains,
      total_certs: issuances.length,
      has_wildcard: hasWildcard,
      issuers: [...issuersSet],
      certs,
      error: null,
    };
  } catch (e) {
    return {
      subdomains: [],
      total_certs: 0,
      has_wildcard: false,
      issuers: [],
      certs: [],
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ─── Tier 1: security.txt Discovery ─────────────────────────────────

export async function checkSecurityTxt(domain: string, instanceHost?: string): Promise<SecurityTxtResult> {
  const empty: SecurityTxtResult = {
    found: false,
    contact: [],
    encryption: null,
    acknowledgments: null,
    policy: null,
    hiring: null,
    canonical: null,
    preferred_languages: null,
    expires: null,
    is_expired: false,
    has_bug_bounty: false,
    bug_bounty_platform: null,
    raw: null,
  };

  // Self-analysis bypass: CF Workers can't fetch their own domain.
  // Return our known security.txt content directly.
  if (instanceHost && domain === instanceHost) {
    const { SECURITY_TXT } = await import("../../pages");
    const text = SECURITY_TXT;
    return parseSecurityTxt(text, empty, `https://${domain}/.well-known/security.txt`);
  }

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  // Try both with and without www
  const urls = [`https://${domain}/.well-known/security.txt`];
  if (!domain.startsWith("www.")) urls.push(`https://www.${domain}/.well-known/security.txt`);

  let text: string | null = null;
  for (const url of urls) {
    try {
      const res = await safeFetchWithRedirects(url, { timeout: 6000, headers: { "User-Agent": ua } });
      if (!res.ok) continue;
      const body = await boundedText(res);
      if (body.includes("Contact:") || body.includes("contact:")) {
        text = body;
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!text) return empty;
  return parseSecurityTxt(text, empty, urls[0] ?? `https://${domain}/.well-known/security.txt`);
}

function parseSecurityTxt(text: string, empty: SecurityTxtResult, _canonicalUrl: string): SecurityTxtResult {
  const result: SecurityTxtResult = { ...empty, found: true, raw: text.slice(0, 2000) };
  for (const line of text.split("\n")) {
    const trimmed = line.split("#")[0]?.trim() ?? "";
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
    const value = trimmed.substring(colonIdx + 1).trim();
    switch (key) {
      case "contact":
        result.contact.push(value);
        break;
      case "encryption":
        result.encryption = value;
        break;
      case "acknowledgments":
      case "acknowledgements":
        result.acknowledgments = value;
        break;
      case "policy":
        result.policy = value;
        break;
      case "hiring":
        result.hiring = value;
        break;
      case "canonical":
        result.canonical = value;
        break;
      case "preferred-languages":
        result.preferred_languages = value;
        break;
      case "expires":
        result.expires = value;
        break;
    }
  }
  // Check expiry
  if (result.expires) {
    try {
      const expiryDate = new Date(result.expires);
      result.is_expired = expiryDate.getTime() < Date.now();
    } catch {
      /* ignore invalid date */
    }
  }
  // Detect bug bounty platforms
  const allText = `${result.contact.join(" ")} ${result.policy ?? ""}`.toLowerCase();
  if (allText.includes("hackerone")) {
    result.has_bug_bounty = true;
    result.bug_bounty_platform = "HackerOne";
  } else if (allText.includes("bugcrowd")) {
    result.has_bug_bounty = true;
    result.bug_bounty_platform = "Bugcrowd";
  } else if (allText.includes("intigriti")) {
    result.has_bug_bounty = true;
    result.bug_bounty_platform = "Intigriti";
  } else if (allText.includes("yeswehack")) {
    result.has_bug_bounty = true;
    result.bug_bounty_platform = "YesWeHack";
  }
  return result;
}

// ─── Tier 1: Green Web Foundation ───────────────────────────────────

export async function checkGreenHosting(domain: string): Promise<GreenHostingResult> {
  try {
    const res = await fetchWithTimeout(
      `https://api.thegreenwebfoundation.org/greencheck/${encodeURIComponent(domain)}`,
      { timeout: 8000 },
    );
    if (!res.ok) return { green: false, hosted_by: null, hosted_by_website: null, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { green: boolean; hosted_by?: string; hosted_by_website?: string };
    return {
      green: data.green === true,
      hosted_by: data.hosted_by ?? null,
      hosted_by_website: data.hosted_by_website ?? null,
      error: null,
    };
  } catch (e) {
    return {
      green: false,
      hosted_by: null,
      hosted_by_website: null,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

// ─── Tier 1: Well-Known Endpoint Discovery ──────────────────────────

export async function checkWellKnownEndpoints(domain: string): Promise<WellKnownResult> {
  const endpoints: Array<{ path: string; name: string }> = [
    { path: "/ads.txt", name: "Ads.txt" },
    { path: "/manifest.json", name: "Web App Manifest" },
    { path: "/.well-known/apple-app-site-association", name: "Apple App Site Association" },
    { path: "/.well-known/assetlinks.json", name: "Android Asset Links" },
    // ── Agent Identity / Web Bot Auth / MCP (2026 additions) ──────────
    { path: "/.well-known/http-message-signatures-directory", name: "Web Bot Auth Directory (RFC 9421)" },
    { path: "/.well-known/mcp/server-cards.json", name: "MCP Server Cards (SEP-2127)" },
    { path: "/.well-known/mcp.json", name: "MCP Discovery" },
    { path: "/.well-known/agent-card.json", name: "A2A Agent Card" },
    { path: "/.well-known/ai-catalog.json", name: "AI Catalog (ARD)" },
    { path: "/.well-known/oauth-protected-resource", name: "OAuth Protected Resource (RFC 9728)" },
    { path: "/.well-known/api-catalog", name: "API Catalog (RFC 9727)" },
    // ── Agent Capability Declarations (2026-08 new) ──────────
    { path: "/agents.txt", name: "Agents.txt (Capability Declaration)" },
    { path: "/.well-known/agents.json", name: "Agents.json (IANA #73)" },
    { path: "/llms.txt", name: "LLMs.txt (root)" },
    { path: "/.well-known/llms.txt", name: "LLMs.txt (well-known)" },
    { path: "/.well-known/ai", name: "AI Discovery (Rootz, IANA #80 rejected - too generic, see #80 feedback)" },
    { path: "/.well-known/ai-plugin.json", name: "AI Plugin (ChatGPT plugins)" },
  ];

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
  const results: WellKnownEndpoint[] = [];
  let pwaReady = false;
  let hasMobileApps = false;
  let adsPartnerCount: number | null = null;

  const checks = endpoints.map(async (ep) => {
    try {
      const res = await safeFetchWithRedirects(`https://${domain}${ep.path}`, {
        timeout: 6000,
        headers: { "User-Agent": ua },
      });
      if (!res.ok) {
        // Only add non-manifest-webmanifest if manifest.json wasn't found
        if (ep.path !== "/manifest.webmanifest") {
          results.push({ path: ep.path, name: ep.name, found: false, data: null });
        }
        return;
      }

      const contentType = res.headers.get("content-type") ?? "";
      const text = await boundedText(res);

      // Skip HTML error pages returned as 200
      if (contentType.includes("text/html") && !ep.path.includes("apple-app-site-association")) {
        results.push({ path: ep.path, name: ep.name, found: false, data: null });
        return;
      }

      if (ep.path === "/ads.txt") {
        const lines = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
        adsPartnerCount = lines.length;
        const partners = new Set<string>();
        for (const line of lines.slice(0, 200)) {
          const parts = line.split(",");
          if (parts.length >= 2) partners.add(parts[0].trim().toLowerCase());
        }
        results.push({
          path: ep.path,
          name: ep.name,
          found: true,
          data: { partner_count: adsPartnerCount, top_partners: [...partners].slice(0, 10) },
        });
      } else if (ep.path === "/manifest.json") {
        try {
          const manifest = JSON.parse(text) as Record<string, unknown>;
          const display = manifest.display as string | undefined;
          pwaReady =
            !!manifest.name &&
            !!manifest.start_url &&
            (display === "standalone" || display === "fullscreen" || display === "minimal-ui");
          results.push({
            path: ep.path,
            name: "Web App Manifest",
            found: true,
            data: {
              name: manifest.name ?? manifest.short_name ?? null,
              theme_color: manifest.theme_color ?? null,
              display: display ?? null,
              icon_count: Array.isArray(manifest.icons) ? manifest.icons.length : 0,
              pwa_ready: pwaReady,
            },
          });
        } catch {
          results.push({ path: ep.path, name: "Web App Manifest", found: false, data: null });
        }
      } else if (ep.path === "/.well-known/apple-app-site-association") {
        try {
          const aasa = JSON.parse(text) as Record<string, unknown>;
          hasMobileApps = true;
          const applinks = aasa.applinks as Record<string, unknown> | undefined;
          const details = applinks?.details ?? applinks?.apps;
          const appIds: string[] = [];
          if (Array.isArray(details)) {
            for (const d of details.slice(0, 5)) {
              if (typeof d === "object" && d !== null) {
                const appId = (d as Record<string, unknown>).appID ?? (d as Record<string, unknown>).appIDs;
                if (typeof appId === "string") appIds.push(appId);
                else if (Array.isArray(appId)) appIds.push(...(appId as string[]).slice(0, 3));
              }
            }
          }
          results.push({ path: ep.path, name: ep.name, found: true, data: { app_ids: appIds.slice(0, 5) } });
        } catch {
          // Could be a 200 HTML page
          results.push({ path: ep.path, name: ep.name, found: false, data: null });
        }
      } else if (ep.path === "/.well-known/assetlinks.json") {
        try {
          const links = JSON.parse(text) as Array<{ target?: { namespace?: string; package_name?: string } }>;
          if (Array.isArray(links) && links.length > 0) {
            hasMobileApps = true;
            const packages = links
              .filter((l) => l.target?.namespace === "android_app")
              .map((l) => l.target?.package_name)
              .filter(Boolean)
              .slice(0, 5);
            results.push({ path: ep.path, name: ep.name, found: true, data: { package_names: packages } });
          } else {
            results.push({ path: ep.path, name: ep.name, found: false, data: null });
          }
        } catch {
          results.push({ path: ep.path, name: ep.name, found: false, data: null });
        }
      } else {
        // Generic handler for JSON/well-known agent identity endpoints (2026+)
        // Counts as found if we got 200 + non-empty body, without requiring specific schema validation.
        // For security, cap data preview.
        try {
          const preview = JSON.parse(text);
          const isObject = preview && typeof preview === "object";
          const keyCount = isObject ? Object.keys(preview as object).length : 0;
          const entryCount = Array.isArray(preview)
            ? preview.length
            : Array.isArray((preview as Record<string, unknown>)?.keys)
              ? ((preview as Record<string, unknown>).keys as unknown[]).length
              : undefined;
          results.push({
            path: ep.path,
            name: ep.name,
            found: true,
            data: {
              size: text.length,
              keys: keyCount > 0 ? keyCount : undefined,
              entries: entryCount,
              content_type: contentType || null,
            },
          });
        } catch {
          // Non-JSON but 200 OK (e.g., JWKS with text/plain) — still counts as present if body looks structured
          const looksStructured = text.trim().startsWith("{") || text.trim().startsWith("[");
          results.push({
            path: ep.path,
            name: ep.name,
            found: looksStructured ? true : text.length > 20,
            data: { size: text.length, content_type: contentType || null },
          });
        }
      }
    } catch {
      results.push({ path: ep.path, name: ep.name, found: false, data: null });
    }
  });

  await Promise.allSettled(checks);

  // Sort: found first, then alphabetical
  results.sort((a, b) => {
    if (a.found !== b.found) return a.found ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  return {
    endpoints: results,
    pwa_ready: pwaReady,
    has_mobile_apps: hasMobileApps,
    ads_partner_count: adsPartnerCount,
  };
}

// ─── Tier 1: Enhanced CAA Display ───────────────────────────────────

export function analyzeCaaRecords(dnsRecords: DnsRecord[]): CaaDisplayResult {
  const caaRecords = dnsRecords.filter((r) => r.type === "CAA");
  if (caaRecords.length === 0) return { records: [], has_wildcard_policy: false, iodef: null, has_caa: false };

  const caNameMap: Record<string, string> = {
    "digicert.com": "DigiCert",
    "letsencrypt.org": "Let's Encrypt",
    "pki.goog": "Google Trust Services",
    "globalsign.com": "GlobalSign",
    "sectigo.com": "Sectigo (Comodo)",
    "comodoca.com": "Sectigo (Comodo)",
    "godaddy.com": "GoDaddy",
    "starfieldtech.com": "GoDaddy (Starfield)",
    "amazon.com": "Amazon Trust Services",
    "amazontrust.com": "Amazon Trust Services",
    "buypass.com": "Buypass",
    "ssl.com": "SSL.com",
    "entrust.net": "Entrust",
    "usertrust.com": "USERTrust (Sectigo)",
    "thawte.com": "Thawte (DigiCert)",
    "geotrust.com": "GeoTrust (DigiCert)",
    "rapidssl.com": "RapidSSL (DigiCert)",
    "symantec.com": "Symantec (DigiCert)",
    "microsoft.com": "Microsoft",
    "apple.com": "Apple",
    "cloudflare.com": "Cloudflare",
  };

  const records: CaaDisplayResult["records"] = [];
  let hasWildcard = false;
  let iodef: string | null = null;

  for (const rec of caaRecords) {
    // CAA record format: flags tag "value"
    const match = rec.data.match(/^(\d+)\s+(\w+)\s+"?([^"]*)"?$/);
    if (!match) continue;
    const flags = parseInt(match[1], 10);
    const tag = match[2].toLowerCase();
    const value = match[3];

    if (tag === "iodef") {
      iodef = value;
      continue;
    }
    if (tag === "issuewild") hasWildcard = true;

    // Map value to human-readable CA name
    let caName = value;
    for (const [domain, name] of Object.entries(caNameMap)) {
      if (value.toLowerCase().includes(domain)) {
        caName = name;
        break;
      }
    }

    records.push({ flags, tag, value, ca_name: caName });
  }

  return { records, has_wildcard_policy: hasWildcard, iodef, has_caa: true };
}

// ─── Tier 1: GreyNoise IP Intelligence ─────────────────────────────

export async function checkGreynoise(ip: string): Promise<GreynoiseResult> {
  try {
    const res = await fetchWithTimeout(`https://viz.greynoise.io/api/v3/community/${encodeURIComponent(ip)}`, {
      timeout: 8000,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      // 404 means IP not found in their database — that's a valid result
      if (res.status === 404)
        return { ip, classification: "unknown", name: null, link: null, noise: false, riot: false, error: null };
      return {
        ip,
        classification: null,
        name: null,
        link: null,
        noise: false,
        riot: false,
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      ip?: string;
      classification?: string;
      name?: string;
      link?: string;
      noise?: boolean;
      riot?: boolean;
      message?: string;
    };
    return {
      ip: data.ip ?? ip,
      classification: data.classification ?? "unknown",
      name: data.name ?? null,
      link: data.link ?? null,
      noise: data.noise === true,
      riot: data.riot === true,
      error: null,
    };
  } catch (e) {
    return {
      ip,
      classification: null,
      name: null,
      link: null,
      noise: false,
      riot: false,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
