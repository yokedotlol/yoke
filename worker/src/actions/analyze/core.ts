// ─── Core Domain Analysis Pipeline ──────────────────────────────────
// Single source of truth for all analysis logic.
// Both the JSON endpoint and the SSE streaming endpoint use this.

import { logApiError, pruneApiErrors } from "../../api-errors";
import { registry } from "../../checks/registry";
import type { CheckContext } from "../../checks/types";
import { getAnalysisCacheTtlMs } from "../../config/cache";
import { backgroundWork, type Env, fetchWithTimeout, normalizeDomain } from "../../helpers";
import { type BreachResult } from "../breaches";
import { analyzeWordPress, probeWordPressSecurity } from "../wordpress";
import { analyzeAccessibility } from "./accessibility";
import { checkCacheHeaders } from "./cache";
import {
  type AnsResult,
  calculateAiReadiness,
  detectHttpProtocols,
  detectLegalPages,
  detectResourceHints,
  extractJsonLd,
  extractSocialMeta,
  parseRobotsDeep,
  probeHttpProtocols,
} from "./content";
import { calculateDomainScore } from "./contextual-scoring";
import { analyzeCookieConsent } from "./cookie-consent";
import { checkDns, dohQuery, isSubdomain } from "./dns";
import { analyzeHttp, auditSecurityHeaders, detectTechStack } from "./http";
import { type NetworkHealth } from "./network-health";
import { detectCompression } from "./performance";
import { auditCookies, detectHosting, isActuallyCloudflare, sanitizeCfHeaders } from "./security";
import { validateStructuredData } from "./structured-data";
import { analyzeThirdPartyScripts } from "./third-party-scripts";
import { analyzeCaaRecords } from "./tier1";
import { checkTrustSignals } from "./trust";
import type {
  BlocklistResult,
  CacheAnalysis,
  CertTransparencyResult,
  CompressionResult,
  CookieSecurityResult,
  CruxResult,
  DnsRecord,
  DnssecResult,
  EmailAuthResult,
  GreenHostingResult,
  GreynoiseResult,
  HostingResult,
  HttpAnalysis,
  IpInfo,
  LlmsTxtResult,
  MetaResult,
  PerformanceResult,
  RdapResult,
  SecurityTxtResult,
  ShodanResult,
  SslResult,
  TrustSignals,
  WafDetection,
  WellKnownResult,
} from "./types";
import { checkWaf } from "./waf";

// ─── Types ───────────────────────────────────────────────────────────

/** Callbacks for streaming progress. All optional — non-streaming callers pass nothing. */
export interface AnalysisCallbacks {
  onPhase?: (
    phase: string,
    status: string,
    label: string,
    total?: number,
    checks?: Array<{ key: string; label: string }>,
  ) => Promise<void>;
  onResult?: (
    key: string,
    value: unknown,
    completed?: number,
    total?: number,
    label?: string,
    error?: boolean,
  ) => Promise<void>;
}

/** Shape of the status sub-object in results. */
interface StatusShape {
  is_up: boolean;
  status_code: number | null;
  response_time_ms: number | null;
  error: string | null;
  status_label: string;
  http_blocked?: boolean;
}

/** The full analysis result object. */
export interface AnalysisResult {
  domain: string;
  analyzed_at: string;
  cached: boolean;
  not_registered?: boolean;
  http_probe_blocked: boolean;
  is_subdomain: boolean;
  dns: { records: DnsRecord[] };
  rdap: RdapResult | null;
  status: {
    is_up: boolean;
    status_code: number | null;
    response_time_ms: number | null;
    error: string | null;
    status_label: string;
    http_blocked?: boolean;
  };
  redirects: Array<{ url: string; status_code: number; server: string | null; response_time_ms: number }>;
  headers: {
    raw: Record<string, string>;
    security_audit: Array<{ header: string; status: string; value: string | null; recommendation: string | null }>;
    security_grade: string;
  } | null;
  tech_stack: Array<{ category: string; name: string; version: string | null; confidence: string }> | null;
  meta: MetaResult;
  ip_info: IpInfo | null;
  blocklists: BlocklistResult[];
  ssl: SslResult | null;
  performance: PerformanceResult;
  performance_desktop: PerformanceResult | null;
  performance_crux: CruxResult | null;
  llms_txt: LlmsTxtResult;
  wayback: unknown;
  tranco_rank: number | null;
  email_auth: EmailAuthResult;
  carbon: unknown;
  robots_parsed: unknown;
  json_ld: unknown[];
  http_protocols: { http2: boolean; http3: boolean; alt_svc?: string | null };
  shodan: ShodanResult | null;
  dnssec: DnssecResult;
  hosting: HostingResult;
  social_meta: unknown;
  legal: unknown;
  cookie_security: CookieSecurityResult | null;
  compression: CompressionResult | null;
  cache_analysis: CacheAnalysis | null;
  waf: WafDetection | null;
  trust_signals: TrustSignals | null;
  ai_readiness: unknown;
  wordpress: unknown;
  breaches: BreachResult;
  cert_transparency: CertTransparencyResult;
  security_txt: SecurityTxtResult;
  green_hosting: GreenHostingResult;
  well_known: WellKnownResult;
  caa_analysis: unknown;
  greynoise: GreynoiseResult | null;
  domain_score: unknown;
  structured_data: unknown;
  accessibility: unknown;
  third_party_scripts: unknown;
  cookie_consent: unknown;
  social_accounts: {
    accounts: Array<{ platform: string; url: string; username: string | null; found_via: string }>;
  } | null;
  [key: string]: unknown;
}

/** Cache lookup result. */
export interface CacheHit {
  kind: "cached";
  data: AnalysisResult;
}

/** NXDOMAIN result. */
export interface NxdomainResult {
  kind: "nxdomain";
  data: AnalysisResult;
}

/** Full analysis result. */
export interface AnalysisComplete {
  kind: "complete";
  data: AnalysisResult;
}

export type CoreResult = CacheHit | NxdomainResult | AnalysisComplete;

// ─── Not-registered template ─────────────────────────────────────────

function makeNxdomainResult(domain: string): AnalysisResult {
  return {
    domain,
    analyzed_at: new Date().toISOString(),
    cached: false,
    not_registered: true,
    http_probe_blocked: true,
    is_subdomain: false,
    status: {
      is_up: false,
      status_code: null,
      response_time_ms: null,
      error: "Domain not registered (NXDOMAIN)",
      status_label: "NOT REGISTERED",
    },
    dns: { records: [] },
    rdap: null,
    redirects: [],
    headers: null,
    tech_stack: null,
    meta: {
      robots_txt: null,
      robots_txt_exists: false,
      sitemap_detected: false,
      sitemap_url: null,
      sitemap_page_count: null,
      og_title: null,
      og_description: null,
      og_image: null,
      favicon_url: null,
    },
    ip_info: null,
    blocklists: [],
    ssl: null,
    performance: DEFAULT_PERFORMANCE,
    performance_desktop: null,
    performance_crux: null,
    llms_txt: DEFAULT_LLMS_TXT,
    wayback: null,
    tranco_rank: null,
    email_auth: DEFAULT_EMAIL_AUTH,
    carbon: null,
    robots_parsed: null,
    json_ld: [],
    http_protocols: { http2: false, http3: false },
    shodan: null,
    dnssec: DEFAULT_DNSSEC,
    hosting: { provider: null, cdn: null, waf: null } as HostingResult,
    social_meta: null,
    legal: null,
    cookie_security: null,
    compression: null,
    cache_analysis: null,
    waf: null,
    trust_signals: null,
    ai_readiness: null,
    wordpress: null,
    breaches: DEFAULT_BREACH,
    cert_transparency: DEFAULT_CERT_TRANSPARENCY,
    security_txt: DEFAULT_SECURITY_TXT,
    green_hosting: DEFAULT_GREEN_HOSTING,
    well_known: DEFAULT_WELL_KNOWN,
    caa_analysis: null,
    greynoise: null,
    domain_score: null,
    structured_data: null,
    accessibility: null,
    third_party_scripts: null,
    cookie_consent: null,
    social_accounts: null,
  };
}

// ─── ISP → Hosting provider mapping ─────────────────────────────────

const HOSTING_ISPS = [
  { pattern: /github/i, name: "GitHub" },
  { pattern: /gitlab/i, name: "GitLab" },
  { pattern: /automattic/i, name: "Automattic (WordPress)" },
  { pattern: /shopify/i, name: "Shopify" },
  { pattern: /squarespace/i, name: "Squarespace" },
  { pattern: /wix/i, name: "Wix" },
  { pattern: /heroku|salesforce/i, name: "Heroku (Salesforce)" },
  { pattern: /rackspace/i, name: "Rackspace" },
  { pattern: /oracle.*cloud/i, name: "Oracle Cloud" },
  { pattern: /alibaba/i, name: "Alibaba Cloud" },
  { pattern: /tencent/i, name: "Tencent Cloud" },
  { pattern: /vultr/i, name: "Vultr" },
  { pattern: /linode/i, name: "Linode" },
  { pattern: /scaleway/i, name: "Scaleway" },
  { pattern: /dreamhost/i, name: "DreamHost" },
  { pattern: /bluehost/i, name: "Bluehost" },
  { pattern: /hostgator/i, name: "HostGator" },
  { pattern: /siteground/i, name: "SiteGround" },
  { pattern: /ionos/i, name: "IONOS" },
  { pattern: /netlify/i, name: "Netlify" },
  { pattern: /vercel/i, name: "Vercel" },
  { pattern: /fly\.io/i, name: "Fly.io" },
  { pattern: /render/i, name: "Render" },
  { pattern: /railway/i, name: "Railway" },
  { pattern: /notion/i, name: "Notion Labs" },
  { pattern: /stripe/i, name: "Stripe" },
  { pattern: /twitter|x corp/i, name: "X (Twitter)" },
  { pattern: /meta platform|facebook/i, name: "Meta Platforms" },
  { pattern: /apple/i, name: "Apple" },
  { pattern: /discord/i, name: "Discord" },
] as const;

// ─── Default fallback values for Phase 2 checks ─────────────────────

const DEFAULT_PERFORMANCE: PerformanceResult = {
  score: null,
  fcp: null,
  lcp: null,
  tbt: null,
  cls: null,
  si: null,
  ttfb: null,
  strategy: "mobile",
  error: null,
  screenshot: null,
};
const DEFAULT_STATUS: StatusShape = {
  is_up: false,
  status_code: null,
  response_time_ms: null,
  error: "Phase 2 promise rejected",
  status_label: "error",
  http_blocked: false,
};
const DEFAULT_LLMS_TXT: LlmsTxtResult = { found: false, content: null, full_found: false, full_content: null };
const DEFAULT_EMAIL_AUTH: EmailAuthResult = {
  spf: { found: false, record: null, mechanisms: [], all_qualifier: null },
  dmarc: { found: false, record: null, policy: null, subdomain_policy: null, rua: null, ruf: null },
  dkim_selectors_found: [],
  bimi: { found: false, record: null, logo_url: null, authority_url: null },
  mta_sts: { dns_found: false, policy_found: false, mode: null },
  tls_rpt: { found: false, record: null, rua: null },
};
const DEFAULT_DNSSEC: DnssecResult = { enabled: false, has_dnskey: false, has_ds: false, validated: false };
const DEFAULT_BREACH: BreachResult = { found: false, count: 0, total_pwned: 0, items: [] };
const DEFAULT_CERT_TRANSPARENCY: CertTransparencyResult = {
  subdomains: [],
  total_certs: 0,
  has_wildcard: false,
  issuers: [],
  certs: [],
  error: null,
};
const DEFAULT_SECURITY_TXT: SecurityTxtResult = {
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
const DEFAULT_GREEN_HOSTING: GreenHostingResult = {
  green: false,
  hosted_by: null,
  hosted_by_website: null,
  error: null,
};
const DEFAULT_WELL_KNOWN: WellKnownResult = {
  endpoints: [],
  pwa_ready: false,
  has_mobile_apps: false,
  ads_partner_count: null,
};

// ─── Core Analysis Pipeline ─────────────────────────────────────────

// ─── Request Coalescing (Singleflight) ──────────────────────────────
// Deduplicates concurrent analysis requests for the same domain.
// When multiple requests arrive for the same domain simultaneously,
// only the first runs the full pipeline — the rest piggyback on its result.
// SSE callers that piggyback will receive the final result without streaming
// progress events (same UX as a cache hit).
const inFlightAnalyses = new Map<string, Promise<CoreResult>>();

/**
 * Run the full domain analysis pipeline.
 *
 * @param domain   - Raw domain string (will be normalized)
 * @param env      - Cloudflare Worker environment bindings
 * @param skipCache - Force fresh analysis
 * @param callbacks - Optional streaming callbacks for progress reporting
 * @returns CoreResult with `kind` indicating cache hit, NXDOMAIN, or full analysis
 */
export async function runAnalysis(
  domain: string,
  env: Env,
  skipCache: boolean,
  callbacks?: AnalysisCallbacks,
): Promise<CoreResult> {
  domain = normalizeDomain(domain);
  if (!domain?.includes(".")) {
    throw new Error("Invalid domain");
  }

  // ── Request coalescing ────────────────────────────────────────────
  // When not forcing fresh analysis, piggyback on any in-flight request for the
  // same domain. SSE callers that piggyback will receive the final result without
  // streaming progress events — same UX as a cache hit.
  if (!skipCache) {
    const existing = inFlightAnalyses.get(domain);
    if (existing) {
      return existing;
    }
  }

  // Wrap the actual work in a promise for coalescing.
  // Only store in the map for non-forced requests.
  const promise = runAnalysisCore(domain, env, skipCache, callbacks);

  if (!skipCache) {
    inFlightAnalyses.set(domain, promise);
    // Clean up when done (success or failure)
    promise.finally(() => inFlightAnalyses.delete(domain));
  }

  return promise;
}

/** Internal: runs the full analysis pipeline. Callers go through runAnalysis(). */
async function runAnalysisCore(
  domain: string,
  env: Env,
  skipCache: boolean,
  callbacks?: AnalysisCallbacks,
): Promise<CoreResult> {
  // Derive instance hostname for self-analysis bypass (CF Workers can't fetch themselves)
  let instanceHost: string | undefined;
  try {
    instanceHost = env.BASE_URL ? new URL(env.BASE_URL).hostname : undefined;
  } catch {
    /* ignore */
  }

  const onPhase = callbacks?.onPhase ?? (async () => {});
  const onResult = callbacks?.onResult ?? (async () => {});

  // ── Cache check ──────────────────────────────────────────────────
  if (!skipCache && env.REFERENCE_DATA) {
    try {
      const raw = await env.REFERENCE_DATA.get(`cache:analysis:${domain}`, "text");
      if (raw) {
        const envelope = JSON.parse(raw) as { data: unknown; cached_at: number };
        if (Date.now() - envelope.cached_at < getAnalysisCacheTtlMs(env)) {
          const parsed = envelope.data as AnalysisResult;
          return { kind: "cached", data: { ...parsed, cached: true, cached_at: envelope.cached_at } };
        }
      }
    } catch (e) {
      console.warn(`[yoke:cache] KV read failed for ${domain}:`, e instanceof Error ? e.message : e);
    }
  }

  // ── Phase 0: Quick NXDOMAIN check ────────────────────────────────
  try {
    const quickData = await dohQuery(domain, "A");
    if (quickData && quickData.Status === 3) {
      const nxResult = makeNxdomainResult(domain);
      if (env.REFERENCE_DATA) {
        try {
          const envelope = { data: nxResult, cached_at: Date.now() };
          await env.REFERENCE_DATA.put(`cache:analysis:${domain}`, JSON.stringify(envelope), {
            expirationTtl: Math.max(60, Math.ceil(getAnalysisCacheTtlMs(env) / 1000)),
          });
        } catch {
          /* ignore */
        }
      }
      return { kind: "nxdomain", data: nxResult };
    }
  } catch {
    /* DNS check failed, proceed with full analysis */
  }

  // ── Phase 1: DNS + HTTP ──────────────────────────────────────────
  await onPhase("dns", "running", "Resolving DNS…");

  let dnsRecords: DnsRecord[];
  let httpAnalysis: HttpAnalysis | null;
  {
    const [dnsResult, httpResult] = await Promise.allSettled([
      checkDns(domain),
      analyzeHttp(domain, instanceHost, env),
    ]);
    dnsRecords = dnsResult.status === "fulfilled" ? dnsResult.value : [];
    httpAnalysis = httpResult.status === "fulfilled" ? httpResult.value : null;
  }

  const httpStatusCode = httpAnalysis?.status_code ?? 0;
  const httpProbeSucceeded = httpStatusCode >= 200 && httpStatusCode < 400;
  const html = httpProbeSucceeded ? (httpAnalysis?.html ?? "") : "";
  const rawHeadersOriginal = httpProbeSucceeded ? (httpAnalysis?.headers?.raw ?? null) : null;

  // Stream Phase 1 results
  await onResult("dns", { records: dnsRecords });
  if (httpAnalysis) {
    await onResult("redirects", httpProbeSucceeded ? (httpAnalysis.redirects ?? []) : []);
    if (httpProbeSucceeded && httpAnalysis.headers) {
      await onResult("headers", {
        raw: httpAnalysis.headers.raw ?? {},
        security_audit: httpAnalysis.headers.security_audit ?? [],
        security_grade: httpAnalysis.headers.security_grade ?? "F",
      });
    }
    if (httpProbeSucceeded && httpAnalysis.tech_stack) {
      await onResult("tech_stack", httpAnalysis.tech_stack);
    }
    if (httpProbeSucceeded && httpAnalysis.meta) {
      await onResult("meta_partial", httpAnalysis.meta);
    }
  }

  // ── Phase 2: All parallel checks ─────────────────────────────────
  const ip = dnsRecords.find((r) => r.type === "A")?.data;
  const domainIsSubdomain = isSubdomain(domain);

  // Build check context from Phase 1 results for the registry
  const checkCtx: CheckContext = {
    domain,
    env,
    instanceHost,
    dnsRecords,
    ip,
    httpResponseTimeMs: httpAnalysis?.response_time_ms ?? null,
    skipCache,
  };

  // Per-check timeout: individual checks that exceed this limit fall back to defaults.
  // This prevents a single slow API from blocking the entire analysis pipeline.
  const PER_CHECK_TIMEOUT_MS = 30_000;

  // Launch all Phase 2 checks from the registry (one file per check — see worker/src/checks/)
  const checks = registry.map((check) => {
    const timeoutMs = check.timeout ?? PER_CHECK_TIMEOUT_MS;
    return {
      key: check.key,
      promise: Promise.race([
        check.run(checkCtx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Check ${check.key} timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]),
      label: check.label,
      default: check.default,
    };
  });

  await onPhase(
    "phase2",
    "running",
    `Running ${checks.length} checks…`,
    checks.length,
    checks.map((c) => ({ key: c.key, label: c.label })),
  );

  // Collect results as they arrive, streaming each via onResult
  const results: Record<string, unknown> = {};
  let completed = 0;

  const wrappedPromises = checks.map(({ key, promise, label, default: defaultValue }) =>
    promise.then(
      (value) => {
        results[key] = value;
        completed++;
        const sendPromise = onResult(key, value, completed, checks.length, label);

        // When _status arrives, compute and send early enhanced status
        if (key === "_status") {
          const sr = value as StatusShape | null;
          const statusVal: StatusShape = sr ?? {
            is_up: false,
            status_code: null,
            response_time_ms: null,
            error: "Check failed",
            status_label: "DOWN",
            http_blocked: false,
          };
          const dnsOk = dnsRecords.some((r) => r.type === "A" || r.type === "AAAA");
          let earlyStatus: StatusShape = { ...statusVal };
          if (httpProbeSucceeded && httpAnalysis) {
            const fc = httpAnalysis.redirects?.[httpAnalysis.redirects.length - 1]?.status_code;
            if (fc && fc >= 200 && fc < 400) {
              earlyStatus = {
                ...statusVal,
                is_up: true,
                status_code: fc,
                status_label: "UP",
                http_blocked: false,
                error: null,
              };
            }
          } else if (!statusVal.is_up && dnsOk) {
            earlyStatus = {
              ...statusVal,
              is_up: true,
              status_label: "RESTRICTED",
              http_blocked: true,
              error: "Site is online (DNS resolves) but blocked our HTTP probe",
            };
          } else if (statusVal.http_blocked && dnsOk) {
            earlyStatus = {
              ...statusVal,
              is_up: true,
              status_label: "RESTRICTED",
              error: `Site returned HTTP ${statusVal.status_code} — blocking automated requests`,
            };
          }
          return sendPromise.then(() => onResult("status", earlyStatus));
        }
        return sendPromise;
      },
      (err) => {
        results[key] = defaultValue;
        completed++;
        // Log API error for observability
        logApiError(env.STATS_DB, {
          api: key.replace(/^_/, ""),
          status: 0,
          message: String(err).slice(0, 200),
          domain,
        });
        return onResult(key, defaultValue, completed, checks.length, label, true);
      },
    ),
  );

  // Overall Phase 2 deadline: if checks collectively exceed this limit, proceed
  // with whatever results have arrived. Leaves ~10s for scoring + response assembly.
  const PHASE2_DEADLINE_MS = 70_000;
  await Promise.race([
    Promise.allSettled(wrappedPromises),
    new Promise<void>((resolve) => setTimeout(resolve, PHASE2_DEADLINE_MS)),
  ]);

  // Fill in defaults for any checks that haven't completed yet
  for (const check of checks) {
    if (!(check.key in results)) {
      results[check.key] = check.default;
    }
  }

  // Probabilistic prune of old error rows (~5% of requests) — non-blocking
  if (Math.random() < 0.05) backgroundWork(env, pruneApiErrors(env.STATS_DB));

  // ── Assemble final result ────────────────────────────────────────

  const rdapResult = (results.rdap ?? null) as RdapResult | null;
  const robotsSitemap = (results._robots_sitemap ?? {
    robots_txt: null,
    robots_txt_exists: false,
    sitemap_detected: false,
    sitemap_url: null,
    sitemap_page_count: null,
  }) as Pick<
    MetaResult,
    "robots_txt" | "robots_txt_exists" | "sitemap_detected" | "sitemap_url" | "sitemap_page_count"
  >;
  const ipInfo = (results.ip_info ?? null) as IpInfo | null;
  const blocklists = (results.blocklists ?? []) as BlocklistResult[];
  const sslResult = (results.ssl ?? null) as SslResult | null;
  const pageSpeedResult = (results.performance ?? DEFAULT_PERFORMANCE) as PerformanceResult;
  const pageSpeedDesktop = (results.performance_desktop ?? null) as PerformanceResult | null;
  const cruxResult = (results.crux ?? null) as CruxResult | null;
  const statusResult = (results._status ?? DEFAULT_STATUS) as StatusShape;
  const llmsTxt = (results.llms_txt ?? DEFAULT_LLMS_TXT) as LlmsTxtResult;
  const wayback = (results.wayback ?? null) as {
    first_snapshot: string | null;
    last_snapshot: string | null;
    total_snapshots: number | null;
    archive_url: string;
  } | null;
  const tranco = (results.tranco_rank ?? null) as number | null;
  const emailAuth = (results.email_auth ?? DEFAULT_EMAIL_AUTH) as EmailAuthResult;
  const carbon = results.carbon ?? null;
  const shodanResult = (results.shodan ?? null) as ShodanResult | null;
  const dnssecResult = (results.dnssec ?? DEFAULT_DNSSEC) as DnssecResult;
  const breachResult = (results.breaches ?? DEFAULT_BREACH) as BreachResult;
  const certTransparency = (results.cert_transparency ?? DEFAULT_CERT_TRANSPARENCY) as CertTransparencyResult;
  const securityTxt = (results.security_txt ?? DEFAULT_SECURITY_TXT) as SecurityTxtResult;
  const greenHosting = (results.green_hosting ?? DEFAULT_GREEN_HOSTING) as GreenHostingResult;
  const wellKnown = (results.well_known ?? DEFAULT_WELL_KNOWN) as WellKnownResult;
  const greynoiseResult = (results.greynoise ?? null) as GreynoiseResult | null;
  const ansResult = results.ans ?? null;
  const dnsPropagation = (results.dns_propagation ?? null) as import("./network-health").DnsPropagation | null;
  const ripeRouting = (results.ripe_routing ?? null) as import("./network-health").RipeRouting | null;
  const outageLinks = (results.outage_links ?? null) as import("./network-health").OutageLinks | null;
  const connectionTimingResult = (results.connection_timing ?? null) as
    | import("./network-health").ConnectionTiming
    | null;
  const socialAccountsResult = (results.social_accounts ?? { accounts: [] }) as {
    accounts: Array<{ platform: string; url: string; username: string | null; found_via: string }>;
  };

  // Build merged meta
  const meta: MetaResult = {
    ...(robotsSitemap ?? {
      robots_txt: null,
      robots_txt_exists: false,
      sitemap_detected: false,
      sitemap_url: null,
      sitemap_page_count: null,
    }),
    og_title: httpProbeSucceeded ? (httpAnalysis?.meta?.og_title ?? null) : null,
    og_description: httpProbeSucceeded ? (httpAnalysis?.meta?.og_description ?? null) : null,
    og_image: httpProbeSucceeded ? (httpAnalysis?.meta?.og_image ?? null) : null,
    favicon_url: httpProbeSucceeded ? (httpAnalysis?.meta?.favicon_url ?? null) : null,
  };

  // Enhanced status with DNS-based fallback
  const dnsResolves = dnsRecords.some((r) => r.type === "A" || r.type === "AAAA");
  const sslValid = sslResult && !sslResult.error && sslResult.grade !== null;
  let enhancedStatus: StatusShape = { ...statusResult };
  if (httpProbeSucceeded && httpAnalysis) {
    const finalCode = httpAnalysis.redirects?.[httpAnalysis.redirects.length - 1]?.status_code;
    if (finalCode && finalCode >= 200 && finalCode < 400) {
      enhancedStatus = {
        ...statusResult,
        is_up: true,
        status_code: finalCode,
        status_label: "UP",
        http_blocked: false,
        error: null,
      };
    }
  } else if (!statusResult.is_up && dnsResolves) {
    // Distinguish between "timed out with no response" and "actively blocked"
    // A full timeout (response_time >= 10s, no status code) means the site is effectively down
    // even if DNS resolves — don't upgrade to RESTRICTED just because DNS works
    const fullTimeout =
      statusResult.response_time_ms != null &&
      statusResult.response_time_ms >= 10000 &&
      statusResult.status_code == null;
    if (fullTimeout) {
      // Leave as DOWN — DNS alone doesn't mean the site is serving content
      enhancedStatus = {
        ...statusResult,
        is_up: false,
        status_label: "DOWN",
        http_blocked: false,
        error: "Site timed out — DNS resolves but no HTTP response",
      };
    } else {
      enhancedStatus = {
        ...statusResult,
        is_up: true,
        status_label: "RESTRICTED",
        http_blocked: true,
        error: sslValid
          ? "Site is online (DNS resolves, SSL valid) but blocked our HTTP probe"
          : "Site is online (DNS resolves) but blocked our HTTP probe",
      };
    }
  } else if (statusResult.http_blocked && dnsResolves) {
    enhancedStatus = {
      ...statusResult,
      is_up: true,
      status_label: "RESTRICTED",
      error: `Site returned HTTP ${statusResult.status_code} — blocking automated requests`,
    };
  }

  // Stream the final enhanced status
  await onResult("status", enhancedStatus);

  // Derived analysis (synchronous computations)
  const robotsParsed = parseRobotsDeep(meta.robots_txt, meta.robots_txt_exists);
  const jsonLd = extractJsonLd(html);

  const siteIsCloudflareRefined = isActuallyCloudflare(dnsRecords, ipInfo);
  const effectiveHeaders =
    rawHeadersOriginal && !siteIsCloudflareRefined ? sanitizeCfHeaders(rawHeadersOriginal) : rawHeadersOriginal;

  // Detect HTTP protocols — prefer Fly probe data from status check, then header detection, then dedicated probe
  const statusAny = statusResult as unknown as Record<string, unknown>;
  const statusHasProtocols = !!statusAny.http2 || !!statusAny.http3;
  let httpProtocols = statusHasProtocols
    ? { http2: !!statusAny.http2, http3: !!statusAny.http3, alt_svc: (statusAny.alt_svc as string | null) ?? null }
    : detectHttpProtocols(effectiveHeaders);
  // Fallback: dedicated protocol probe if nothing detected yet
  if (!httpProtocols.http2 && !httpProtocols.http3) {
    try {
      const probed = await probeHttpProtocols(domain, env);
      if (probed.http2 || probed.http3) httpProtocols = probed;
    } catch {
      /* subrequest limit or network error — accept false */
    }
  }

  // Re-run security audit + tech stack with cleaned headers if we sanitized
  let finalSecurityAudit = httpAnalysis?.headers?.security_audit ?? [];
  let finalSecurityGrade = httpAnalysis?.headers?.security_grade ?? "F";
  let finalTechStack = httpAnalysis?.tech_stack ?? [];

  if (!httpProbeSucceeded) {
    finalSecurityAudit = [];
    finalSecurityGrade = "N/A";
    finalTechStack = [];
  } else if (effectiveHeaders && !siteIsCloudflareRefined && rawHeadersOriginal) {
    const { audit: cleanAudit, grade: cleanGrade } = auditSecurityHeaders(effectiveHeaders);
    finalSecurityAudit = cleanAudit;
    finalSecurityGrade = cleanGrade;
    finalTechStack = detectTechStack(effectiveHeaders, html);
  }

  const hosting = detectHosting(ipInfo, effectiveHeaders);
  const wpDetails = httpProbeSucceeded ? analyzeWordPress(html, effectiveHeaders ?? {}, dnsRecords) : null;

  // WordPress security probes — quick HEAD/GET checks for common WP security issues
  if (wpDetails) {
    try {
      const wpProbes = await probeWordPressSecurity(domain, fetchWithTimeout);
      wpDetails.xmlrpc_accessible = wpProbes.xmlrpc_accessible;
      wpDetails.login_accessible = wpProbes.login_accessible;
      wpDetails.user_enumeration = wpProbes.user_enumeration;
      wpDetails.directory_listing = wpProbes.directory_listing;
    } catch {
      // Probes are best-effort — don't fail the analysis
    }
  }

  // ISP fallback for hosting provider
  if (!hosting.provider && ipInfo?.isp) {
    for (const { pattern, name } of HOSTING_ISPS) {
      if (pattern.test(ipInfo.isp) || (ipInfo.org && pattern.test(ipInfo.org))) {
        hosting.provider = name;
        break;
      }
    }
  }

  const socialMeta = extractSocialMeta(html);
  const legal = await detectLegalPages(html, domain);
  const resourceHints = detectResourceHints(html);
  const cookieSecurity = auditCookies(effectiveHeaders);
  const compression = detectCompression(effectiveHeaders);
  const cacheAnalysis = checkCacheHeaders(effectiveHeaders);

  // WAF detection: gather set-cookie headers for cookie-based signals
  const setCookieRaw = effectiveHeaders?.["set-cookie"] ?? "";
  const setCookieHeaders = setCookieRaw ? setCookieRaw.split(/\n/) : [];
  const wafDetection = httpProbeSucceeded ? checkWaf(effectiveHeaders, html, setCookieHeaders) : null;

  const aiReadiness = calculateAiReadiness(
    llmsTxt,
    robotsParsed,
    jsonLd,
    html,
    socialMeta,
    ansResult as AnsResult | null,
  );
  const structuredDataValidation = validateStructuredData(jsonLd);

  const accessibilityResult = httpProbeSucceeded ? analyzeAccessibility(html) : null;
  const thirdPartyScriptsResult = httpProbeSucceeded ? analyzeThirdPartyScripts(html, domain) : null;
  const cookieConsentResult = httpProbeSucceeded ? analyzeCookieConsent(html, effectiveHeaders ?? {}, domain) : null;

  // Trust signal aggregation
  const caaAnalysis = analyzeCaaRecords(dnsRecords);
  const caaRecordsForTrust =
    (caaAnalysis as { records?: Array<{ tag: string; value: string }> } | null)?.records ?? null;
  const trustSignals = httpProbeSucceeded
    ? await checkTrustSignals({
        headers: effectiveHeaders,
        securityTxt: securityTxt,
        emailAuth,
        dnssec: dnssecResult,
        ssl: sslResult,
        caaRecords: caaRecordsForTrust,
        wellKnown: wellKnown,
        waf: wafDetection,
        html,
        hosting,
        domain,
      })
    : null;

  // Network health aggregation
  const networkHealth: NetworkHealth | null =
    dnsPropagation || ripeRouting || connectionTimingResult || outageLinks
      ? {
          dns_propagation: dnsPropagation,
          ripe_routing: ripeRouting,
          connection_timing: connectionTimingResult,
          outage_links: outageLinks,
        }
      : null;

  // Contextual domain score
  const domainScore = calculateDomainScore({
    ssl: sslResult,
    securityGrade: httpProbeSucceeded ? finalSecurityGrade : null,
    securityAudit: finalSecurityAudit,
    dnssec: dnssecResult,
    blocklists,
    emailAuth,
    performance: pageSpeedResult,
    performanceDesktop: pageSpeedDesktop,
    crux: cruxResult,
    compression,
    httpProtocols,
    hosting,
    dnsRecords,
    rdap: rdapResult,
    socialMeta,
    jsonLd,
    meta,
    legal,
    resourceHints,
    wayback,
    certTransparency,
    greynoise: greynoiseResult,
    techStack: httpProbeSucceeded
      ? finalTechStack.length > 0
        ? finalTechStack
        : (httpAnalysis?.tech_stack ?? null)
      : null,
    headers: httpProbeSucceeded ? effectiveHeaders : null,
    domain,
    html,
    httpBlocked: !httpProbeSucceeded,
    accessibility: accessibilityResult,
    thirdPartyScripts: thirdPartyScriptsResult,
    cookieConsent: cookieConsentResult,
    cacheAnalysis,
    waf: wafDetection,
    trustSignals,
    networkHealth,
    breaches: breachResult,
    trancoRank: tranco,
    socialAccounts: socialAccountsResult,
    // Phase 1 new signals
    shodan: shodanResult,
    cookieSecurity,
    securityTxt,
    wellKnown,
    redirects: httpProbeSucceeded ? (httpAnalysis?.redirects ?? []) : [],
    statusResult: enhancedStatus,
    robotsParsed,
    wordpress: wpDetails,
  });

  const result: AnalysisResult = {
    domain,
    analyzed_at: new Date().toISOString(),
    cached: false,
    http_probe_blocked: !httpProbeSucceeded,
    is_subdomain: domainIsSubdomain,
    dns: { records: dnsRecords },
    rdap: rdapResult,
    status: enhancedStatus,
    redirects: httpProbeSucceeded ? (httpAnalysis?.redirects ?? []) : [],
    headers:
      httpProbeSucceeded && httpAnalysis
        ? {
            raw: effectiveHeaders ?? {},
            security_audit: finalSecurityAudit,
            security_grade: finalSecurityGrade,
          }
        : null,
    tech_stack: httpProbeSucceeded
      ? finalTechStack.length > 0
        ? finalTechStack
        : (httpAnalysis?.tech_stack ?? null)
      : null,
    meta,
    ip_info: ipInfo,
    blocklists,
    ssl: sslResult,
    performance: pageSpeedResult,
    performance_desktop: pageSpeedDesktop,
    performance_crux: cruxResult,
    llms_txt: llmsTxt,
    wayback,
    tranco_rank: tranco,
    email_auth: emailAuth,
    carbon,
    robots_parsed: robotsParsed,
    json_ld: jsonLd,
    http_protocols: httpProtocols,
    shodan: shodanResult,
    dnssec: dnssecResult,
    hosting,
    social_meta: socialMeta,
    legal,
    resource_hints: resourceHints,
    cookie_security: cookieSecurity,
    compression,
    cache_analysis: cacheAnalysis,
    waf: wafDetection,
    trust_signals: trustSignals,
    ai_readiness: aiReadiness,
    wordpress: wpDetails,
    breaches: breachResult,
    cert_transparency: certTransparency,
    security_txt: securityTxt,
    green_hosting: greenHosting,
    well_known: wellKnown,
    caa_analysis: caaAnalysis,
    greynoise: greynoiseResult,
    domain_score: domainScore,
    structured_data: structuredDataValidation,
    accessibility: accessibilityResult,
    third_party_scripts: thirdPartyScriptsResult,
    cookie_consent: cookieConsentResult,
    network_health: networkHealth,
    social_accounts: socialAccountsResult,
  };

  // ── Post-analysis: score logging, caching, cleanup ───────────────
  // All post-analysis D1 writes are non-blocking background work.
  // They use ctx.waitUntil() so they continue after the response is sent.

  // Historical score logging (non-critical)
  if (domainScore) {
    backgroundWork(
      env,
      (async () => {
        const scoredAt = new Date().toISOString();
        const scoreDate = scoredAt.slice(0, 10); // YYYY-MM-DD for daily dedup

        // Collect top findings for longitudinal diffing (compact: signal keys only)
        const findingsSummary = Object.entries(domainScore.axes)
          .flatMap(
            ([axis, axisData]) =>
              (axisData as { findings?: Array<{ signal: string; severity: string }> }).findings?.map(
                (f) => `${axis}:${f.severity}:${f.signal}`,
              ) ?? [],
          )
          .sort()
          .join("|");

        try {
          await env.STATS_DB.prepare(
            `INSERT OR REPLACE INTO domain_scores (domain, composite_score, security_score, performance_score, reliability_score, trust_score, visibility_score, archetype, archetype_confidence, scored_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              domain,
              domainScore.composite,
              domainScore.axes.security.score,
              domainScore.axes.speed.score,
              domainScore.axes.foundations.score,
              domainScore.axes.reputation.score,
              domainScore.axes.discoverability.score,
              domainScore.archetype.detected,
              domainScore.archetype.confidence,
              scoredAt,
            )
            .run();
        } catch {
          try {
            await env.STATS_DB.prepare(
              `CREATE TABLE IF NOT EXISTS domain_scores (
              id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
              composite_score INTEGER NOT NULL, security_score INTEGER NOT NULL,
              performance_score INTEGER NOT NULL, reliability_score INTEGER NOT NULL,
              trust_score INTEGER NOT NULL, visibility_score INTEGER NOT NULL,
              archetype TEXT NOT NULL, archetype_confidence REAL NOT NULL,
              scored_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(domain, scored_at)
            )`,
            ).run();
            await env.STATS_DB.prepare(
              `CREATE INDEX IF NOT EXISTS idx_domain_scores_domain ON domain_scores(domain)`,
            ).run();
            await env.STATS_DB.prepare(
              `CREATE INDEX IF NOT EXISTS idx_domain_scores_scored_at ON domain_scores(scored_at)`,
            ).run();
            await env.STATS_DB.prepare(
              `INSERT OR REPLACE INTO domain_scores (domain, composite_score, security_score, performance_score, reliability_score, trust_score, visibility_score, archetype, archetype_confidence, scored_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                domain,
                domainScore.composite,
                domainScore.axes.security.score,
                domainScore.axes.speed.score,
                domainScore.axes.foundations.score,
                domainScore.axes.reputation.score,
                domainScore.axes.discoverability.score,
                domainScore.archetype.detected,
                domainScore.archetype.confidence,
                scoredAt,
              )
              .run();
          } catch {
            /* auto-migration + retry failed — non-critical */
          }
        }

        // Daily snapshot: one row per domain per day, overwrites with latest score + findings
        try {
          await env.STATS_DB.prepare(
            `INSERT OR REPLACE INTO daily_snapshots (domain, score_date, composite_score, security_score, performance_score, reliability_score, trust_score, visibility_score, archetype, findings_summary, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              domain,
              scoreDate,
              domainScore.composite,
              domainScore.axes.security.score,
              domainScore.axes.speed.score,
              domainScore.axes.foundations.score,
              domainScore.axes.reputation.score,
              domainScore.axes.discoverability.score,
              domainScore.archetype.detected,
              findingsSummary,
              scoredAt,
            )
            .run();
        } catch {
          try {
            await env.STATS_DB.prepare(
              `CREATE TABLE IF NOT EXISTS daily_snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
              score_date TEXT NOT NULL, composite_score INTEGER NOT NULL,
              security_score INTEGER NOT NULL, performance_score INTEGER NOT NULL,
              reliability_score INTEGER NOT NULL, trust_score INTEGER NOT NULL,
              visibility_score INTEGER NOT NULL, archetype TEXT NOT NULL,
              findings_summary TEXT, updated_at TEXT NOT NULL,
              UNIQUE(domain, score_date)
            )`,
            ).run();
            await env.STATS_DB.prepare(
              `CREATE INDEX IF NOT EXISTS idx_daily_snapshots_domain ON daily_snapshots(domain)`,
            ).run();
            await env.STATS_DB.prepare(
              `CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date ON daily_snapshots(score_date)`,
            ).run();
            await env.STATS_DB.prepare(
              `INSERT OR REPLACE INTO daily_snapshots (domain, score_date, composite_score, security_score, performance_score, reliability_score, trust_score, visibility_score, archetype, findings_summary, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
              .bind(
                domain,
                scoreDate,
                domainScore.composite,
                domainScore.axes.security.score,
                domainScore.axes.speed.score,
                domainScore.axes.foundations.score,
                domainScore.axes.reputation.score,
                domainScore.axes.discoverability.score,
                domainScore.archetype.detected,
                findingsSummary,
                scoredAt,
              )
              .run();
          } catch {
            /* daily snapshot migration failed — non-critical */
          }
        }
      })(),
    );
  }

  // Cache result + recent lookup (non-blocking)
  // Skip caching when the site is unreachable — transient failures (deploys, blips)
  // shouldn't poison the cache for 24h
  const siteIsUp = result.status?.is_up !== false;
  backgroundWork(
    env,
    (async () => {
      if (!env.REFERENCE_DATA) return;
      const cacheTtlSec = Math.max(60, Math.ceil(getAnalysisCacheTtlMs(env) / 1000));

      if (siteIsUp) {
        try {
          const envelope = { data: result, cached_at: Date.now() };
          await env.REFERENCE_DATA.put(`cache:analysis:${domain}`, JSON.stringify(envelope), {
            expirationTtl: cacheTtlSec,
          });
        } catch (e) {
          console.warn(`[yoke:cache] KV write failed for ${domain}:`, e instanceof Error ? e.message : e);
        }
      } else {
        console.log(`[yoke:cache] Skipping cache write for ${domain} — site unreachable`);
      }

      // Recent lookups: maintain a JSON array in KV, prepend new entry, trim to 500
      try {
        const summaryJson = {
          domain,
          analyzed_at: new Date().toISOString(),
          is_up: result.status?.is_up ?? null,
          ssl_grade: result.ssl?.grade ?? null,
          score: domainScore?.composite ?? null,
          tier: domainScore?.tier ?? null,
          archetype: domainScore?.archetype?.detected ?? null,
        };
        const existingRaw = await env.REFERENCE_DATA.get("recent:index", "text");
        const existing: unknown[] = existingRaw ? JSON.parse(existingRaw) : [];
        existing.unshift(summaryJson);
        // Trim to 500 entries
        if (existing.length > 500) existing.length = 500;
        await env.REFERENCE_DATA.put("recent:index", JSON.stringify(existing));
      } catch (e) {
        console.warn(`[yoke:lookups] KV write failed for ${domain}:`, e instanceof Error ? e.message : e);
      }
    })(),
  );

  return { kind: "complete", data: result };
}
