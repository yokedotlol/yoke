// Simple fetch wrapper replacing @hatch/space-sdk/client's createActionClient.
// Each function calls the corresponding /api/* route.

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    let msg = `API error ${res.status}`;
    try {
      const j = JSON.parse(body);
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ─── SSE Streaming Analysis ──────────────────────────────────────────
// Streams analysis results as they complete, calling onEvent for each chunk.

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // unix timestamp
}

export type StreamEvent =
  | { type: "phase" | "result" | "done" | "error"; data: unknown }
  | { type: "ratelimit"; data: RateLimitInfo };

export async function analyzeStream(
  domain: string,
  onEvent: (evt: StreamEvent) => void,
  signal?: AbortSignal,
  force?: boolean,
): Promise<void> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ domain, ...(force ? { force: true } : {}) }),
    signal,
  });

  // Extract rate limit headers before checking status
  const rlLimit = res.headers.get("X-RateLimit-Limit");
  const rlRemaining = res.headers.get("X-RateLimit-Remaining");
  const rlReset = res.headers.get("X-RateLimit-Reset");
  if (rlLimit && rlRemaining && rlReset) {
    onEvent({
      type: "ratelimit",
      data: {
        limit: parseInt(rlLimit, 10),
        remaining: parseInt(rlRemaining, 10),
        reset: parseInt(rlReset, 10),
      },
    });
  }

  if (!res.ok) {
    const body = await res.text();
    let msg = `API error ${res.status}`;
    let code = "";
    let reset = 0;
    try {
      const j = JSON.parse(body);
      if (j.error) msg = j.error;
      if (j.code) code = j.code;
      if (j.reset) reset = j.reset;
    } catch {
      /* ignore */
    }
    if (res.status === 429 || code === "RATE_LIMITED") {
      const resetIn = reset ? Math.max(0, reset - Math.floor(Date.now() / 1000)) : 0;
      const mins = Math.ceil(resetIn / 60);
      throw new Error(`rate_limit:${mins}`);
    }
    throw new Error(msg);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const parts = buffer.split("\n\n");
    // Keep the last part as it may be incomplete
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      if (!part.trim()) continue;
      let eventType = "message";
      let eventData = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          eventData = line.slice(6);
        }
      }
      if (eventData) {
        try {
          const parsed = JSON.parse(eventData);
          onEvent({ type: eventType as StreamEvent["type"], data: parsed });
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}

export const api = {
  analyzeDomain: (args: { domain: string }) =>
    apiFetch<AnalysisResult>("/api/analyze", { method: "POST", body: JSON.stringify(args) }),

  getSubdomains: (args: { domain: string }) =>
    apiFetch<SubdomainsResult>("/api/subdomains", { method: "POST", body: JSON.stringify(args) }),

  scanSubdomains: (args: { domain: string }) =>
    apiFetch<SubdomainScanResult>("/api/subdomain-scan", { method: "POST", body: JSON.stringify(args) }),

  getCompanyInfo: (args: { domain: string }) =>
    apiFetch<CompanyInfoResult>("/api/company", { method: "POST", body: JSON.stringify(args) }),

  getNews: (args: { domain: string }) =>
    apiFetch<NewsResult>("/api/news", { method: "POST", body: JSON.stringify(args) }),

  getSocialAccounts: (args: { domain: string }) =>
    apiFetch<SocialResult>("/api/social", { method: "POST", body: JSON.stringify(args) }),

  getReverseIP: (args: { ip: string }) =>
    apiFetch<ReverseIPResult>("/api/reverse-ip", { method: "POST", body: JSON.stringify(args) }),

  checkAvailability: (args: { domain: string }) =>
    apiFetch<AvailabilityResult>("/api/availability", { method: "POST", body: JSON.stringify(args) }),

  getDomainSuggestions: (args: { domain: string }) =>
    apiFetch<DomainSuggestionsResult>("/api/suggestions", { method: "POST", body: JSON.stringify(args) }),

  compareDomains: (args: { domain1: string; domain2: string }) =>
    apiFetch<CompareResult>("/api/compare", { method: "POST", body: JSON.stringify(args) }),
};

// ─── Type definitions (matching server response shapes) ──────────────

// ─── Network Health Types ───────────────────────────────────────────
export interface DnsResolverResultData {
  name: string;
  ips: string[];
  response_time_ms: number;
  status: "ok" | "timeout" | "error";
}

export interface DnsPropagationData {
  resolvers: DnsResolverResultData[];
  consistent: boolean;
  unique_ips: string[];
}
export interface RipeRoutingData {
  asn: number | null;
  asn_name: string | null;
  prefix: string | null;
  visibility: { seen_by: number; total: number; percentage: number } | null;
  bgp_updates_24h: number | null;
  routing_stability: "stable" | "moderate" | "unstable" | null;
}
export interface ConnectionTimingData {
  dns_ms: number;
  tcp_ms: number;
  tls_ms: number;
  total_ms: number;
  ip: string | null;
  tls_version: string | null;
}
export interface OutageLinksData {
  downdetector: { exists: boolean; url: string };
  isitdown: { exists: boolean; url: string };
}
export interface NetworkHealthData {
  dns_propagation: DnsPropagationData | null;
  ripe_routing: RipeRoutingData | null;
  connection_timing: ConnectionTimingData | null;
  outage_links: OutageLinksData | null;
}

export interface AnalysisResult {
  domain: string;
  cached: boolean;
  cached_at?: number;
  analyzed_at: string;
  status: {
    is_up: boolean;
    status_code: number | null;
    response_time_ms: number | null;
    error: string | null;
    status_label?: string;
    http_blocked?: boolean;
  } | null;
  not_registered?: boolean;
  http_probe_blocked?: boolean;
  is_subdomain?: boolean;
  dns: { records: DnsRecord[] } | null;
  rdap: {
    registrar: string | null;
    registration_date: string | null;
    expiration_date: string | null;
    last_changed: string | null;
    nameservers: string[];
    status: string[];
    domain_age_days: number | null;
    days_until_expiry: number | null;
  } | null;
  ssl: {
    grade: string | null;
    issuer: string | null;
    subject: string | null;
    valid_from: string | null;
    valid_to: string | null;
    protocols: string[];
    key_exchange: string | null;
    error: string | null;
    ciphers: Array<{ name: string; id: number; strength: string }> | null;
    ocsp_stapling: boolean | null;
    has_scts: boolean | null;
    sct_count: number | null;
    forward_secrecy: boolean | null;
  } | null;
  headers: { raw: Record<string, string>; security_audit: SecurityCheck[]; security_grade: string } | null;
  tech_stack: TechItem[] | null;
  ip_info: {
    ip: string;
    isp: string | null;
    org: string | null;
    asn: string | null;
    city: string | null;
    country: string | null;
    country_code: string | null;
    lat: number | null;
    lon: number | null;
    reverse_dns: string | null;
    ipv6: string | null;
  } | null;
  blocklists: BlocklistItem[] | null;
  performance: {
    score: number | null;
    fcp: number | null;
    lcp: number | null;
    tbt: number | null;
    cls: number | null;
    si: number | null;
    ttfb: number | null;
    strategy: string;
    error: string | null;
    screenshot: string | null;
  } | null;
  performance_desktop: {
    score: number | null;
    fcp: number | null;
    lcp: number | null;
    tbt: number | null;
    cls: number | null;
    si: number | null;
    ttfb: number | null;
    strategy: string;
    error: string | null;
    screenshot: string | null;
  } | null;
  performance_crux: {
    lcp_p75: number | null;
    fcp_p75: number | null;
    cls_p75: number | null;
    inp_p75: number | null;
    ttfb_p75: number | null;
    rtt_p75: number | null;
    form_factors: { desktop: number; phone: number; tablet: number } | null;
    collection_period: { first_date: string; last_date: string } | null;
    has_data: boolean;
  } | null;
  redirects: RedirectHop[] | null;
  meta: {
    robots_txt: string | null;
    robots_txt_exists: boolean;
    sitemap_detected: boolean;
    sitemap_url: string | null;
    sitemap_page_count: number | null;
    og_title: string | null;
    og_description: string | null;
    og_image: string | null;
    favicon_url: string | null;
  } | null;
  llms_txt: LlmsTxt | null;
  wayback: WaybackData | null;
  tranco_rank: number | null;
  screenshot_url?: string | null; // Deprecated — kept for cached responses
  email_auth: EmailAuth | null;
  http_protocols: HttpProtocols | null;
  carbon: CarbonData | null;
  robots_parsed: RobotsParsed | null;
  json_ld: JsonLdItem[] | null;

  // New v2 fields
  shodan: ShodanData | null;
  dnssec: DnssecData | null;
  hosting: HostingData | null;
  social_meta: SocialMetaData | null;
  legal: LegalData | null;
  cookie_security: CookieSecurityData | null;
  compression: CompressionData | null;
  cache_analysis: CacheAnalysisData | null;
  ai_readiness: AiReadinessData | null;
  wordpress: WordPressData | null;
  breaches: BreachData | null;

  // Tier 1 features
  cert_transparency: CertTransparencyData | null;
  security_txt: SecurityTxtData | null;
  green_hosting: GreenHostingData | null;
  well_known: WellKnownData | null;
  caa_analysis: CaaAnalysisData | null;
  greynoise: GreynoiseData | null;

  // Contextual scoring
  domain_score: DomainScoreData | null;

  // Percentile rankings (optional — present when sufficient seed data exists)
  percentiles?: PercentileData | null;

  // Structured data validation
  structured_data: StructuredDataValidationResult | null;

  // Accessibility
  accessibility: AccessibilityData | null;

  // Third-party scripts
  third_party_scripts: ThirdPartyScriptsData | null;

  // Cookie consent
  cookie_consent: CookieConsentData | null;

  // WAF detection
  waf: WafDetectionData | null;

  // Trust signals
  trust_signals: TrustSignalsData | null;

  // Network health
  network_health: NetworkHealthData | null;

  // Injected metadata (share URL, PDF URL, etc.)
  _meta?: {
    share_url?: string;
    pdf_url?: string;
    degraded?: string[];
  };
}

export interface DnsRecord {
  type: string;
  name: string;
  ttl: number;
  data: string;
}
export interface SecurityCheck {
  header: string;
  status: "pass" | "fail" | "warning";
  value: string | null;
  recommendation: string | null;
}
export interface TechItem {
  category: string;
  name: string;
  version: string | null;
  confidence: string;
}
export interface BlocklistItem {
  name: string;
  zone: string;
  listed: boolean;
  detail: string | null;
}
export interface RedirectHop {
  url: string;
  status_code: number;
  server: string | null;
  response_time_ms: number;
}
export interface LlmsTxt {
  found: boolean;
  content: string | null;
  full_found: boolean;
  full_content: string | null;
}
export interface WaybackData {
  first_snapshot: string | null;
  last_snapshot: string | null;
  total_snapshots: number | null;
  archive_url: string;
}
export interface EmailAuth {
  spf: { found: boolean; record: string | null; mechanisms: string[]; all_qualifier: string | null };
  dmarc: {
    found: boolean;
    record: string | null;
    policy: string | null;
    subdomain_policy: string | null;
    rua: string | null;
    ruf: string | null;
  };
  dkim_selectors_found: string[];
  bimi?: { found: boolean; record: string | null; logo_url: string | null; authority_url: string | null };
  mta_sts?: { dns_found: boolean; policy_found: boolean; mode: string | null };
  tls_rpt?: { found: boolean; record: string | null; rua: string | null };
}
export interface HttpProtocols {
  http2: boolean;
  http3: boolean;
  alt_svc: string | null;
}
export interface CarbonData {
  co2_per_view: number | null;
  cleaner_than: number | null;
  green: boolean;
}
export interface RobotsParsed {
  blocks: Array<{ user_agent: string; disallow: string[]; allow: string[] }>;
  crawl_delay: number | null;
  sitemaps: string[];
  interesting_blocked: string[];
  is_restrictive: boolean;
  is_missing: boolean;
}
export interface JsonLdItem {
  type: string;
  name: string | null;
  description: string | null;
  url: string | null;
}

export interface SubdomainsResult {
  subdomains: string[];
  cached: boolean;
}
export interface CompanyInfoResult {
  company: {
    name: string | null;
    description: string | null;
    founded: string | null;
    ceo: string | null;
    hq: string | null;
    industry: string | null;
    employees: number | null;
    exchange: string | null;
    ticker: string | null;
    logo_url: string | null;
    wikidata_id: string | null;
    revenue: string | null;
    parent_org: string | null;
    social_links: { platform: string; url: string }[];
    source: string;
  } | null;
  stock: {
    price: number | null;
    change: number | null;
    change_percent: number | null;
    market_cap: number | null;
    volume: number | null;
    high_52w: number | null;
    low_52w: number | null;
    currency: string | null;
    sparkline?: number[] | null;
  } | null;
  crunchbase_url: string | null;
  cached: boolean;
}
export interface NewsResult {
  google_news: Array<{ title: string; link: string; source: string | null; pub_date: string | null }>;
  hacker_news: Array<{ title: string; url: string | null; points: number; num_comments: number; created_at: string }>;
  cached: boolean;
}
export interface SocialResult {
  accounts: Array<{ platform: string; url: string; username: string | null; found_via: string }>;
  cached: boolean;
}
export interface ReverseIPResult {
  domains: string[];
  cached: boolean;
}

// ─── New v2 types ────────────────────────────────────────────────────

export interface ShodanData {
  ports: number[];
  cpes: string[];
  vulns: string[];
  tags: string[];
  hostnames: string[];
}
export interface DnssecData {
  enabled: boolean;
  has_dnskey: boolean;
  has_ds: boolean;
  validated: boolean;
}
export interface HostingData {
  provider: string | null;
  cdn: string | null;
  waf: string | null;
}
export interface SocialMetaData {
  og: {
    title: string | null;
    description: string | null;
    image: string | null;
    type: string | null;
    url: string | null;
    site_name: string | null;
    locale: string | null;
  };
  twitter: {
    card: string | null;
    site: string | null;
    creator: string | null;
    title: string | null;
    description: string | null;
    image: string | null;
  };
  score: number;
  missing: string[];
}
export interface LegalData {
  pages_found: Array<{ name: string; url: string }>;
  cookie_consent_detected: boolean;
  consent_provider: string | null;
}
export interface CookieSecurityData {
  cookies: Array<{ name: string; secure: boolean; httponly: boolean; samesite: string | null }>;
  issues: string[];
}
export interface CompressionData {
  encoding: string | null;
  vary_accept_encoding: boolean;
}
export interface CacheAnalysisData {
  cache_control: {
    raw: string | null;
    directives: Record<string, string | true>;
    effective_ttl_seconds: number | null;
    ttl_human: string | null;
  };
  cdn_cache: { status: string | null; provider: string | null; age_seconds: number | null };
  conditional: { etag: boolean; last_modified: boolean; varies_on: string[] };
  verdict: "excellent" | "good" | "fair" | "poor" | "none";
  verdict_label: string;
  issues: string[];
}
export interface AiReadinessData {
  score: number;
  max_score: number;
  grade: string;
  checks: Array<{ name: string; passed: boolean; points: number }>;
  rss_feed: string | null;
  ans: {
    ans_found: boolean;
    ans_records: string[];
    agents_found: boolean;
    agents_records: string[];
    agent_json_found: boolean;
  } | null;
}

export interface WordPressPlugin {
  slug: string;
  name: string;
  category: string | null;
}
export interface WordPressData {
  detected: true;
  version: string | null;
  theme: { name: string; slug: string } | null;
  parent_theme: { name: string; slug: string } | null;
  plugins: WordPressPlugin[];
  page_builder: string | null;
  caching_plugin: string | null;
  seo_plugin: string | null;
  security_plugin: string | null;
  ecommerce: string | null;
  managed_hosting: string | null;
  api_exposed: boolean;
  block_editor: boolean;
  multisite: boolean;
}

export interface BreachItem {
  name: string;
  title: string;
  domain: string;
  breach_date: string;
  added_date: string;
  pwn_count: number;
  data_classes: string[];
  description: string;
  logo_url: string;
  is_verified: boolean;
  is_fabricated: boolean;
  is_sensitive: boolean;
  is_spam_list: boolean;
  is_malware: boolean;
}
export interface BreachData {
  found: boolean;
  count: number;
  total_pwned: number;
  items: BreachItem[];
  check_failed?: boolean;
}

export interface AvailabilityResult {
  results: Array<{
    node: string;
    location: { country_code: string; country: string; city: string; ip: string; asn: string };
    status: "up" | "down" | "pending" | "error";
    type?: "http" | "dns";
    status_code: number | null;
    response_time_ms: number | null;
    ip: string | null;
    message: string | null;
  }>;
  request_id: string | null;
  permanent_link: string | null;
  source?: "check-host" | "edge";
  edge_colo?: string | null;
}

export interface DomainSuggestion {
  domain: string;
  available: boolean | null;
  registrable: boolean | null;
  pricing: { registration: string; renewal: string; currency: string } | null;
  source: "cf_search" | "cf_check" | "dns" | "rdap" | "generated";
}

export interface DomainSuggestionsResult {
  suggestions: DomainSuggestion[];
}

// ─── Tier 1 feature types ────────────────────────────────────────────

export interface CertTransparencyData {
  subdomains: string[];
  total_certs: number;
  has_wildcard: boolean;
  issuers: string[];
  certs?: Array<{ issuer: string; not_before: string; not_after: string; dns_names: string[] }>;
  error: string | null;
}

export interface SecurityTxtData {
  found: boolean;
  contact: string[];
  encryption: string | null;
  acknowledgments: string | null;
  policy: string | null;
  hiring: string | null;
  canonical: string | null;
  preferred_languages: string | null;
  expires: string | null;
  is_expired: boolean;
  has_bug_bounty: boolean;
  bug_bounty_platform: string | null;
  raw: string | null;
}

export interface GreenHostingData {
  green: boolean;
  hosted_by: string | null;
  hosted_by_website: string | null;
  error: string | null;
}

export interface WellKnownEndpointData {
  path: string;
  name: string;
  found: boolean;
  data: Record<string, unknown> | null;
}

export interface WellKnownData {
  endpoints: WellKnownEndpointData[];
  pwa_ready: boolean;
  has_mobile_apps: boolean;
  ads_partner_count: number | null;
}

export interface CaaRecord {
  flags: number;
  tag: string;
  value: string;
  ca_name: string;
}

export interface CaaAnalysisData {
  records: CaaRecord[];
  has_wildcard_policy: boolean;
  iodef: string | null;
  has_caa: boolean;
}

export interface GreynoiseData {
  ip: string;
  classification: string | null;
  name: string | null;
  link: string | null;
  noise: boolean;
  riot: boolean;
  error: string | null;
}

// ─── Contextual Domain Score types ───────────────────────────────────

export type Axis = "security" | "speed" | "foundations" | "reputation" | "discoverability" | "email";
export type Severity = "critical" | "high" | "medium" | "low" | "info" | "good";
export type ArchetypeName =
  | "commerce"
  | "content"
  | "application"
  | "corporate"
  | "infrastructure"
  | "institutional"
  | "general";

export interface ScoreFinding {
  signal: string;
  axis: Axis;
  severity: Severity;
  label: string;
  tradeoff: string | null;
  weight: number;
  source?: string | null;
}

export interface AbsentSignalDetailData {
  signal: string;
  label: string;
  weight: number;
  /** Per-signal deduction (IDF-weighted) */
  deduction?: number;
  fixDescription?: string;
  absentLabel?: string;
  effort?: string;
  actionable: boolean;
}

export interface AxisDeductionData {
  signal: string;
  label: string;
  severity: string;
  weight: number;
  share: number;
  deduction: number;
  category: "fixable" | "time_dependent" | "infrastructure" | "not_detected";
  /** For _absent deductions: the individual signals that were not detected */
  absentSignals?: AbsentSignalDetailData[];
}

export interface AxisScoreData {
  score: number | null;
  weight: number;
  findings: ScoreFinding[];
  /** Itemized deductions explaining the gap from 100 */
  deductions?: AxisDeductionData[];
  not_measured?: boolean;
}

export interface ArchetypeData {
  detected: ArchetypeName;
  confidence: number;
  secondary: ArchetypeName | null;
  signals: string[];
  platform: string | null;
  weights?: Record<Axis, number>;
}

export interface AtRiskAxisData {
  axis: Axis;
  score: number;
  tier: string;
}

export interface DomainScoreData {
  composite: number;
  tier: string;
  /** Cross-axis consistency: balanced (σ<8), uneven (σ 8-15), lopsided (σ>15). */
  balance?: "balanced" | "uneven" | "lopsided";
  /** Raw standard deviation of axis scores (rounded to 1 decimal). */
  balanceStdDev?: number;
  /** Axis whose tier is ≥2 tiers below the composite tier (lowest if multiple). */
  atRiskAxis?: AtRiskAxisData | null;
  /** Human-readable composite summary, e.g. "Strong 88, Balanced" or "Strong 88 — Security at risk (55)". */
  compositeLabel?: string;
  axes: Record<Axis, AxisScoreData>;
  archetype: ArchetypeData;
  /** Detected context flags for context-aware normalization */
  scoringContext?: { cookies?: boolean; wordpress?: boolean; httpBlocked?: boolean };
}

// ─── Percentile types ────────────────────────────────────────────────

export interface PercentileData {
  composite: number;
  axes: {
    security: number | null;
    speed: number | null;
    foundations: number | null;
    reputation: number | null;
    discoverability: number | null;
    email: number | null;
  };
  sample_size: number;
  computed_at: string;
}

// ─── Subdomain scan types ────────────────────────────────────────────

export interface ResolvedSubdomain {
  prefix: string;
  hostname: string;
  category: string;
  ips: string[];
  sameAsApex: boolean;
}

export interface SubdomainScanResult {
  domain: string;
  total_found: number;
  total_scanned: number;
  categories: Record<string, ResolvedSubdomain[]>;
  apex_ips: string[];
  cached: boolean;
}

// ─── Structured Data Validation types ────────────────────────────────

export interface FieldValidation {
  field: string;
  status: "present" | "missing" | "recommended";
  value?: string;
}

export interface SchemaValidationItem {
  type: string;
  name: string | null;
  status: "complete" | "partial" | "missing_required";
  required_fields: FieldValidation[];
  recommended_fields: FieldValidation[];
  extra_fields: string[];
}

export interface StructuredDataValidationResult {
  types_found: string[];
  total_items: number;
  validations: SchemaValidationItem[];
  has_issues: boolean;
}

// ─── Compare types ───────────────────────────────────────────────────

export interface AxisDelta {
  axis: Axis;
  score1: number | null;
  score2: number | null;
  delta: number;
  absDelta: number;
}

export interface CompareResult {
  domain1: AnalysisResult;
  domain2: AnalysisResult;
  comparison: {
    composite: {
      score1: number | null;
      score2: number | null;
      tier1: string | null;
      tier2: string | null;
      delta: number;
    };
    archetype1: ArchetypeName | null;
    archetype2: ArchetypeName | null;
    axes: AxisDelta[];
    biggest_differences: AxisDelta[];
  };
}

// ─── Accessibility types ──────────────────────────────────────────────

export interface AccessibilityCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  impact: "critical" | "serious" | "moderate" | "minor";
}

export interface AccessibilityData {
  score: number;
  checks: AccessibilityCheck[];
  summary: { passed: number; warnings: number; failures: number };
}

// ─── Third-Party Scripts types ────────────────────────────────────────

export interface ScriptInfoData {
  url: string;
  domain: string;
  async: boolean;
  defer: boolean;
}

export interface ScriptCategoryData {
  scripts: ScriptInfoData[];
  count: number;
}

export interface ThirdPartyScriptsData {
  total: number;
  first_party: number;
  third_party: number;
  categories: Record<string, ScriptCategoryData>;
  privacy_concerns: string[];
  render_blocking: number;
}

// ─── Cookie Consent types ─────────────────────────────────────────────

export interface CmpDetectionData {
  name: string;
  confidence: number;
}

export interface CookieInfoData {
  name: string;
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  expires: string | null;
  category: "session" | "persistent" | "third-party";
}

export interface CookieConsentData {
  cmp_detected: CmpDetectionData | null;
  cookies_set: CookieInfoData[];
  pre_consent_cookies: number;
  has_cookie_policy: boolean;
  compliance_flags: string[];
  p3p_present: boolean;
}

// ─── WAF Detection types ──────────────────────────────────────────────

export interface WafDetectionData {
  detected: boolean;
  provider: string | null;
  confidence: "high" | "medium" | "low";
  signals: string[];
}

// ─── Trust Signal types ───────────────────────────────────────────────

export interface TrustSignalData {
  name: string;
  category: "security" | "identity" | "reputation" | "transparency" | "operational";
  present: boolean;
  value: string | null;
  severity: "good" | "info" | "low" | "medium";
  importance?: "core" | "extra";
}

export interface TrustSignalsData {
  signals: TrustSignalData[];
  trust_score_factors: {
    positive: string[];
    negative: string[];
    neutral: string[];
  };
}
