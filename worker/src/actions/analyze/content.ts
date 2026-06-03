import { logApiError } from "../../api-errors";
import {
  boundedText,
  type Env,
  fetchWithTimeout,
  getFlyAuthHeaders,
  getFlyProbeUrl,
  probeHeadWithFallback,
} from "../../helpers";
import type {
  AiReadinessResult,
  BimiResult,
  DnsRecord,
  EmailAuthResult,
  JsonLdItem,
  LegalResult,
  LlmsTxtResult,
  MtaStsResult,
  OgTwitterResult,
  RobotsParsed,
  TlsRptResult,
} from "./types";

// ─── llms.txt ────────────────────────────────────────────────────────

export async function checkLlmsTxt(domain: string, instanceHost?: string): Promise<LlmsTxtResult> {
  const result: LlmsTxtResult = { found: false, content: null, full_found: false, full_content: null };

  // Self-analysis bypass: CF Workers can't fetch their own zone
  const isSelf = instanceHost && domain === instanceHost;
  if (isSelf) {
    const baseUrl = `https://${instanceHost}`;
    const host = instanceHost;
    return {
      found: true,
      content: `# Yoke — Free Domain Intelligence & OSINT Tool\n\n> Yoke is a free, open-source domain intelligence tool at ${baseUrl}\n\n## What Yoke Does\n\nYoke provides instant, comprehensive analysis of any internet domain. Enter a domain name and get detailed intelligence across security, speed, foundations, reputation, discoverability, and email.\n\n## Key Capabilities\n\n- DNS Analysis: A, AAAA, MX, NS, TXT, CNAME, SOA records with DNSSEC validation\n- SSL/TLS: Certificate details, chain validation, TLS configuration grading, CAA records\n- WHOIS/RDAP: Registrar, registration and expiry dates, domain age\n- Security Audit: HTTP security headers, cookie security\n- Data Breaches: HIBP breach detection with time-decay scoring\n- Threat Intelligence: Shodan port/vulnerability data, GreyNoise IP classification\n- Technology Detection: Frameworks, CMS, CDN, WAF, deep WordPress fingerprinting\n- Email Authentication: SPF, DKIM, DMARC validation\n- Performance: Google PageSpeed, Core Web Vitals (mobile-first 60/40 blend), compression\n- Certificate Transparency: CT log monitoring for subdomain discovery\n- Business Intelligence: Company enrichment via Wikidata, Brandfetch, Crunchbase\n- AI Analysis: LLM-powered analysis from 6 expert personas\n\n## Free JSON API\n\nNo authentication required.\n\ncurl -s https://${host}/stripe.com | jq\ncurl -s "https://${host}/stripe.com?pretty"\ncurl -s https://${host}/stripe.com | jq '.ssl'\n\n## Links\n\n- Web UI: ${baseUrl}\n- API Docs: ${baseUrl}/api/docs\n- Chrome Extension: Chrome Web Store\n- Source: https://github.com/yokedotlol/yoke\n- License: MIT`,
      full_found: false,
      full_content: null,
    };
  }

  const [r1, r2] = await Promise.allSettled([
    fetchWithTimeout(`https://${domain}/llms.txt`, { timeout: 5000 }),
    fetchWithTimeout(`https://${domain}/llms-full.txt`, { timeout: 5000 }),
  ]);
  if (r1.status === "fulfilled" && r1.value.ok) {
    try {
      const text = await boundedText(r1.value);
      const lower = text.toLowerCase();
      if (text && !lower.includes("<!doctype") && !lower.includes("<html")) {
        result.found = true;
        result.content = text.slice(0, 3000);
      }
    } catch {
      /* ignore */
    }
  }
  if (r2.status === "fulfilled" && r2.value.ok) {
    try {
      const text = await boundedText(r2.value);
      const lower = text.toLowerCase();
      if (text && !lower.includes("<!doctype") && !lower.includes("<html")) {
        result.full_found = true;
        result.full_content = text.slice(0, 5000);
      }
    } catch {
      /* ignore */
    }
  }
  return result;
}

// ─── ANS / DNS-AID Agent Discovery ──────────────────────────────────

export interface AnsResult {
  ans_found: boolean; // _ans.{domain} TXT record exists (ANS v1)
  ans_records: string[]; // raw TXT record values
  agents_found: boolean; // _agents.{domain} records exist (DNS-AID/BANDAID)
  agents_records: string[];
  agent_json_found: boolean; // /.well-known/agent.json exists
}

export async function checkAnsRecords(domain: string): Promise<AnsResult> {
  const result: AnsResult = {
    ans_found: false,
    ans_records: [],
    agents_found: false,
    agents_records: [],
    agent_json_found: false,
  };

  // Wildcard DNS detection: probe a random subdomain. Domains with wildcard
  // records (*.example.com) resolve ANY subdomain, causing false positives
  // for _ans / _agents TXT lookups.
  let hasWildcardDns = false;
  try {
    const probeRes = await fetchWithTimeout(
      `https://dns.google/resolve?name=${encodeURIComponent(`_yoke-wildcard-probe-${Date.now()}.${domain}`)}&type=A`,
      { timeout: 3000 },
    );
    if (probeRes.ok) {
      const probeData = (await probeRes.json()) as { Status: number; Answer?: Array<{ data: string }> };
      if (probeData.Status === 0 && probeData.Answer?.length) {
        hasWildcardDns = true;
      }
    }
  } catch {
    /* probe failure = no wildcard */
  }

  // Run DNS lookups (skip if wildcard) and agent.json fetch in parallel
  const promises: Promise<void>[] = [];

  // agent.json is an HTTP endpoint check — not affected by wildcard DNS
  promises.push(
    (async () => {
      try {
        const agentJsonRes = await fetchWithTimeout(`https://${domain}/.well-known/agent.json`, { timeout: 5000 });
        if (agentJsonRes.ok) {
          const text = await boundedText(agentJsonRes);
          if (text && !text.toLowerCase().includes("<!doctype") && !text.toLowerCase().includes("<html")) {
            JSON.parse(text);
            result.agent_json_found = true;
          }
        }
      } catch {
        /* not valid JSON or unreachable */
      }
    })(),
  );

  if (!hasWildcardDns) {
    // ANS: _ans.{domain} TXT records
    promises.push(
      (async () => {
        try {
          const ansRes = await fetchWithTimeout(
            `https://dns.google/resolve?name=${encodeURIComponent(`_ans.${domain}`)}&type=TXT`,
            { timeout: 5000 },
          );
          if (ansRes.ok) {
            const data = (await ansRes.json()) as { Status: number; Answer?: Array<{ data: string }> };
            if (data.Status === 0 && data.Answer?.length) {
              result.ans_found = true;
              result.ans_records = data.Answer.map((a) => a.data.replace(/^"|"$/g, ""));
            }
          }
        } catch {
          /* ignore */
        }
      })(),
    );

    // DNS-AID/BANDAID: _agents.{domain} TXT/SVCB records
    promises.push(
      (async () => {
        try {
          const agentsRes = await fetchWithTimeout(
            `https://dns.google/resolve?name=${encodeURIComponent(`_agents.${domain}`)}&type=TXT`,
            { timeout: 5000 },
          );
          if (agentsRes.ok) {
            const data = (await agentsRes.json()) as { Status: number; Answer?: Array<{ data: string }> };
            if (data.Status === 0 && data.Answer?.length) {
              result.agents_found = true;
              result.agents_records = data.Answer.map((a) => a.data.replace(/^"|"$/g, ""));
            }
          }
        } catch {
          /* ignore */
        }
      })(),
    );
  }

  await Promise.allSettled(promises);

  return result;
}

// ─── Wayback Machine ────────────────────────────────────────────────

export async function checkWayback(domain: string): Promise<{
  first_snapshot: string | null;
  last_snapshot: string | null;
  total_snapshots: number | null;
  archive_url: string;
} | null> {
  const archiveUrl = `https://web.archive.org/web/*/${domain}`;
  const formatTs = (ts: string | undefined | null): string | null => {
    if (!ts || ts.length < 8) return null;
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  };
  try {
    const sparklineRes = await fetchWithTimeout(
      `https://web.archive.org/__wb/sparkline?output=json&url=${encodeURIComponent(domain)}&collection=web`,
      { timeout: 8000 },
    );
    if (sparklineRes.ok) {
      const sparkData = (await sparklineRes.json()) as {
        years?: Record<string, number[]>;
        first_ts?: string;
        last_ts?: string;
      };
      let totalSnapshots = 0;
      let firstYear: string | null = null;
      let lastYear: string | null = null;
      if (sparkData.years) {
        const years = Object.keys(sparkData.years).sort();
        if (years.length > 0) {
          firstYear = years[0] ?? null;
          lastYear = years[years.length - 1] ?? null;
        }
        for (const counts of Object.values(sparkData.years)) {
          for (const c of counts) totalSnapshots += c;
        }
      }
      if (totalSnapshots > 0 || sparkData.first_ts) {
        return {
          first_snapshot: formatTs(sparkData.first_ts) ?? (firstYear ? `${firstYear}-01-01` : null),
          last_snapshot: formatTs(sparkData.last_ts) ?? (lastYear ? `${lastYear}-12-31` : null),
          total_snapshots: totalSnapshots > 0 ? totalSnapshots : null,
          archive_url: archiveUrl,
        };
      }
    }
    // Sparkline returned 404 or empty (common for very new domains) — fall back to availability API
    const availRes = await fetchWithTimeout(`https://archive.org/wayback/available?url=${encodeURIComponent(domain)}`, {
      timeout: 6000,
    });
    if (availRes.ok) {
      const availData = (await availRes.json()) as {
        archived_snapshots?: { closest?: { available?: boolean; timestamp?: string } };
      };
      const snap = availData.archived_snapshots?.closest;
      if (snap?.available && snap.timestamp) {
        const ts = formatTs(snap.timestamp);
        return { first_snapshot: ts, last_snapshot: ts, total_snapshots: 1, archive_url: archiveUrl };
      }
    }
    return { first_snapshot: null, last_snapshot: null, total_snapshots: null, archive_url: archiveUrl };
  } catch {
    return { first_snapshot: null, last_snapshot: null, total_snapshots: null, archive_url: archiveUrl };
  }
}

// ─── Tranco Ranking ──────────────────────────────────────────────────

export async function checkTranco(domain: string, statsDb?: D1Database): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, {
      timeout: 5000,
    });
    if (!res.ok) {
      if (statsDb)
        logApiError(statsDb, { api: "tranco", status: res.status, message: "Tranco rank lookup failed", domain });
      return null;
    }
    const data = (await res.json()) as { ranks?: Array<{ rank?: number }> };
    return data.ranks?.[0]?.rank ?? null;
  } catch (e) {
    if (statsDb) logApiError(statsDb, { api: "tranco", status: 0, message: String(e).slice(0, 200), domain });
    return null;
  }
}

// ─── Email Authentication ────────────────────────────────────────────

export async function checkEmailAuth(domain: string, dnsRecords: DnsRecord[], env?: Env): Promise<EmailAuthResult> {
  const spf = {
    found: false,
    record: null as string | null,
    mechanisms: [] as string[],
    all_qualifier: null as string | null,
  };
  for (const rec of dnsRecords) {
    if (rec.type === "TXT") {
      const cleanData = rec.data.replace(/^"|"$/g, "");
      if (cleanData.startsWith("v=spf1")) {
        spf.found = true;
        spf.record = cleanData;
        const parts = cleanData.split(/\s+/).slice(1);
        for (const p of parts) {
          if (/^[+\-~?]all$/i.test(p)) spf.all_qualifier = p;
          else spf.mechanisms.push(p);
        }
        break;
      }
    }
  }
  const dmarc = {
    found: false,
    record: null as string | null,
    policy: null as string | null,
    subdomain_policy: null as string | null,
    rua: null as string | null,
    ruf: null as string | null,
  };
  try {
    const res = await fetchWithTimeout(
      `https://dns.google/resolve?name=_dmarc.${encodeURIComponent(domain)}&type=TXT`,
      { timeout: 5000 },
    );
    const data = (await res.json()) as { Status: number; Answer?: Array<{ data: string }> };
    if (data.Status === 0 && data.Answer) {
      for (const ans of data.Answer) {
        const cleanData = ans.data.replace(/^"|"$/g, "");
        if (cleanData.startsWith("v=DMARC1")) {
          dmarc.found = true;
          dmarc.record = cleanData;
          dmarc.policy = cleanData.match(/;\s*p=([^;\s]+)/)?.[1] ?? null;
          dmarc.subdomain_policy = cleanData.match(/;\s*sp=([^;\s]+)/)?.[1] ?? null;
          dmarc.rua = cleanData.match(/;\s*rua=([^;\s]+)/)?.[1] ?? null;
          dmarc.ruf = cleanData.match(/;\s*ruf=([^;\s]+)/)?.[1] ?? null;
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }
  // ── DKIM selector discovery: infer from MX/SPF, then probe ──────────
  const dkimSelectors: string[] = [];
  const selectorSet = new Set<string>(["default", "dkim"]);
  // Gather MX hostnames and SPF includes to fingerprint the email provider
  const mxHosts = dnsRecords.filter((r) => r.type === "MX").map((r) => r.data.toLowerCase());
  const spfIncludes = (spf.record ?? "").toLowerCase();
  const providerSelectors: Record<string, string[]> = {
    google: ["google"],
    outlook: ["selector1", "selector2"],
    microsoft: ["selector1", "selector2"],
    amazonses: ["ses", "amazon"],
    mailchimp: ["k1", "k2", "k3"],
    mandrill: ["mandrill"],
    mailgun: ["smtp", "mail", "mg", "k1"],
    sendgrid: ["s1", "s2", "sendgrid", "smtpapi"],
    postmark: ["postmark", "pm"],
    mailjet: ["mailjet"],
    sparkpost: ["sparkpost"],
    zoho: ["zoho", "zmail"],
    fastmail: ["fm1", "fm2", "fm3"],
    protonmail: ["protonmail", "protonmail2", "protonmail3"],
    cloudflare: ["cf2024-1", "cf2024-2", "cf2023-1", "cf2023-2", "cf2025-1", "cf2025-2"],
    mimecast: ["mimecast", "mimecast20190104"],
    sendinblue: ["mail", "sendinblue"],
    hover: ["default", "hoverkey"],
    namecheap: ["default", "mail"],
    icloud: ["sig1"],
    yahoo: ["s1024", "s2048"],
    yandex: ["mail"],
    ionos: ["default", "mail"],
    ovh: ["ovh", "default"],
    godaddy: ["default", "k1"],
  };
  const allSignals = [...mxHosts, spfIncludes].join(" ");
  for (const [provider, selectors] of Object.entries(providerSelectors)) {
    if (allSignals.includes(provider)) {
      for (const s of selectors) selectorSet.add(s);
    }
  }

  // ── TXT record inference: detect service verification tokens → add DKIM selectors ──
  const txtValues = dnsRecords
    .filter((r) => r.type === "TXT")
    .map((r) => r.data.toLowerCase())
    .join(" ");
  const txtSelectorMap: Array<{ pattern: RegExp; selectors: string[] }> = [
    { pattern: /stripe-verification=/, selectors: ["stripe", "s1", "s2"] },
    { pattern: /hubspot[-_]|_hubspot/, selectors: ["hs1", "hs2", "hubspot", "smtpapi"] },
    { pattern: /atlassian-domain-verification=/, selectors: ["atlassian"] },
    { pattern: /facebook-domain-verification=/, selectors: ["facebook", "s1024", "s2048"] },
    { pattern: /shopify-verification=/, selectors: ["shopify"] },
    { pattern: /docusign=/, selectors: ["docusign"] },
    { pattern: /zendesk-domain-verification=/, selectors: ["zendesk", "zendesk1", "zendesk2"] },
    { pattern: /twilio-domain-verification=/, selectors: ["twilio"] },
    { pattern: /brevo-code:|sendinblue-code:/, selectors: ["mail", "sendinblue"] },
    { pattern: /slack-domain-verification=/, selectors: ["slack"] },
    { pattern: /cisco-ci-domain-verification=/, selectors: ["cisco"] },
    { pattern: /calendly-site-verification=/, selectors: ["calendly"] },
    { pattern: /notion-domain-verification=/, selectors: ["notion"] },
    { pattern: /intercom-domain-verification=/, selectors: ["intercom"] },
    { pattern: /drift-domain-verification=/, selectors: ["drift"] },
    { pattern: /customer\.io/, selectors: ["cio"] },
    { pattern: /salesforce-verification=/, selectors: ["sf1", "sf2", "salesforce", "salesforce1"] },
    { pattern: /pardot/, selectors: ["pardot", "m1"] },
    { pattern: /helpscout-verification=/, selectors: ["helpscout"] },
    { pattern: /freshdesk-verification=/, selectors: ["freshdesk", "fdk"] },
  ];
  for (const { pattern, selectors } of txtSelectorMap) {
    if (pattern.test(txtValues)) {
      for (const s of selectors) selectorSet.add(s);
    }
  }

  // Always include a small universal fallback set
  for (const s of ["google", "selector1", "selector2", "k1", "mail", "s1", "s2"]) selectorSet.add(s);
  await Promise.allSettled(
    [...selectorSet].map(async (sel) => {
      try {
        const res = await fetchWithTimeout(
          `https://dns.google/resolve?name=${sel}._domainkey.${encodeURIComponent(domain)}&type=TXT`,
          { timeout: 3000 },
        );
        const data = (await res.json()) as { Status: number; Answer?: Array<{ data: string }> };
        if (data.Status === 0 && data.Answer && data.Answer.length > 0) dkimSelectors.push(sel);
      } catch {
        /* ignore */
      }
    }),
  );

  // BIMI
  const bimi: BimiResult = { found: false, record: null, logo_url: null, authority_url: null };
  try {
    const res = await fetchWithTimeout(
      `https://dns.google/resolve?name=default._bimi.${encodeURIComponent(domain)}&type=TXT`,
      { timeout: 4000 },
    );
    const data = (await res.json()) as { Status: number; Answer?: Array<{ data: string }> };
    if (data.Status === 0 && data.Answer) {
      for (const ans of data.Answer) {
        const cleanData = ans.data.replace(/^"|"$/g, "");
        if (cleanData.toLowerCase().startsWith("v=bimi1")) {
          bimi.found = true;
          bimi.record = cleanData;
          bimi.logo_url = cleanData.match(/;\s*l=([^;\s]+)/)?.[1] ?? null;
          bimi.authority_url = cleanData.match(/;\s*a=([^;\s]+)/)?.[1] ?? null;
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }

  // MTA-STS
  const mtaSts: MtaStsResult = { dns_found: false, policy_found: false, mode: null };
  try {
    const dnsRes = await fetchWithTimeout(
      `https://dns.google/resolve?name=_mta-sts.${encodeURIComponent(domain)}&type=TXT`,
      { timeout: 4000 },
    );
    const dnsData = (await dnsRes.json()) as { Status: number; Answer?: Array<{ data: string }> };
    if (dnsData.Status === 0 && dnsData.Answer?.length) {
      for (const ans of dnsData.Answer) {
        if (ans.data.replace(/^"|"$/g, "").toLowerCase().includes("v=stsv1")) {
          mtaSts.dns_found = true;
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }
  // MTA-STS policy fetch — try direct, fall back to Fly probe on failure
  try {
    const policyUrl = `https://mta-sts.${domain}/.well-known/mta-sts.txt`;
    let policyRes: Response | null = null;

    // Try direct fetch first
    try {
      policyRes = await fetchWithTimeout(policyUrl, { timeout: 5000 });
    } catch {
      // Direct fetch failed (e.g., CF Worker self-referential block) — try Fly probe
    }

    // If direct fetch failed or returned non-OK, try Fly probe
    if (!policyRes?.ok && env) {
      try {
        const probeUrl = `${getFlyProbeUrl(env)}/probe-fetch?url=${encodeURIComponent(policyUrl)}`;
        const raw = await fetchWithTimeout(probeUrl, {
          timeout: 8000,
          headers: getFlyAuthHeaders(env),
        });
        const probeData = (await raw.json()) as { status: number; body: string };
        if (probeData.status >= 200 && probeData.status < 300) {
          policyRes = new Response(probeData.body, { status: probeData.status });
        }
      } catch {
        // Fly probe also failed — give up
      }
    }

    if (policyRes?.ok) {
      const text = await boundedText(policyRes);
      if (text?.includes("mode:")) {
        mtaSts.policy_found = true;
        const modeMatch = text.match(/mode:\s*(enforce|testing|none)/i);
        mtaSts.mode = modeMatch?.[1]?.toLowerCase() ?? null;
      }
    }
  } catch {
    /* ignore */
  }

  // TLS-RPT
  const tlsRpt: TlsRptResult = { found: false, record: null, rua: null };
  try {
    const res = await fetchWithTimeout(
      `https://dns.google/resolve?name=_smtp._tls.${encodeURIComponent(domain)}&type=TXT`,
      { timeout: 4000 },
    );
    const data = (await res.json()) as { Status: number; Answer?: Array<{ data: string }> };
    if (data.Status === 0 && data.Answer) {
      for (const ans of data.Answer) {
        const cleanData = ans.data.replace(/^"|"$/g, "");
        if (cleanData.toLowerCase().startsWith("v=tlsrptv1")) {
          tlsRpt.found = true;
          tlsRpt.record = cleanData;
          tlsRpt.rua = cleanData.match(/;\s*rua=([^;\s]+)/)?.[1] ?? null;
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }

  return { spf, dmarc, dkim_selectors_found: dkimSelectors, bimi, mta_sts: mtaSts, tls_rpt: tlsRpt };
}

// ─── Deep robots.txt parsing ────────────────────────────────────────

export function parseRobotsDeep(robotsTxt: string | null, robotsExists: boolean): RobotsParsed {
  if (!robotsExists || !robotsTxt)
    return {
      blocks: [],
      crawl_delay: null,
      sitemaps: [],
      interesting_blocked: [],
      is_restrictive: false,
      is_missing: true,
    };
  const blocks: Array<{ user_agent: string; disallow: string[]; allow: string[] }> = [];
  const sitemaps: string[] = [];
  let crawlDelay: number | null = null;
  let currentUA = "";
  let currentDisallow: string[] = [];
  let currentAllow: string[] = [];
  const flushBlock = () => {
    if (currentUA) {
      blocks.push({ user_agent: currentUA, disallow: [...currentDisallow], allow: [...currentAllow] });
      currentDisallow = [];
      currentAllow = [];
    }
  };
  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const [directive, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    switch (directive?.toLowerCase()) {
      case "user-agent":
        if (currentUA && (currentDisallow.length > 0 || currentAllow.length > 0)) flushBlock();
        currentUA = value;
        currentDisallow = [];
        currentAllow = [];
        break;
      case "disallow":
        if (value) currentDisallow.push(value);
        break;
      case "allow":
        if (value) currentAllow.push(value);
        break;
      case "crawl-delay":
        crawlDelay = parseFloat(value) || null;
        break;
      case "sitemap":
        if (value) sitemaps.push(value);
        break;
    }
  }
  flushBlock();
  const interestingPaths = [
    "/admin",
    "/wp-admin",
    "/api",
    "/private",
    "/internal",
    "/staging",
    "/debug",
    "/config",
    "/env",
    "/.env",
    "/.git",
    "/backup",
  ];
  const allDisallowed = blocks.flatMap((b) => b.disallow);
  const interestingBlocked = allDisallowed.filter((p) => interestingPaths.some((ip) => p.toLowerCase().startsWith(ip)));
  const wildcardBlock = blocks.find((b) => b.user_agent === "*");
  const isRestrictive = !!wildcardBlock && wildcardBlock.disallow.includes("/") && wildcardBlock.allow.length === 0;
  return {
    blocks,
    crawl_delay: crawlDelay,
    sitemaps,
    interesting_blocked: interestingBlocked,
    is_restrictive: isRestrictive,
    is_missing: false,
  };
}

// ─── HTTP Protocol Detection ────────────────────────────────────────

export function detectHttpProtocols(headers: Record<string, string> | null): {
  http2: boolean;
  http3: boolean;
  alt_svc: string | null;
} {
  if (!headers) return { http2: false, http3: false, alt_svc: null };
  const altSvc = headers["alt-svc"] ?? null;
  return {
    http2: !!altSvc || !!headers["x-firefox-spdy"] || !!headers[":status"],
    http3: altSvc ? /h3(?:=|-)/.test(altSvc) : false,
    alt_svc: altSvc,
  };
}

/** Probe HTTP/2 and HTTP/3 support via Fly.io (bypasses CF Worker fetch limitations) */
export async function probeHttpProtocols(
  domain: string,
  env: Env,
): Promise<{ http2: boolean; http3: boolean; alt_svc: string | null }> {
  try {
    const res = await fetch(`${getFlyProbeUrl(env)}/probe-protocols?domain=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(10000),
      headers: getFlyAuthHeaders(env),
    });
    if (res.ok) {
      const data = (await res.json()) as { http2: boolean; http3: boolean; alt_svc: string | null; error?: string };
      if (!data.error) return { http2: data.http2, http3: data.http3, alt_svc: data.alt_svc };
    }
  } catch {
    /* probe unreachable */
  }
  return { http2: false, http3: false, alt_svc: null };
}

// ─── Schema.org / JSON-LD Extraction ────────────────────────────────

export function extractJsonLd(html: string): JsonLdItem[] {
  const items: JsonLdItem[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? "");
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (typeof entry === "object" && entry !== null) {
          const e = entry as Record<string, unknown>;
          items.push({
            type:
              typeof e["@type"] === "string"
                ? e["@type"]
                : Array.isArray(e["@type"])
                  ? (e["@type"] as string[]).join(", ")
                  : "Unknown",
            name: typeof e.name === "string" ? e.name : null,
            description: typeof e.description === "string" ? e.description.slice(0, 200) : null,
            url: typeof e.url === "string" ? e.url : null,
            raw: e,
          });
        }
      }
    } catch {
      /* malformed JSON-LD */
    }
  }
  return items.slice(0, 10);
}

// ─── NEW: Open Graph + Twitter Card Audit ───────────────────────────

export function extractSocialMeta(html: string): OgTwitterResult {
  const extractMeta = (html: string, attr: string, name: string): string | null => {
    const r1 = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
    const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${name}["']`, "i");
    return html.match(r1)?.[1] ?? html.match(r2)?.[1] ?? null;
  };

  const og = {
    title: extractMeta(html, "property", "og:title"),
    description: extractMeta(html, "property", "og:description"),
    image: extractMeta(html, "property", "og:image"),
    type: extractMeta(html, "property", "og:type"),
    url: extractMeta(html, "property", "og:url"),
    site_name: extractMeta(html, "property", "og:site_name"),
    locale: extractMeta(html, "property", "og:locale"),
  };

  const twitter = {
    card: extractMeta(html, "name", "twitter:card"),
    site: extractMeta(html, "name", "twitter:site"),
    creator: extractMeta(html, "name", "twitter:creator"),
    title: extractMeta(html, "name", "twitter:title"),
    description: extractMeta(html, "name", "twitter:description"),
    image: extractMeta(html, "name", "twitter:image"),
  };

  const missing: string[] = [];
  const essential = [
    ["og:title", og.title],
    ["og:description", og.description],
    ["og:image", og.image],
    ["og:type", og.type],
    ["og:url", og.url],
    ["twitter:card", twitter.card],
    ["twitter:title", twitter.title ?? og.title],
    ["twitter:description", twitter.description ?? og.description],
  ] as const;

  let filled = 0;
  for (const [name, val] of essential) {
    if (val) filled++;
    else missing.push(name);
  }
  const score = Math.round((filled / essential.length) * 100);

  return { og, twitter, score, missing };
}

// ─── NEW: Legal Pages Detection ─────────────────────────────────────

const LEGAL_PATTERNS: Array<{ name: string; patterns: RegExp[] }> = [
  { name: "Privacy Policy", patterns: [/\/privacy/i, /privacy[_-]?policy/i] },
  {
    name: "Terms of Service",
    patterns: [/\/terms/i, /terms[_-]?of[_-]?service/i, /terms[_-]?of[_-]?use/i, /\/tos\b/i],
  },
  { name: "Cookie Policy", patterns: [/cookie[_-]?policy/i, /\/cookies\b/i] },
  { name: "Accessibility", patterns: [/\/accessibility/i, /\/a11y\b/i] },
  { name: "GDPR", patterns: [/\/gdpr/i, /data[_-]?protection/i] },
  { name: "Imprint", patterns: [/\/imprint/i, /\/impressum/i] },
  { name: "About", patterns: [/\/about/i, /about[_-]?us/i, /\/company$/i] },
  { name: "Team", patterns: [/\/team/i, /our[_-]?team/i, /\/people/i, /\/leadership/i] },
];

const CONSENT_PROVIDERS: Array<{ name: string; pattern: RegExp }> = [
  { name: "Cookiebot", pattern: /cookiebot/i },
  { name: "OneTrust", pattern: /onetrust|optanon/i },
  { name: "Quantcast", pattern: /quantcast.*choice|__tcfapi/i },
  { name: "TrustArc", pattern: /trustarc|truste/i },
  { name: "Osano", pattern: /osano/i },
  { name: "CookieYes", pattern: /cookieyes/i },
  { name: "Didomi", pattern: /didomi/i },
  { name: "Usercentrics", pattern: /usercentrics/i },
];

// Well-known paths to probe via HEAD when HTML link scanning misses a page type.
// Only probed for page types NOT already found in the HTML scan.
const PROBE_PATHS: Record<string, string[]> = {
  About: ["/about", "/about-us", "/company"],
  Team: ["/team", "/our-team"],
  "Privacy Policy": ["/privacy", "/privacy-policy"],
  "Terms of Service": ["/terms", "/tos", "/terms-of-service"],
};

export async function detectLegalPages(
  html: string,
  domain: string,
  env: Env,
  probeTimeoutMs = 4_000,
): Promise<LegalResult> {
  const pagesFound: Array<{ name: string; url: string }> = [];
  const seen = new Set<string>();

  // Extract all <a href="..."> links
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] ?? "";
    const text = (match[2] ?? "")
      .replace(/<[^>]+>/g, "")
      .trim()
      .toLowerCase();

    for (const lp of LEGAL_PATTERNS) {
      if (seen.has(lp.name)) continue;
      const hrefMatch = lp.patterns.some((p) => p.test(href));
      const textMatch = lp.patterns.some((p) => p.test(text));
      if (hrefMatch || textMatch) {
        seen.add(lp.name);
        let url = href;
        if (url && !url.startsWith("http")) {
          try {
            url = new URL(url, `https://${domain}`).href;
          } catch {
            /* keep as-is */
          }
        }
        pagesFound.push({ name: lp.name, url });
      }
    }
  }

  // Probe fallback: for page types not found in HTML, HEAD-request well-known paths
  const probePromises: Promise<void>[] = [];
  for (const [name, paths] of Object.entries(PROBE_PATHS)) {
    if (seen.has(name)) continue; // Already found in HTML scan

    probePromises.push(
      (async () => {
        for (const path of paths) {
          if (seen.has(name)) break; // Another probe already found it
          try {
            const url = `https://${domain}${path}`;
            const result = await probeHeadWithFallback(url, env, { timeout: probeTimeoutMs });
            if (result.ok && result.contentType.includes("text/html")) {
              pagesFound.push({ name, url });
              seen.add(name);
              break;
            }
          } catch {
            /* timeout or network error — skip this path */
          }
        }
      })(),
    );
  }
  // Run all probe groups concurrently, but cap total probe time at 8s
  await Promise.race([Promise.all(probePromises), new Promise<void>((resolve) => setTimeout(resolve, 8_000))]);

  let cookieConsentDetected = false;
  let consentProvider: string | null = null;
  for (const cp of CONSENT_PROVIDERS) {
    if (cp.pattern.test(html)) {
      cookieConsentDetected = true;
      consentProvider = cp.name;
      break;
    }
  }

  return { pages_found: pagesFound, cookie_consent_detected: cookieConsentDetected, consent_provider: consentProvider };
}

// ─── NEW: Cookie Security Audit ─────────────────────────────────────
// ─── NEW: AI Readiness Score ────────────────────────────────────────

export function calculateAiReadiness(
  llmsTxt: LlmsTxtResult | null,
  robotsParsed: RobotsParsed,
  jsonLd: JsonLdItem[],
  html: string,
  ogResult: OgTwitterResult | null,
  ansResult?: AnsResult | null,
): AiReadinessResult {
  const checks: Array<{ name: string; passed: boolean; points: number }> = [];

  // llms.txt
  const hasLlmsTxt = !!llmsTxt?.found;
  checks.push({ name: "llms.txt exists", passed: hasLlmsTxt, points: hasLlmsTxt ? 20 : 0 });

  const hasLlmsFull = !!llmsTxt?.full_found;
  checks.push({ name: "llms-full.txt exists", passed: hasLlmsFull, points: hasLlmsFull ? 10 : 0 });

  // Check robots.txt for AI bots
  const aiAgents: Record<string, { allow: number; deny: number }> = {};
  const aiBotNames = ["GPTBot", "ClaudeBot", "CCBot", "Bingbot", "Google-Extended", "anthropic-ai", "ChatGPT-User"];

  // First pass: collect wildcard defaults
  let wildcardDeny = false;
  let wildcardAllow = false;
  for (const block of robotsParsed.blocks) {
    if (block.user_agent === "*") {
      if (block.disallow.includes("/")) wildcardDeny = true;
      else wildcardAllow = true;
    }
  }
  // Apply wildcard as default for all bots
  if (wildcardDeny || wildcardAllow) {
    for (const bot of aiBotNames) {
      aiAgents[bot] = { allow: wildcardAllow ? 1 : 0, deny: wildcardDeny ? 1 : 0 };
    }
  }
  // Second pass: bot-specific rules override wildcard
  for (const block of robotsParsed.blocks) {
    const ua = block.user_agent.toLowerCase();
    for (const bot of aiBotNames) {
      if (ua === bot.toLowerCase()) {
        aiAgents[bot] = { allow: 0, deny: 0 }; // reset wildcard for this bot
        if (block.disallow.includes("/")) aiAgents[bot].deny++;
        else aiAgents[bot].allow++;
      }
    }
  }

  const gptBotAllowed = !aiAgents.GPTBot?.deny;
  checks.push({ name: "Allows GPTBot", passed: gptBotAllowed, points: gptBotAllowed ? 15 : -15 });

  const claudeBotAllowed = !aiAgents.ClaudeBot?.deny && !aiAgents.CCBot?.deny;
  checks.push({ name: "Allows ClaudeBot", passed: claudeBotAllowed, points: claudeBotAllowed ? 10 : -10 });

  const bingbotAllowed = !aiAgents.Bingbot?.deny;
  checks.push({ name: "Allows Bingbot", passed: bingbotAllowed, points: bingbotAllowed ? 5 : 0 });

  // JSON-LD
  const hasJsonLd = jsonLd.length > 0;
  checks.push({ name: "Structured data (JSON-LD)", passed: hasJsonLd, points: hasJsonLd ? 15 : 0 });

  const hasOrgSchema = jsonLd.some((j) => j.type.includes("Organization") || j.type.includes("WebSite"));
  checks.push({ name: "Organization/WebSite schema", passed: hasOrgSchema, points: hasOrgSchema ? 10 : 0 });

  // OG tags
  const hasOg = !!(ogResult?.og.title && ogResult.og.description);
  checks.push({ name: "Open Graph tags", passed: hasOg, points: hasOg ? 10 : 0 });

  // RSS
  const rssMatch = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]+href=["']([^"']+)["']/i);
  const rssFeed = rssMatch?.[1] ?? null;
  checks.push({ name: "RSS/Atom feed", passed: !!rssFeed, points: rssFeed ? 5 : 0 });

  // ANS / DNS-AID agent discovery (bonus — above base max)
  const hasAns = !!ansResult?.ans_found;
  checks.push({ name: "ANS record (_ans.)", passed: hasAns, points: hasAns ? 10 : 0 });

  const hasDnsAid = !!ansResult?.agents_found;
  checks.push({ name: "DNS-AID record (_agents.)", passed: hasDnsAid, points: hasDnsAid ? 10 : 0 });

  const hasAgentJson = !!ansResult?.agent_json_found;
  checks.push({ name: "agent.json endpoint", passed: hasAgentJson, points: hasAgentJson ? 5 : 0 });

  const maxScore = 100; // base max — ANS checks are bonus above 100
  const score = Math.max(
    0,
    checks.reduce((sum, c) => sum + c.points, 0),
  );
  const pct = (score / maxScore) * 100;
  const grade = pct >= 80 ? "A" : pct >= 60 ? "B" : pct >= 40 ? "C" : pct >= 20 ? "D" : "F";

  return { score, max_score: maxScore, grade, checks, rss_feed: rssFeed, ans: ansResult ?? null };
}

// ─── Resource Hints Detection ───────────────────────────────────────

export interface ResourceHintsResult {
  preload: string[];
  preconnect: string[];
  prefetch: string[];
  dns_prefetch: string[];
  modulepreload: string[];
  total: number;
}

export function detectResourceHints(html: string): ResourceHintsResult {
  const result: ResourceHintsResult = {
    preload: [],
    preconnect: [],
    prefetch: [],
    dns_prefetch: [],
    modulepreload: [],
    total: 0,
  };
  // Match <link rel="..." href="..."> tags
  const linkRegex = /<link[^>]+>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];
    const relMatch = tag.match(/rel=["']([^"']+)["']/i);
    const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
    if (!relMatch) continue;
    const rel = relMatch[1].toLowerCase();
    const href = hrefMatch?.[1] ?? "";
    if (rel === "preload" && href) {
      result.preload.push(href);
      result.total++;
    } else if (rel === "preconnect" && href) {
      result.preconnect.push(href);
      result.total++;
    } else if (rel === "prefetch" && href) {
      result.prefetch.push(href);
      result.total++;
    } else if (rel === "dns-prefetch" && href) {
      result.dns_prefetch.push(href);
      result.total++;
    } else if (rel === "modulepreload" && href) {
      result.modulepreload.push(href);
      result.total++;
    }
  }
  return result;
}

// ─── NEW: Domain Health Score ───────────────────────────────────────
