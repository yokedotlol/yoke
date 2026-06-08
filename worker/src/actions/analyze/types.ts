// ─── Shared Type Definitions ─────────────────────────────────────────

export interface DnsRecord {
  type: string;
  name: string;
  ttl: number;
  data: string;
}

export interface RdapResult {
  registrar: string | null;
  registration_date: string | null;
  expiration_date: string | null;
  last_changed: string | null;
  nameservers: string[];
  status: string[];
  domain_age_days: number | null;
  days_until_expiry: number | null;
}

export interface RedirectHop {
  url: string;
  status_code: number;
  server: string | null;
  response_time_ms: number;
}
export interface SecurityHeaderCheck {
  header: string;
  status: "pass" | "fail" | "warning";
  value: string | null;
  recommendation: string | null;
}
export interface HeadersResult {
  raw: Record<string, string>;
  security_audit: SecurityHeaderCheck[];
  security_grade: string;
}
export interface TechItem {
  category: string;
  name: string;
  version: string | null;
  confidence: string;
}

export interface MetaResult {
  robots_txt: string | null;
  robots_txt_exists: boolean;
  sitemap_detected: boolean;
  sitemap_url: string | null;
  sitemap_page_count: number | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  favicon_url: string | null;
}

export interface HttpAnalysis {
  redirects: RedirectHop[];
  headers: HeadersResult;
  tech_stack: TechItem[];
  meta: MetaResult;
  final_url: string;
  html: string;
  status_code: number;
  response_time_ms: number;
}

export interface IpInfo {
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
}

export interface BlocklistResult {
  name: string;
  zone: string;
  listed: boolean;
  detail: string | null;
}
export interface SslCipher {
  name: string;
  id: number;
  strength: string; // "strong" | "acceptable" | "weak" | "insecure"
}
export interface SslResult {
  grade: string | null;
  issuer: string | null;
  subject: string | null;
  valid_from: string | null;
  valid_to: string | null;
  protocols: string[];
  key_exchange: string | null;
  error: string | null;
  // SSL expansion fields
  ciphers: SslCipher[] | null;
  ocsp_stapling: boolean | null;
  has_scts: boolean | null;
  sct_count: number | null;
  forward_secrecy: boolean | null;
}
export interface PerformanceResult {
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
}

export interface CruxResult {
  lcp_p75: number | null; // ms
  fcp_p75: number | null; // ms
  cls_p75: number | null; // unitless
  inp_p75: number | null; // ms
  ttfb_p75: number | null; // ms
  rtt_p75: number | null; // ms
  form_factors: { desktop: number; phone: number; tablet: number } | null;
  collection_period: { first_date: string; last_date: string } | null;
  has_data: boolean;
}
export interface LlmsTxtResult {
  found: boolean;
  content: string | null;
  full_found: boolean;
  full_content: string | null;
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
  raw: Record<string, unknown>;
}

export interface ShodanResult {
  ports: number[];
  cpes: string[];
  vulns: string[];
  tags: string[];
  hostnames: string[];
}
export interface DnssecResult {
  enabled: boolean;
  has_dnskey: boolean;
  has_ds: boolean;
  validated: boolean;
}
export interface HostingResult {
  provider: string | null;
  cdn: string | null;
  waf: string | null;
}

export interface OgTwitterResult {
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

export interface LegalResult {
  pages_found: Array<{ name: string; url: string; source?: "html" | "head-probe" | "sitemap" | "spa-inferred" }>;
  cookie_consent_detected: boolean;
  consent_provider: string | null;
}
export interface CookieAudit {
  name: string;
  secure: boolean;
  httponly: boolean;
  samesite: string | null;
}
export interface CookieSecurityResult {
  cookies: CookieAudit[];
  issues: string[];
}
export interface CompressionResult {
  encoding: string | null;
  vary_accept_encoding: boolean;
}
export interface AiReadinessResult {
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
export interface BimiResult {
  found: boolean;
  record: string | null;
  logo_url: string | null;
  authority_url: string | null;
}
export interface MtaStsResult {
  dns_found: boolean;
  policy_found: boolean;
  mode: string | null;
}
export interface TlsRptResult {
  found: boolean;
  record: string | null;
  rua: string | null;
}

// ─── Tier 1 Feature Types ─────────────────────────────────────────────
export interface CertIssuance {
  issuer: string;
  not_before: string; // ISO date
  not_after: string; // ISO date
  dns_names: string[];
}

export interface CertTransparencyResult {
  subdomains: string[];
  total_certs: number;
  has_wildcard: boolean;
  issuers: string[];
  certs: CertIssuance[]; // per-cert detail for CT-CAA cross-reference
  error: string | null;
}

export interface SecurityTxtResult {
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

export interface GreenHostingResult {
  green: boolean;
  hosted_by: string | null;
  hosted_by_website: string | null;
  error: string | null;
}

export interface WellKnownEndpoint {
  path: string;
  name: string;
  found: boolean;
  data: Record<string, unknown> | null;
}

export interface WellKnownResult {
  endpoints: WellKnownEndpoint[];
  pwa_ready: boolean;
  has_mobile_apps: boolean;
  ads_partner_count: number | null;
}

export interface CaaDisplayResult {
  records: Array<{ flags: number; tag: string; value: string; ca_name: string }>;
  has_wildcard_policy: boolean;
  iodef: string | null;
  has_caa: boolean;
}

export interface GreynoiseResult {
  ip: string;
  classification: string | null;
  name: string | null;
  link: string | null;
  noise: boolean;
  riot: boolean;
  error: string | null;
}

export interface EmailAuthResult {
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
  bimi: BimiResult;
  mta_sts: MtaStsResult;
  tls_rpt: TlsRptResult;
}

// ─── Accessibility types ──────────────────────────────────────────────
export type { AccessibilityCheck, AccessibilityResult } from "./accessibility";
export type { AssetCdnProvider, AssetCdnResult } from "./asset-cdn";
// ─── Cache Analysis types ─────────────────────────────────────────────
export type { CacheAnalysis } from "./cache";
// ─── Cookie Consent types ─────────────────────────────────────────────
export type { CmpDetection, CookieConsentResult, CookieInfo } from "./cookie-consent";
export type {
  ConnectionTiming,
  DnsPropagation,
  DnsResolverResult,
  NetworkHealth,
  OutageLinks,
  RipeRouting,
} from "./network-health";
// ─── Third-Party Scripts types ────────────────────────────────────────
export type { ScriptCategory, ScriptInfo, ThirdPartyScriptsResult } from "./third-party-scripts";

// ─── Trust Signal types ───────────────────────────────────────────────
export type { TrustSignal, TrustSignals } from "./trust";
// ─── WAF Detection types ──────────────────────────────────────────────
export type { WafDetection } from "./waf";
