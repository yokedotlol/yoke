// ─── Signal Registry ─────────────────────────────────────────────────
// Single source of truth for all scoring signals.
// Every signal declares its axis, actionability, effort, fix description,
// and weight range. Derived constants (NON_ACTIONABLE, EFFORT_MAP, etc.)
// are exported for use across server and client layers.
//
// When adding a new signal:
//   1. Add it here
//   2. Add it to contextual-scoring.ts findings.push()
//   3. Run `npx vitest run` — the registry enforcement test will catch gaps

import type { ArchetypeName, Axis, Severity } from "./contextual-scoring-types";

// ─── Tier Thresholds (single source of truth) ───────────────────────

export const TIER_THRESHOLDS = [
  { tier: "Excellent", min: 90 },
  { tier: "Strong", min: 78 },
  { tier: "Moderate", min: 60 },
  { tier: "Weak", min: 40 },
  { tier: "Critical", min: 0 },
] as const;

// ─── Severity → Score mapping ───────────────────────────────────────

export const SEVERITY_SCORES: Record<Severity, number> = {
  critical: 0,
  high: 15,
  medium: 40,
  low: 65,
  info: 82,
  good: 100,
};

// ─── Axis Weights ───────────────────────────────────────────────────

export const AXIS_WEIGHTS: Record<Axis, number> = {
  security: 0.24,
  speed: 0.18,
  foundations: 0.18,
  reputation: 0.15,
  discoverability: 0.13,
  email: 0.12,
};

// ─── Signal Definition ──────────────────────────────────────────────

export interface SignalDef {
  /** Which of the 6 axes this signal belongs to */
  axis: Axis;
  /** Human-readable label for the signal */
  label: string;
  /** Is this signal actionable by a site operator? */
  actionable: boolean;
  /** Can this signal ever be non-good? If false, it's always "good" or absent */
  canBeNonGood: boolean;
  /** Can this signal produce a "good" finding? Used for per-axis score ceiling computation */
  canBeGood: boolean;
  /** Level-Up effort estimate (when actionable and canBeNonGood) */
  effort?: string;
  /** Level-Up fix description (when actionable and canBeNonGood) */
  fixDescription?: string;
  /** Weight range [min, max] used in scoring */
  weightRange: [number, number];
  /** AI prompt calibration guidance for this signal */
  promptGuidance?: string;
  /** Archetype-specific notes that override or supplement promptGuidance */
  archetypeNotes?: Partial<Record<ArchetypeName, string>>;
  /**
   * Context required for this signal to be applicable.
   * When set, the signal is excluded from normalization (AXIS_MAX_GOOD_WEIGHT)
   * and Level-Up opportunities unless the scan detects the matching context.
   * Values: "cookies" (site sets cookies), "wordpress" (site runs WordPress).
   */
  requiresContext?: "cookies" | "wordpress";
  /**
   * When this signal fires (any non-good severity), the named signal is
   * suppressed from the absent-signal pool. Prevents double-dipping where
   * a bad-variant finding AND an absent good-variant both penalize.
   * E.g. referrer_policy_unsafe fires → referrer_policy excluded from absent.
   */
  suppressesAbsent?: string;
  /**
   * When true, this signal requires HTTP/HTML access to detect.
   * If the scan's HTTP probe was blocked (http_blocked), these signals
   * are excluded from the absent-signal pool instead of penalizing the
   * site for our scanner's limitation.
   */
  requiresHttpAccess?: boolean;
  /**
   * Observed prevalence of this signal firing as "good" across the domain corpus.
   * Range 0–1. Used by the IDF-influenced absent penalty:
   *   absent_penalty = ABSENT_DEDUCTION_FACTOR × (1 + goodPrevalence)
   * Missing common signals cost more than missing rare ones.
   * Source: scoring analysis of 3,329 domains (2026-06-02).
   */
  goodPrevalence?: number;
}

// ─── Signal Registry ────────────────────────────────────────────────

export const SIGNAL_REGISTRY: Record<string, SignalDef> = {
  // ── Security ──────────────────────────────────────────────────────

  ssl_grade: {
    axis: "security",
    label: "SSL/TLS Grade",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — server/CDN config",
    fixDescription: "Upgrade TLS configuration",
    weightRange: [3, 3],
    goodPrevalence: 0.962,
    promptGuidance:
      "A+ = properly configured; A = standard modern; B = legacy/misconfigured TLS; C or below = actively concerning. Most CDN-fronted sites get A or A+.",
    archetypeNotes: {
      commerce: "For e-commerce, anything below A is a trust concern — customers see the padlock.",
      institutional: "Government/education sites should target A+ as a compliance signal.",
    },
  },
  ssl_missing: {
    axis: "security",
    label: "No SSL Certificate",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — certificate setup",
    fixDescription: "Install SSL/TLS certificate",
    weightRange: [3, 3],
    promptGuidance:
      "No SSL is critical. Browsers show 'Not Secure' warnings. Let's Encrypt provides free certificates.",
    archetypeNotes: {
      commerce: "No SSL on e-commerce means payment data transmitted in plaintext — PCI-DSS violation.",
    },
  },
  ssl_weak_ciphers: {
    axis: "security",
    label: "Weak Cipher Suites Offered",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — server cipher configuration",
    fixDescription: "Disable weak/insecure cipher suites",
    weightRange: [2, 2],
    promptGuidance:
      "Weak or insecure cipher suites (3DES, RC4, CBC without ECDHE) allow potential downgrade attacks. Disable them in server TLS config.",
  },
  ssl_ocsp_stapling: {
    axis: "security",
    label: "OCSP Stapling",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~10 min — server configuration",
    fixDescription: "Enable OCSP stapling",
    weightRange: [1, 2],
    goodPrevalence: 0.347,
    promptGuidance:
      "OCSP stapling improves TLS handshake speed and privacy by including certificate revocation status in the handshake. Most modern servers support it.",
  },
  ssl_forward_secrecy: {
    axis: "security",
    label: "Forward Secrecy",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~15 min — cipher suite configuration",
    fixDescription: "Enable forward secrecy (ECDHE key exchange)",
    weightRange: [2, 2],
    goodPrevalence: 0.977,
    promptGuidance:
      "Forward secrecy (via ECDHE) ensures that compromising a server's private key doesn't decrypt past sessions. TLS 1.3 provides this by default.",
  },
  ssl_certificate_transparency: {
    axis: "security",
    label: "Certificate Transparency SCTs",
    fixDescription: "Detected automatically — Certificate Transparency SCTs enable public audit of issued certificates",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 0.046,
    promptGuidance:
      "Certificate Transparency (CT) logs provide public auditability of issued certificates. SCTs prove the certificate was logged. Most modern CAs include them automatically.",
  },
  hsts: {
    axis: "security",
    label: "HSTS Enabled",
    fixDescription: "Detected automatically — HSTS forces browsers to use HTTPS, preventing downgrade attacks",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [4, 4],
    goodPrevalence: 1.0,
    promptGuidance:
      "HSTS prevents protocol downgrade attacks. Presence is a positive signal — weight 4, the highest security weight.",
    requiresHttpAccess: true,
  },
  hsts_missing: {
    axis: "security",
    label: "HSTS Not Configured",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — add one response header",
    fixDescription: "Add Strict-Transport-Security header",
    weightRange: [4, 4],
    promptGuidance:
      "Missing HSTS allows protocol downgrade attacks (SSL stripping). High-impact single header to add. Weight 4.",
    archetypeNotes: {
      commerce: "Critical for payment flows — downgrade attacks can intercept credentials.",
      content: "Low-effort to add but verify no mixed content first.",
      application: "Interactive apps should prioritize HSTS to protect auth flows.",
    },
  },
  hsts_max_age: {
    axis: "security",
    label: "HSTS Max-Age Too Short",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~5 min — update header value",
    fixDescription: "Increase HSTS max-age to at least 1 year",
    weightRange: [1, 2],
    goodPrevalence: 0.747,
    promptGuidance:
      "Recommended max-age ≥31536000 (1 year). Short max-age (<86400) undermines protection. Let's Encrypt 90-day rotation means long max-age requires reliable auto-renewal.",
    requiresHttpAccess: true,
  },
  hsts_preload: {
    axis: "security",
    label: "HSTS Preload",
    fixDescription: "Submit your domain to the HSTS preload list at hstspreload.org",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 1.0,
    promptGuidance:
      "HSTS preload means domain is in browsers' built-in HSTS list. Requires max-age ≥1 year + includeSubDomains. Bonus-only signal.",
    requiresHttpAccess: true,
  },
  csp: {
    axis: "security",
    label: "Content Security Policy Present",
    fixDescription: "Detected automatically — Content Security Policy restricts resource loading to prevent XSS",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [3, 3],
    goodPrevalence: 1.0,
    promptGuidance:
      "CSP presence is a positive security signal. Quality matters more than presence — check csp_quality for details.",
    requiresHttpAccess: true,
  },
  csp_missing: {
    axis: "security",
    label: "No Content Security Policy",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1-2 hours — requires auditing scripts/styles",
    fixDescription: "Add Content-Security-Policy header",
    weightRange: [3, 3],
    promptGuidance:
      "Many sites lack CSP, but absence is a real XSS risk for sites handling user input. Hard to retrofit — recommend starting with report-only mode. Don't cite specific adoption percentages.",
    archetypeNotes: {
      application:
        "SPAs are highest-risk for XSS — CSP most important here. May need 'unsafe-inline' for style-src (styled-components).",
      content: "Content sites with user comments need CSP. Static blogs have lower risk.",
      corporate: "Corporate marketing sites have low XSS risk if no user input.",
    },
  },
  csp_quality: {
    axis: "security",
    label: "CSP Quality",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~1 hour — tighten CSP directives",
    fixDescription: "Improve Content-Security-Policy directives",
    weightRange: [2, 3],
    goodPrevalence: 0.063,
    promptGuidance:
      "Grade practical protection, not just presence. 'unsafe-inline' in script-src undermines XSS protection; 'unsafe-eval' enables code injection; wildcard (*) negates the policy. 'unsafe-inline' in style-src is common and acceptable.",
    archetypeNotes: {
      application:
        "SPAs using React/Vue styled-components may need 'unsafe-inline' in style-src — don't flag this. Focus on script-src.",
    },
    requiresHttpAccess: true,
  },
  csp_missing_base_uri: {
    axis: "security",
    label: "CSP Missing base-uri",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add CSP directive",
    fixDescription: "Add base-uri directive to CSP",
    weightRange: [1, 1],
    promptGuidance: "Missing base-uri allows <base> tag injection for relative URL hijacking. Low weight, easy to add.",
  },
  csp_missing_object_src: {
    axis: "security",
    label: "CSP Missing object-src",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add CSP directive",
    fixDescription: "Add object-src directive to CSP",
    weightRange: [1, 1],
    promptGuidance:
      "Missing object-src allows plugin exploits unless default-src is restrictive. Add object-src 'none'.",
  },
  csp_report_only: {
    axis: "security",
    label: "CSP Report-Only",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [1, 1],
    promptGuidance: "CSP report-only is a good first step. Acknowledge progress, recommend transitioning to enforcing.",
  },
  xfo: {
    axis: "security",
    label: "X-Frame-Options",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~5 min — add one response header",
    fixDescription: "Add X-Frame-Options header",
    weightRange: [2, 2],
    goodPrevalence: 0.533,
    promptGuidance:
      "X-Frame-Options or CSP frame-ancestors prevents clickjacking. CSP frame-ancestors supersedes XFO — don't recommend both.",
    archetypeNotes: {
      commerce: "Payment pages must have clickjacking protection.",
      application: "Some apps need iframe embedding (widgets, payments) — DENY would break this.",
    },
    requiresHttpAccess: true,
  },
  xcto: {
    axis: "security",
    label: "X-Content-Type-Options",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~5 min — one-line header",
    fixDescription: "Add X-Content-Type-Options: nosniff",
    weightRange: [1, 1],
    goodPrevalence: 0.501,
    promptGuidance: "X-Content-Type-Options: nosniff prevents MIME type sniffing. Low weight (1), easy one-line fix.",
    requiresHttpAccess: true,
  },
  dnssec: {
    axis: "security",
    label: "DNSSEC",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — registrar setting",
    fixDescription: "Enable DNSSEC at your registrar",
    weightRange: [1, 1],
    goodPrevalence: 0.133,
    promptGuidance:
      "~30% global adoption. Absence isn't alarming for most sites. Asymmetric: presence rewarded (weight 2), absence barely penalized (weight 1).",
    archetypeNotes: {
      institutional: "Financial/government/healthcare sites should have DNSSEC.",
      infrastructure: "API/infrastructure domains benefit from DNS-level authenticity.",
    },
  },
  blocklist_listed: {
    axis: "reputation",
    label: "Blocklist Listed",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [3, 3],
    promptGuidance:
      "CDN IPs are shared — blocklist hits reflect neighbors, not this domain. Non-CDN hits are more serious. Severity: 1=medium, 2=high, 3+=critical.",
  },
  email_auth: {
    axis: "email",
    label: "Email Authentication",
    fixDescription: "Detected automatically — combined SPF + DKIM + DMARC alignment for email authentication",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [3, 3],
    goodPrevalence: 0.467,
    promptGuidance:
      "SPF+DKIM+DMARC with p=reject = gold standard. p=none = monitoring only. DKIM detection probes common selectors — absence doesn't necessarily mean unconfigured.",
  },
  email_auth_incomplete: {
    axis: "email",
    label: "Incomplete Email Authentication",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — DNS records + email provider config",
    fixDescription: "Complete email authentication setup (SPF+DKIM+DMARC)",
    weightRange: [3, 3],
    promptGuidance:
      "Incomplete email auth leaves domain vulnerable to spoofing. SPF/DMARC are deterministic; DKIM uses arbitrary selectors.",
    archetypeNotes: { infrastructure: "API domains that don't send email may not need full email auth." },
  },
  spf_without_dmarc: {
    axis: "email",
    label: "SPF Without DMARC",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — one DNS TXT record",
    fixDescription: "Add DMARC DNS record",
    weightRange: [2, 2],
    promptGuidance:
      "SPF without DMARC = no enforcement policy. Recommend adding DMARC starting with p=none to monitor.",
  },
  waf_detected: {
    axis: "security",
    label: "WAF Detected",
    fixDescription: "Detected automatically — Web Application Firewall protects against common web attacks",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 2],
    goodPrevalence: 1.0,
    promptGuidance: "WAF presence is defense-in-depth. High-confidence detection is more meaningful.",
    requiresHttpAccess: true,
  },
  caa_records: {
    axis: "security",
    label: "CAA Records Present",
    fixDescription:
      "Detected automatically — CAA DNS records restrict which Certificate Authorities can issue certificates",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 1.0,
    promptGuidance: "CAA restricts which CAs can issue certs. Presence is positive.",
  },
  caa_wildcard_unrestricted: {
    axis: "security",
    label: "CAA Wildcard Unrestricted",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — add wildcard CAA record",
    fixDescription: "Add wildcard CAA DNS record",
    weightRange: [0, 0], // weight 0 = informational, no score impact
    promptGuidance:
      "If CAA issue is set but issuewild is not, any CA can issue wildcard certs. Informational only (weight 0).",
  },
  caa_iodef: {
    axis: "security",
    label: "CAA iodef Reporting",
    fixDescription: "Add a CAA iodef DNS record to receive email alerts about unauthorized certificate requests",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 1.0,
    promptGuidance: "CAA iodef enables violation reporting — proactive certificate management.",
  },
  cert_wildcard: {
    axis: "security",
    label: "Wildcard Certificate",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — replace with per-domain certs",
    fixDescription: "Replace wildcard certificate with per-domain certificates",
    weightRange: [1, 1],
    promptGuidance:
      "Wildcards simplify management but increase blast radius if key is compromised. Informational for most sites.",
    archetypeNotes: { institutional: "Government/financial sites should prefer per-domain certificates." },
  },
  open_ports: {
    axis: "security",
    label: "Open Ports",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — firewall rules",
    fixDescription: "Close unnecessary open ports",
    weightRange: [3, 3],
    promptGuidance:
      "80/443 expected. 22 (SSH) common but ideally firewalled. Database ports (3306, 5432, 6379, 27017) exposed = high severity. 8080/8443 suggest dev/proxy.",
  },
  known_vulnerabilities: {
    axis: "security",
    label: "Known Vulnerabilities",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1-2 hours — patch/update affected software",
    fixDescription: "Patch known vulnerabilities",
    weightRange: [5, 5],
    promptGuidance:
      "CVE detection is version-based, doesn't confirm exploitability. The site may not use the vulnerable function. Note this caveat.",
  },
  cookie_security: {
    axis: "security",
    label: "Cookie Security",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — update cookie settings",
    fixDescription: "Set Secure/HttpOnly/SameSite on cookies",
    weightRange: [3, 3],
    goodPrevalence: 0.464,
    requiresContext: "cookies",
    promptGuidance:
      "Secure flag required for HTTPS. HttpOnly prevents XSS cookie theft. SameSite prevents CSRF. All three on session cookies.",
    requiresHttpAccess: true,
  },
  server_version_disclosure: {
    axis: "security",
    label: "Server Version Disclosure",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — strip version from headers",
    fixDescription: "Remove server version from response headers",
    weightRange: [1, 1],
    promptGuidance:
      "Version info helps attackers target known vulns. Behind CDN/reverse proxy, the header may be from CDN, not origin — lower concern.",
  },
  referrer_policy: {
    axis: "security",
    label: "Referrer-Policy Configured",
    fixDescription: "Detected automatically — a safe Referrer-Policy limits information leaked in HTTP headers",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [1, 2],
    goodPrevalence: 0.968,
    promptGuidance:
      "Best: strict-origin-when-cross-origin or no-referrer. Missing = browsers default to strict-origin-when-cross-origin (safe).",
    requiresHttpAccess: true,
  },
  referrer_policy_missing: {
    axis: "security",
    label: "No Referrer-Policy Header",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add response header",
    fixDescription: "Add Referrer-Policy header",
    weightRange: [2, 2],
    suppressesAbsent: "referrer_policy",
    promptGuidance:
      "Modern browsers default to strict-origin-when-cross-origin. Missing is safe but explicit is better. Low severity.",
    requiresHttpAccess: true,
  },
  referrer_policy_unsafe: {
    axis: "security",
    label: "Unsafe Referrer-Policy",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — update response header",
    fixDescription: "Change Referrer-Policy to strict-origin-when-cross-origin or no-referrer",
    weightRange: [2, 2],
    suppressesAbsent: "referrer_policy",
    promptGuidance:
      "unsafe-url leaks full URLs to all origins. no-referrer-when-downgrade leaks on HTTP downgrades. Replace with strict-origin-when-cross-origin.",
    requiresHttpAccess: true,
  },
  permissions_policy: {
    axis: "security",
    label: "Permissions-Policy Configured",
    fixDescription: "Detected automatically — Permissions-Policy restricts browser features like camera and microphone",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 2],
    goodPrevalence: 1.0,
    promptGuidance:
      "Restrictive policies (camera=(), microphone=()) show defense-in-depth. Overly permissive (feature=*) is medium concern.",
    requiresHttpAccess: true,
  },
  permissions_policy_missing: {
    axis: "security",
    label: "No Permissions-Policy Header",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — add response header",
    fixDescription: "Add Permissions-Policy header",
    weightRange: [2, 2],
    suppressesAbsent: "permissions_policy",
    promptGuidance: "Absence is a minor gap. Permissions-Policy is defense-in-depth, not critical.",
    requiresHttpAccess: true,
  },
  permissions_policy_unrestricted: {
    axis: "security",
    label: "Permissions-Policy Too Permissive",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — restrict policy directives",
    fixDescription: "Restrict Permissions-Policy directives",
    weightRange: [2, 2],
    suppressesAbsent: "permissions_policy",
    promptGuidance: "Wildcard grants (feature=*) for sensitive features like camera/microphone are a medium concern.",
    requiresHttpAccess: true,
  },
  http_to_https_redirect: {
    axis: "security",
    label: "HTTP→HTTPS Redirect",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "HTTP→HTTPS redirect detected. With TLS + HSTS in place, the redirect is UX convenience, not a security requirement. Informational — does not affect score.",
  },
  no_http_to_https_redirect: {
    axis: "security",
    label: "No HTTP→HTTPS Redirect",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — server/CDN config",
    fixDescription: "Configure HTTP→HTTPS redirect",
    weightRange: [2, 2],
    promptGuidance: "No redirect means users typing domain without https:// get insecure version.",
    archetypeNotes: { commerce: "Payment sites must redirect to HTTPS." },
  },
  mixed_content: {
    axis: "security",
    label: "Mixed Content",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1 hour — update resource URLs",
    fixDescription: "Fix mixed HTTP/HTTPS content",
    weightRange: [2, 3],
    promptGuidance:
      "Active mixed content (scripts/iframes over HTTP) > passive (images). Active can be exploited for code injection.",
  },
  subresource_integrity: {
    axis: "security",
    label: "Subresource Integrity",
    fixDescription: "Detected automatically — SRI ensures third-party scripts have not been tampered with",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 1.0,
    promptGuidance: "SRI ensures CDN-hosted scripts haven't been tampered with. Positive signal.",
    requiresHttpAccess: true,
  },
  subresource_integrity_missing: {
    axis: "security",
    label: "SRI Missing on External Scripts",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — add SRI hashes to external scripts",
    fixDescription: "Add SRI integrity attributes to external scripts",
    weightRange: [1, 1],
    suppressesAbsent: "subresource_integrity",
    promptGuidance: "SRI ideal for third-party CDN scripts. Not feasible for dynamic scripts.",
    requiresHttpAccess: true,
  },
  subresource_integrity_partial: {
    axis: "security",
    label: "Partial SRI Coverage",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — add SRI to remaining scripts",
    fixDescription: "Add SRI to remaining external scripts",
    weightRange: [1, 1],
    suppressesAbsent: "subresource_integrity",
    promptGuidance: "Partial SRI = incremental adoption. Acknowledge progress.",
    requiresHttpAccess: true,
  },
  form_action_security: {
    axis: "security",
    label: "Insecure Form Action",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — update form URLs",
    fixDescription: "Secure form action URLs (use HTTPS)",
    weightRange: [3, 3],
    promptGuidance: "Forms posting to HTTP transmit data in plaintext. High severity for credential/personal data.",
    archetypeNotes: { commerce: "Payment/checkout forms over HTTP are critical vulnerabilities." },
    requiresHttpAccess: true,
  },
  mta_sts: {
    axis: "email",
    label: "MTA-STS",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — DNS + well-known file",
    fixDescription: "Configure MTA-STS policy",
    weightRange: [2, 2],
    goodPrevalence: 0.556,
    promptGuidance:
      "MTA-STS enforces TLS for email transport. mode=enforce is strong. mode=testing is a good step. Bonus-only.",
  },
  security_headers_completeness: {
    axis: "security",
    label: "Security Headers Completeness",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — add missing security headers",
    fixDescription: "Add missing security response headers",
    weightRange: [2, 2],
    goodPrevalence: 0.044,
    promptGuidance:
      "Meta-signal: how many of 6 key headers deployed (HSTS, CSP, XFO, XCTO, Referrer-Policy, Permissions-Policy). 6/6=good, 4+=info, 2+=low, <2=medium.",
    requiresHttpAccess: true,
  },
  hpkp_deprecated: {
    axis: "security",
    label: "Deprecated HPKP Header",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — remove header",
    fixDescription: "Remove deprecated Public-Key-Pins header",
    weightRange: [1, 2],
    promptGuidance:
      "HPKP is deprecated and dangerous — can permanently DoS domain. Chrome removed support 2018. Flag for immediate removal.",
  },
  cors_wildcard: {
    axis: "security",
    label: "CORS Wildcard Origin",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — restrict CORS config",
    fixDescription: "Restrict CORS Access-Control-Allow-Origin",
    weightRange: [1, 1],
    promptGuidance:
      "Wildcard (*) without credentials is common for public APIs — usually intentional. Ensure no sensitive data exposed without auth.",
  },
  cors_null_origin: {
    axis: "security",
    label: "CORS Null Origin Allowed",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — restrict CORS config",
    fixDescription: "Remove null from CORS allowed origins",
    weightRange: [2, 2],
    promptGuidance: "null origin exploitable via sandboxed iframes and data: URIs. Use specific origins.",
  },
  cors_wildcard_credentials: {
    axis: "security",
    label: "CORS Wildcard with Credentials",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — fix CORS config",
    fixDescription: "Remove credentials with wildcard CORS origin",
    weightRange: [4, 4],
    promptGuidance:
      "Wildcard + credentials = critical misconfiguration. Any site can make authenticated requests. Fix immediately.",
  },
  cross_origin_isolation: {
    axis: "security",
    label: "Cross-Origin Isolation",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — add COOP/COEP headers",
    fixDescription: "Enable cross-origin isolation (COOP/COEP)",
    weightRange: [1, 1],
    goodPrevalence: 0.114,
    promptGuidance:
      "COOP+COEP+CORP is bonus-only. NEVER recommend COEP require-corp for sites with third-party resources — it breaks all cross-origin resources that don't opt in. Absence is NOT a security gap. Weight 1 (lowest).",
    archetypeNotes: {
      application: "SPAs with third-party scripts: COEP will break the site. Only for isolated apps.",
      commerce: "E-commerce universally has third-party scripts — COEP is impractical and dangerous.",
      content: "Content sites with ads/social embeds cannot safely use COEP.",
    },
    requiresHttpAccess: true,
  },
  tls_version: {
    axis: "security",
    label: "TLS Version",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — server config",
    fixDescription: "Upgrade minimum TLS version",
    weightRange: [1, 3],
    goodPrevalence: 0.856,
    promptGuidance: "TLS 1.3 ideal. 1.2 standard. 1.0/1.1 legacy, vulnerable to downgrade — high severity.",
  },
  cert_expiry_proximity: {
    axis: "security",
    label: "Certificate Expiry",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~15 min — renew certificate",
    fixDescription: "Renew SSL/TLS certificate",
    weightRange: [1, 4],
    goodPrevalence: 0.96,
    promptGuidance:
      "Severity: expired=critical, <7d=high, <14d=medium, <30d=low, 30d+=good. Let's Encrypt auto-renews — short remaining time may mean failed auto-renewal.",
  },
  pre_consent_cookies: {
    axis: "reputation",
    label: "Pre-Consent Cookies",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1 hour — fix cookie consent flow",
    fixDescription: "Fix pre-consent cookie behavior",
    weightRange: [3, 3],
    promptGuidance: "Tracking cookies before consent is GDPR issue. Severity depends on jurisdiction and purpose.",
    archetypeNotes: { institutional: "Government/education face higher compliance scrutiny." },
  },
  script_privacy: {
    axis: "reputation",
    label: "Script Privacy Concerns",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1 hour — review and replace trackers",
    fixDescription: "Review third-party tracking scripts",
    weightRange: [3, 3],
    promptGuidance: "Privacy concerns from third-party tracking. Consider whether disclosed in privacy policy.",
  },
  http_blocked_security: {
    axis: "security",
    label: "HTTP Blocked (Security)",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Scanner limitation — site blocks automated HTTP probes. Not a site defect. Don't penalize; note that header-based signals couldn't be assessed.",
  },
  vulnerable_js_libraries: {
    axis: "security",
    label: "Vulnerable JS Libraries",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — update dependencies",
    fixDescription: "Update vulnerable JavaScript libraries",
    weightRange: [1, 3],
    goodPrevalence: 0.921,
    promptGuidance:
      "CVE detection is version-based, doesn't confirm exploitability. Site may not use vulnerable function. Note this caveat. EOL libraries are additional concern.",
    requiresHttpAccess: true,
  },

  // ── WordPress Security (display-only, zero score impact) ──────────

  wp_api_exposed: {
    axis: "security",
    label: "WordPress REST API Exposed",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — disable REST API or restrict endpoints",
    fixDescription: "Restrict or disable the WordPress REST API to prevent information disclosure",
    weightRange: [0, 0],
    promptGuidance:
      "Display-only signal. REST API exposure enables user enumeration and data extraction. Many themes/plugins require it, so disabling isn't always viable.",
  },
  wp_user_enumeration: {
    axis: "security",
    label: "WordPress User Enumeration Possible",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — security plugin or REST API restriction",
    fixDescription: "Block public access to /wp-json/wp/v2/users to prevent username discovery",
    weightRange: [1, 1],
    requiresContext: "wordpress",
    promptGuidance:
      "Usernames visible via REST API aid brute-force attacks. Fixable via security plugins (Wordfence, iThemes) or custom code.",
  },
  wp_xmlrpc_exposed: {
    axis: "security",
    label: "WordPress XML-RPC Accessible",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — block in .htaccess or plugin",
    fixDescription: "Disable or block XML-RPC to prevent brute-force and DDoS amplification attacks",
    weightRange: [0, 0],
    promptGuidance:
      "Display-only signal. xmlrpc.php enables brute-force login attempts and pingback DDoS amplification. Rarely needed in modern WP — disable unless using Jetpack or mobile app publishing.",
  },
  wp_login_exposed: {
    axis: "security",
    label: "WordPress Login Page Exposed",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — WPS Hide Login or similar plugin",
    fixDescription: "Move or restrict access to the WordPress login page",
    weightRange: [0, 0],
    promptGuidance:
      "Display-only signal. Publicly accessible login page enables brute-force attempts. Mitigated by rate limiting, 2FA, or hiding the login URL.",
  },
  wp_directory_listing: {
    axis: "security",
    label: "WordPress Directory Listing Enabled",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add Options -Indexes to .htaccess",
    fixDescription: "Disable directory listing to prevent file structure disclosure",
    weightRange: [0, 0],
    promptGuidance:
      "Display-only signal. Open directory listing in /wp-content/uploads/ exposes uploaded files and server file structure. Easy fix via .htaccess.",
  },
  wp_no_security_plugin: {
    axis: "security",
    label: "No WordPress Security Plugin",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — install Wordfence, Sucuri, or similar",
    fixDescription: "Install a WordPress security plugin for firewall, malware scanning, and login protection",
    weightRange: [0, 0],
    promptGuidance:
      "Display-only signal. Security plugins provide firewall, brute-force protection, and malware scanning. Not strictly required if server-level security is strong, but recommended.",
  },
  wp_no_caching_plugin: {
    axis: "speed",
    label: "No WordPress Caching Plugin",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — install WP Rocket, LiteSpeed Cache, or WP Super Cache",
    fixDescription: "Install a caching plugin to improve page load times",
    weightRange: [0, 0],
    promptGuidance:
      "Display-only signal. Caching plugins dramatically reduce page load times for WordPress. Less critical if using managed hosting with built-in caching.",
  },
  wp_security_plugin_detected: {
    axis: "security",
    label: "WordPress Security Plugin Active",
    fixDescription: "Detected automatically — WordPress security plugin providing additional hardening",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [0, 0],
    goodPrevalence: 1.0,
    requiresContext: "wordpress",
    promptGuidance: "Display-only positive signal. Site has a recognized security plugin installed.",
  },
  wp_caching_plugin_detected: {
    axis: "speed",
    label: "WordPress Caching Plugin Active",
    fixDescription: "Detected automatically — WordPress caching plugin improving page load performance",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [0, 0],
    goodPrevalence: 1.0,
    requiresContext: "wordpress",
    promptGuidance: "Display-only positive signal. Site has a recognized caching/performance plugin installed.",
  },

  // ── Performance ───────────────────────────────────────────────────

  perf_score: {
    axis: "speed",
    label: "PageSpeed Score",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "Varies — run Lighthouse for details",
    fixDescription: "Optimize page performance (see PageSpeed report)",
    weightRange: [5, 5],
    goodPrevalence: 0.485,
    promptGuidance:
      "PageSpeed 0-100. Median mobile ~50-60. ≥90=good, 50-89=needs improvement, <50=poor. CrUX field data is more authoritative than lab scores.",
    archetypeNotes: {
      content: "Content sites depend on performance for SEO — Google uses CWV for ranking.",
      application: "SPAs have structural TBT/INP issues that 'reduce JavaScript' doesn't address.",
      infrastructure: "API/infrastructure: PageSpeed scores less meaningful.",
    },
  },
  lcp: {
    axis: "speed",
    label: "Largest Contentful Paint",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~1-2 hours — optimize images and loading",
    fixDescription: "Reduce Largest Contentful Paint time",
    weightRange: [4, 4],
    goodPrevalence: 0.586,
    promptGuidance:
      "Largest Contentful Paint: ≤2.5s good, ≤4.0s needs-improvement, >4.0s poor. Core Web Vital for Google ranking.",
  },
  cls: {
    axis: "speed",
    label: "Cumulative Layout Shift",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~1 hour — fix layout shifts",
    fixDescription: "Fix Cumulative Layout Shift issues",
    weightRange: [3, 3],
    goodPrevalence: 0.787,
    promptGuidance:
      "Cumulative Layout Shift: ≤0.1 good, ≤0.25 needs-improvement, >0.25 poor. Caused by images without dimensions, dynamic content, web fonts.",
  },
  ttfb: {
    axis: "speed",
    label: "Time to First Byte",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — server/CDN optimization",
    fixDescription: "Reduce Time to First Byte",
    weightRange: [3, 3],
    goodPrevalence: 0.63,
    promptGuidance:
      "Time to First Byte: ≤800ms good. Affected by server processing, CDN effectiveness, geographic distance.",
  },
  fcp: {
    axis: "speed",
    label: "First Contentful Paint",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~1 hour — optimize render path",
    fixDescription: "Reduce First Contentful Paint time",
    weightRange: [2, 2],
    goodPrevalence: 0.577,
    promptGuidance: "First Contentful Paint: ≤1.8s good, ≤3.0s needs-improvement, >3.0s poor.",
  },
  inp: {
    axis: "speed",
    label: "Interaction to Next Paint",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Interaction to Next Paint: ≤200ms good, ≤500ms needs-improvement, >500ms poor. Core Web Vital (replaced FID March 2024). CrUX-dependent — can't measure without field data. Informational — does not affect score.",
  },
  tbt: {
    axis: "speed",
    label: "Total Blocking Time",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~1-2 hours — reduce JS blocking",
    fixDescription: "Reduce Total Blocking Time",
    weightRange: [2, 2],
    goodPrevalence: 0.543,
    promptGuidance:
      "Total Blocking Time: ≤200ms good, ≤600ms needs-improvement, >600ms poor. Lab-only (INP is field equivalent).",
  },
  crux_field_data: {
    axis: "speed",
    label: "CrUX Field Data",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "CrUX provides real-user data — more authoritative than lab. Traffic-dependent, not quality-dependent. Informational — does not affect score.",
  },
  cdn: {
    axis: "foundations",
    label: "CDN Detected",
    fixDescription: "Detected automatically — CDN distributes content across global edge servers for faster delivery",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [3, 3],
    goodPrevalence: 1.0,
    promptGuidance:
      "CDN detected is positive — reduces latency, improves caching. CDN-fronted sites handle compression/caching at edge.",
  },
  asset_cdn: {
    axis: "speed",
    label: "Asset CDN",
    fixDescription: "Third-party CDN hostnames detected in page source for static assets",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 0.4,
    promptGuidance:
      "Third-party CDN hostnames detected in page source for static assets (images, scripts, stylesheets). Indicates the site uses a CDN for asset delivery even if the main site isn't CDN-fronted. Only fires when full-site CDN is not already detected.",
  },
  http2: {
    axis: "foundations",
    label: "HTTP/2 Enabled",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 0.95,
    promptGuidance:
      "HTTP/2 is standard since 2015. Expected, not exceptional. Absence penalizes the ~5% still on HTTP/1.1.",
  },
  http3: {
    axis: "foundations",
    label: "HTTP/3 Enabled",
    fixDescription: "Detected automatically — HTTP/3 uses QUIC protocol for faster, more reliable connections",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 1.0,
    promptGuidance:
      "HTTP/3 (QUIC) is forward-looking — reduces connection latency. Bonus signal. Still emerging — low weight.",
  },
  http1_only: {
    axis: "foundations",
    label: "HTTP/1.1 Only",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — server/CDN config",
    fixDescription: "Enable HTTP/2 on server",
    weightRange: [2, 2],
    promptGuidance: "HTTP/1.1 only is outdated. Usually old server software. Medium severity.",
  },
  cache_headers: {
    axis: "speed",
    label: "Cache Headers",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — configure cache headers",
    fixDescription: "Configure proper cache headers",
    weightRange: [3, 3],
    goodPrevalence: 0.137,
    promptGuidance:
      "no-store for dynamic HTML is correct. Aggressive max-age on versioned static assets is best practice. CDN-fronted sites handle caching at edge.",
    archetypeNotes: {
      commerce: "Dynamic content (prices, inventory) should avoid aggressive caching.",
      content: "Content sites benefit most from proper cache headers.",
    },
    requiresHttpAccess: true,
  },
  no_compression: {
    axis: "speed",
    label: "No Compression",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — server/CDN config",
    fixDescription: "Enable gzip/brotli compression",
    weightRange: [1, 1],
    promptGuidance:
      "Header-based check may not reflect actual behavior (e.g., Cloudflare decompresses for Workers). Low weight.",
  },
  redirect_chain_length: {
    axis: "speed",
    label: "Redirect Chain",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — reduce redirects",
    fixDescription: "Reduce redirect chain length",
    weightRange: [1, 2],
    promptGuidance: "Each hop adds latency. 1 hop (HTTP→HTTPS) normal. 2 acceptable. 4+ = config issues.",
  },
  render_blocking_scripts: {
    axis: "speed",
    label: "Render-Blocking Scripts",
    fixDescription: "Detected automatically — no third-party scripts blocking page rendering",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [3, 3],
    goodPrevalence: 0.57,
    promptGuidance:
      "Render-blocking scripts delay rendering. 1-2=low, 3-5=medium, 6+=high. async/defer may cause timing issues.",
    requiresHttpAccess: true,
  },
  third_party_count: {
    axis: "speed",
    label: "Third-Party Script Count",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1-2 hours — audit and remove unnecessary scripts",
    fixDescription: "Reduce third-party scripts",
    weightRange: [2, 2],
    promptGuidance:
      "Each domain adds ~50-200ms overhead. >15=high, >8=medium. High count makes COEP impractical. Recommend auditing, not blanket removal.",
    archetypeNotes: {
      commerce: "E-commerce legitimately needs many scripts (payments, analytics, support). Focus on optimization.",
    },
  },
  pagespeed_unavailable: {
    axis: "speed",
    label: "PageSpeed Unavailable",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [2, 2],
    promptGuidance: "PageSpeed unavailable — can't assess CWV. Don't speculate.",
  },
  resource_hints: {
    axis: "speed",
    label: "Resource Hints",
    fixDescription:
      "Detected automatically — preload, prefetch, preconnect, and modulepreload link hints improve loading",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 1.0,
    promptGuidance:
      "preload/preconnect/dns-prefetch indicate performance-aware engineering. Absence is NOT negative — bonus-only.",
    archetypeNotes: { infrastructure: "Static sites/APIs don't need resource hints." },
    requiresHttpAccess: true,
  },
  http_blocked_performance: {
    axis: "speed",
    label: "HTTP Blocked (Performance)",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Scanner limitation — site blocks automated HTTP probes. Not a site defect. Don't penalize; note that performance metrics are limited to PageSpeed data.",
  },
  site_unreachable_performance: {
    axis: "speed",
    label: "Site Unreachable (Performance)",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [5, 5],
    promptGuidance: "Cannot measure performance of unreachable site.",
  },
  slow_connection: {
    axis: "foundations",
    label: "Slow Connection",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [2, 2],
    promptGuidance: "Single probe location — may be geographic distance, not infrastructure quality. Don't overstate.",
  },

  // ── Infrastructure ───────────────────────────────────────────────────

  ns_redundancy: {
    axis: "foundations",
    label: "Nameserver Count",
    fixDescription: "Detected automatically — multiple nameservers ensure DNS availability",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [0, 0],
    goodPrevalence: 1.0,
    promptGuidance: "Informational only (weight 0). 2 is RFC minimum. Most registrars enforce 2+.",
  },
  ipv6: {
    axis: "foundations",
    label: "IPv6 Support",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~15 min — add AAAA records",
    fixDescription: "Add IPv6 (AAAA) DNS records",
    weightRange: [1, 1],
    goodPrevalence: 0.305,
    promptGuidance: "Many hosts don't support IPv6. Informational, not actionable. IPv4-only is fine. Weight 1.",
  },
  lb: {
    axis: "foundations",
    label: "DNS Redundancy",
    fixDescription: "Detected automatically — multiple A records indicate redundant hosting infrastructure",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 0.35,
    promptGuidance:
      "Multiple A records provide IP-level redundancy. Not necessarily intentional load balancing — may reflect hosting provider infrastructure, CDN anycast, or round-robin DNS.",
  },
  caa: {
    axis: "foundations",
    label: "CAA Records",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~10 min — DNS records",
    fixDescription: "Add CAA DNS records",
    weightRange: [1, 1],
    goodPrevalence: 0.19,
    promptGuidance: "CAA restricts certificate issuance. Absence is informational.",
  },
  low_ttl: {
    axis: "foundations",
    label: "Low DNS TTL",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [1, 1],
    promptGuidance:
      "Low TTL (60-300s) is NORMAL for CDN-managed DNS — fast failover. NOT a problem. Only <60s worth noting.",
  },
  tcp_connection_time: {
    axis: "foundations",
    label: "TCP Connection Time",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — server/CDN optimization",
    fixDescription: "Optimize TCP connection time",
    weightRange: [2, 2],
    goodPrevalence: 0.997,
    promptGuidance: "Single probe location. <300ms=good, 300-500ms=ok, 500-1000ms=slow, >1000ms=very slow.",
  },
  dns_resolution_time: {
    axis: "foundations",
    label: "DNS Resolution Time",
    fixDescription: "Detected automatically — fast DNS resolution from authoritative nameservers",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 0.992,
    promptGuidance: "Single probe location. <100ms=good, 100-200ms=ok, 200-500ms=slow, >500ms=very slow.",
  },
  ns_provider_diversity: {
    axis: "foundations",
    label: "NS Provider Diversity",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Multi-provider DNS detected. Major providers (Cloudflare/Route53/Google) are already globally redundant. Informational — does not affect score.",
  },
  mx_redundancy: {
    axis: "email",
    label: "MX Redundancy",
    fixDescription: "Detected automatically — multiple MX records ensure email delivery reliability",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 0.599,
    promptGuidance: "Multiple MX = email redundancy. No MX fine for non-email domains.",
    archetypeNotes: {
      infrastructure: "API/CDN domains don't need MX — don't recommend adding.",
      application: "SaaS may handle email via application layer.",
    },
  },
  site_unreachable: {
    axis: "foundations",
    label: "Site Unreachable",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [5, 5],
    promptGuidance: "DNS resolves but no HTTP response — fundamentally broken.",
  },
  http_blocked_infrastructure: {
    axis: "foundations",
    label: "HTTP Blocked (Infrastructure)",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Scanner limitation — site blocks automated HTTP probes. Not a site defect. Don't penalize; scoring limited to DNS/WHOIS/SSL.",
  },
  http_error_response: {
    axis: "foundations",
    label: "HTTP Error Response",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [1, 2],
    promptGuidance:
      "4xx to automated probes is common and low-severity. 5xx is more concerning. WAF blocks excluded. Weight reduced — probe blocking is a scanner limitation.",
  },
  dns_inconsistent: {
    axis: "foundations",
    label: "DNS Inconsistency",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — verify DNS config",
    fixDescription: "Fix DNS record inconsistencies",
    weightRange: [3, 3],
    promptGuidance: "Different IPs across resolvers is NORMAL for CDN (anycast/geo-DNS). Only flag non-CDN domains.",
  },
  dns_consistent: {
    axis: "foundations",
    label: "DNS Consistent",
    fixDescription: "Detected automatically — DNS records consistent across global resolvers",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 1.0,
    promptGuidance: "Consistent DNS is positive. CDN variation also reported as consistent (expected).",
  },
  bgp_unstable: {
    axis: "foundations",
    label: "BGP Instability",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [2, 2],
    promptGuidance: "BGP churn on responding site = traffic engineering (info). Only concerning if site unreachable.",
  },
  low_visibility: {
    axis: "foundations",
    label: "Low Visibility",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [1, 3],
    promptGuidance:
      "BGP route visibility, NOT SEO. RIPE RIS vantage points concentrated in Europe/US. APAC/LATAM may show low visibility when fine in their market.",
  },

  // ── Trust ─────────────────────────────────────────────────────────

  domain_age_trust: {
    axis: "reputation",
    label: "Domain Age",
    fixDescription: "Domain age builds naturally over time — newly registered domains start with reduced trust",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [4, 4],
    goodPrevalence: 0.936,
    promptGuidance:
      "<30d=newly registered (NRD, high risk); 30-90d=recent; 90d-1yr=young; 1-3yr=growing; 3-5yr=mature; 5yr+=established. Young domain + EV cert suggests legitimate new business.",
  },
  registration_length: {
    axis: "reputation",
    label: "Registration Length",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~5 min — renew at registrar",
    fixDescription: "Extend domain registration period",
    weightRange: [2, 2],
    goodPrevalence: 0.401,
    promptGuidance:
      "1 year is normal. Multi-year is trust signal. Near-expiry (<30d) is concern. Weak signal — many legitimate sites renew annually.",
  },
  breaches: {
    axis: "reputation",
    label: "Data Breaches",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [1, 4],
    promptGuidance:
      "Time decay: <1yr full weight, 1-3yr 75%, 3-5yr 50%, 5-10yr 25%, >10yr 10%. Past breach ≠ currently insecure. Distinguish verified vs unverified.",
  },
  tranco_rank: {
    axis: "reputation",
    label: "Tranco Rank",
    fixDescription: "Detected automatically — Tranco measures web traffic popularity among the top 1M sites",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [1, 3],
    goodPrevalence: 0.761,
    promptGuidance:
      "Top 1K=global; 1K-10K=major; 10K-100K=significant; 100K-1M=moderate. Unranked is neutral, not negative.",
  },
  greynoise_noise: {
    axis: "reputation",
    label: "GreyNoise Noise",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [1, 2],
    promptGuidance:
      "IP with scanning traffic. CDN IPs excluded (shared infra). Non-CDN noise = moderate trust concern.",
  },
  greynoise_riot: {
    axis: "reputation",
    label: "GreyNoise RIOT",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "IP belongs to known legitimate service. Overlaps with CDN detection. Informational — does not affect score.",
  },
  email_trust: {
    axis: "email",
    label: "Email Trust",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — DNS + email provider config",
    fixDescription: "Improve email authentication for trust",
    weightRange: [1, 1],
    promptGuidance:
      "Penalizes incomplete email auth. The email_auth signal already rewards complete auth — this only fires when auth is missing or incomplete.",
    archetypeNotes: { infrastructure: "API domains that don't send email: missing auth is informational." },
  },
  security_txt: {
    axis: "security",
    label: "security.txt",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~10 min — create /.well-known/security.txt",
    fixDescription: "Create security.txt file",
    weightRange: [1, 2],
    goodPrevalence: 1.0,
    promptGuidance:
      "Presence is positive (responsible disclosure). With bug bounty = stronger. Absence is neutral — reward-only signal.",
    archetypeNotes: {
      corporate: "Corporate sites should have security.txt.",
      institutional: "Enterprise/government benefit from security.txt.",
    },
    requiresHttpAccess: true,
  },
  bimi_record: {
    axis: "email",
    label: "BIMI Record",
    fixDescription: "Add a BIMI DNS record with your brand logo SVG for display in email clients",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 1.0,
    promptGuidance:
      "Requires DMARC enforcement. Indicates advanced email maturity. VMC (Verified Mark Certificate) is even stronger. Absence is neutral — reward-only.",
  },
  spf_strictness: {
    axis: "email",
    label: "SPF Strictness",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~5 min — update SPF record to use -all",
    fixDescription: "Use -all (hard fail) in SPF record",
    weightRange: [2, 2],
    goodPrevalence: 0.477,
    promptGuidance:
      "SPF -all rejects unauthorized senders. ~all soft-fails (marks but delivers). ?all/+all provide no protection. +all is actively dangerous.",
  },
  spf_multiple_records: {
    axis: "email",
    label: "Multiple SPF Records",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — merge SPF records into one TXT record",
    fixDescription: "Merge duplicate SPF records into a single TXT record",
    weightRange: [3, 3],
    promptGuidance:
      "RFC 7208 §3.2: domain MUST NOT have >1 SPF record. Multiple = PermError = all SPF checks fail. Shockingly common misconfiguration.",
  },
  spf_lookup_count: {
    axis: "email",
    label: "SPF Lookup Count",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — flatten SPF record or reduce includes",
    fixDescription: "Reduce SPF DNS lookups to stay under RFC limit of 10",
    weightRange: [2, 2],
    goodPrevalence: 0.967,
    promptGuidance:
      "RFC 7208 limits SPF to 10 DNS lookups (include, a, mx, ptr, exists, redirect). Exceeding causes PermError — SPF fails silently. Common with many SaaS senders.",
  },
  dmarc_rua: {
    axis: "email",
    label: "DMARC Reporting",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~5 min — add rua= to DMARC record",
    fixDescription: "Add aggregate reporting (rua) to DMARC record",
    weightRange: [2, 2],
    goodPrevalence: 0.862,
    promptGuidance:
      "DMARC rua= enables aggregate reports on authentication failures. Without it, domain owners have zero visibility into spoofing attempts. Essential operational signal.",
  },
  dmarc_subdomain_policy: {
    axis: "email",
    label: "DMARC Subdomain Policy",
    fixDescription: "Add sp=reject to your DMARC record to protect subdomains from email spoofing",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 0.658,
    promptGuidance:
      "DMARC sp= sets explicit subdomain policy. sp=reject closes subdomain spoofing gap. Absence inherits parent policy — usually fine. Bonus-only.",
  },
  dkim_discovered: {
    axis: "email",
    label: "DKIM Discovered",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~15 min — configure DKIM via email provider",
    fixDescription: "Configure DKIM signing for your domain",
    weightRange: [2, 2],
    goodPrevalence: 0.678,
    promptGuidance:
      "Probes common DKIM selectors (google, selector1, selector2, k1, s1, etc.). Found = domain signs email. Not found may be false negative — custom selectors aren't probed.",
  },
  tls_rpt: {
    axis: "email",
    label: "TLS-RPT",
    fixDescription: "Add a TLS-RPT DNS record (_smtp._tls.domain TXT) to receive TLS delivery failure reports",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 1.0,
    promptGuidance:
      "TLS Reporting (RFC 8460) enables reports on TLS delivery failures. Companion to MTA-STS. Adoption <1%. Bonus-only — advanced signal.",
  },
  ads_txt: {
    axis: "reputation",
    label: "ads.txt",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Declares authorized ad sellers. Only relevant for publisher sites. Informational — does not affect score.",
    archetypeNotes: { content: "Content sites with advertising should have ads.txt." },
  },
  cert_validation_type: {
    axis: "foundations",
    label: "Certificate Validation Type",
    fixDescription: "Detected automatically — certificate validation level (DV, OV, or EV)",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [1, 3],
    goodPrevalence: 0.221,
    promptGuidance:
      "95%+ of certs are DV (Let's Encrypt) — standard and expected. Only flag DV for financial/government. EV/OV are positive but DV is not weakness.",
    archetypeNotes: {
      institutional: "Government/financial should have EV or OV.",
      commerce: "EV can increase trust for payments, but DV is not a problem.",
    },
  },
  ct_caa_mismatch: {
    axis: "security",
    label: "CT/CAA Mismatch",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Certs from CAs not in CAA may predate CAA deployment — informational ONLY, not vulnerability. Weight 0.",
  },
  organizational_identity: {
    axis: "reputation",
    label: "Organizational Identity",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~15 min — add organization page",
    fixDescription: "Add about/team/organization page",
    weightRange: [3, 3],
    goodPrevalence: 0.428,
    promptGuidance:
      "Privacy policy, terms, about page = organizational transparency. Missing is low concern for small/personal sites.",
  },
  ops_transparency: {
    axis: "foundations",
    label: "Operational Transparency",
    fixDescription: "Detected automatically — public status pages, uptime monitoring, or incident tracking",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 1.0,
    promptGuidance: "Status pages, monitoring tools = mature operations. Bonus-only.",
  },
  cookie_consent_missing: {
    axis: "reputation",
    label: "No Cookie Consent",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1-2 hours — implement consent banner",
    fixDescription: "Implement cookie consent banner",
    weightRange: [2, 2],
    suppressesAbsent: "cookie_consent_cmp",
    promptGuidance:
      "GDPR requires consent for EU-facing sites. US requirements minimal. Low concern for US-only sites without tracking cookies.",
    archetypeNotes: {
      institutional: "Government/education face higher compliance scrutiny.",
      commerce: "E-commerce collecting user data should have consent management.",
    },
    requiresContext: "cookies",
    requiresHttpAccess: true,
  },
  cookie_consent_cmp: {
    axis: "reputation",
    label: "Cookie Consent CMP",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~30 min — configure CMP properly",
    fixDescription: "Improve cookie consent management platform",
    weightRange: [3, 3],
    goodPrevalence: 0.705,
    promptGuidance: "CMP detected is positive trust signal. Higher confidence = stronger.",
    requiresContext: "cookies",
    requiresHttpAccess: true,
  },
  cookie_compliance: {
    axis: "reputation",
    label: "Cookie Compliance",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~1-2 hours — fix compliance issues",
    fixDescription: "Fix cookie compliance issues",
    weightRange: [2, 2],
    promptGuidance: "Compliance flags indicate potential regulatory issues. Severity scales with count.",
  },
  dmarc_reject: {
    axis: "email",
    label: "DMARC Policy",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~15 min — DNS change (after sender audit)",
    fixDescription: "Upgrade DMARC policy to quarantine/reject",
    weightRange: [2, 2],
    goodPrevalence: 0.336,
    promptGuidance:
      "Recommend gradual rollout: none → quarantine → reject. NEVER jump straight to p=reject. p=reject prevents spoofing. p=none = monitoring only.",
  },
  blocklist_trust: {
    axis: "reputation",
    label: "Blocklist Trust Impact",
    fixDescription: "Detected automatically — domain and IP checked against major security and email blocklists",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [3, 3],
    goodPrevalence: 0.995,
    promptGuidance: "Clean record is positive. Being listed is serious — severity scales with count.",
  },

  // ── Visibility ────────────────────────────────────────────────────

  domain_popularity: {
    axis: "discoverability",
    label: "Domain Popularity",
    fixDescription: "Detected automatically — web popularity ranking from Tranco and other sources",
    actionable: false,
    canBeNonGood: true,
    canBeGood: true,
    weightRange: [1, 3],
    goodPrevalence: 0.489,
    promptGuidance: "Tranco rank = traffic/popularity. Both trust and visibility signal. Unranked is neutral.",
  },
  structured_data: {
    axis: "discoverability",
    label: "Structured Data Present",
    fixDescription: "Detected automatically — JSON-LD or microdata structured data for rich search results",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [2, 2],
    goodPrevalence: 1.0,
    promptGuidance:
      "JSON-LD enhances search (rich snippets). Relevant schemas: Product for commerce, Article for content, Organization for corporate. CMS may auto-generate.",
    archetypeNotes: {
      commerce: "Product/Offer schema essential.",
      content: "Article/BlogPosting improves search.",
      corporate: "Organization schema helps identity.",
    },
    requiresHttpAccess: true,
  },
  no_structured_data: {
    axis: "discoverability",
    label: "No Structured Data",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~15 min — add JSON-LD to HTML",
    fixDescription: "Add structured data markup (JSON-LD)",
    weightRange: [2, 2],
    promptGuidance:
      "No JSON-LD. Impact depends on site type. If present without sitemap, may be CMS-generated. social_meta and og_completeness overlap — don't cite all for same issue.",
    archetypeNotes: {
      infrastructure: "APIs don't need structured data.",
      application: "Apps behind login don't benefit.",
    },
  },
  social_meta: {
    axis: "discoverability",
    label: "Social Meta Tags",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~10 min — add meta tags",
    fixDescription: "Add Open Graph and Twitter Card meta tags",
    weightRange: [3, 3],
    goodPrevalence: 0.516,
    promptGuidance:
      "OG + Twitter Card tags control social sharing appearance. Overlaps with og_completeness — don't cite both for same issue.",
    archetypeNotes: {
      infrastructure: "API domains don't need social meta.",
      application: "Apps behind login don't benefit.",
    },
    requiresHttpAccess: true,
  },
  robots_txt: {
    axis: "discoverability",
    label: "robots.txt",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~10 min — create robots.txt",
    fixDescription: "Add robots.txt file",
    weightRange: [2, 2],
    goodPrevalence: 0.634,
    promptGuidance: "Controls crawler access. Presence is standard. Absence is fine — crawlers index all by default.",
    archetypeNotes: { application: "Private apps may intentionally omit or block." },
    requiresHttpAccess: true,
  },
  sitemap: {
    axis: "discoverability",
    label: "Sitemap",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~15 min — generate sitemap.xml",
    fixDescription: "Add sitemap.xml",
    weightRange: [2, 2],
    goodPrevalence: 0.333,
    promptGuidance:
      "Helps search engines discover pages. Important for large content sites. Small sites with good linking don't need one.",
    archetypeNotes: {
      content: "Content sites with many articles should have sitemap.",
      infrastructure: "API domains don't need sitemaps.",
      application: "Apps behind login don't need sitemaps.",
    },
    requiresHttpAccess: true,
  },
  legal_pages: {
    axis: "reputation",
    label: "Legal Pages",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~2-4 hours — create legal pages",
    fixDescription: "Add privacy policy and terms pages",
    weightRange: [1, 1],
    goodPrevalence: 0.691,
    promptGuidance: "Low weight (1) but important for trust/compliance.",
  },
  social_accounts: {
    axis: "discoverability",
    label: "Social Accounts",
    fixDescription: "Detected automatically — verified social media accounts linked via rel=me attributes",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 3],
    goodPrevalence: 0.493,
    promptGuidance: "rel=me verified > homepage links. Relevance varies by site type.",
    requiresHttpAccess: true,
  },
  no_social_accounts: {
    axis: "discoverability",
    label: "No Social Accounts",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~30 min — create and link profiles",
    fixDescription: "Create and link social media accounts",
    weightRange: [1, 1],
    promptGuidance: "Mild concern for content/corporate. Not relevant for APIs.",
    archetypeNotes: { infrastructure: "API/infrastructure don't need social accounts." },
  },
  restrictive_robots: {
    axis: "discoverability",
    label: "Restrictive robots.txt",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — update robots.txt",
    fixDescription: "Review restrictive robots.txt rules",
    weightRange: [2, 2],
    promptGuidance: "Blocks all crawlers — no search visibility. May be intentional for private sites.",
    archetypeNotes: {
      infrastructure: "Blocking crawlers correct for APIs.",
      application: "Internal apps should block crawlers.",
    },
  },
  pwa_ready: {
    axis: "discoverability",
    label: "PWA Readiness",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "PWA readiness is an architectural choice, not a quality indicator. Even Lighthouse treats PWA as informational. Does not affect score.",
  },
  canonical_url: {
    axis: "discoverability",
    label: "Canonical URL",
    fixDescription: "Detected automatically — canonical URL properly set for SEO deduplication",
    actionable: false,
    canBeNonGood: false,
    canBeGood: true,
    weightRange: [1, 1],
    goodPrevalence: 0.889,
    promptGuidance: "Self-referencing is standard. Cross-domain may be intentional.",
    requiresHttpAccess: true,
  },
  canonical_url_missing: {
    axis: "discoverability",
    label: "No Canonical URL",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add link rel=canonical",
    fixDescription: "Add canonical URL link tag",
    weightRange: [1, 1],
    promptGuidance: "Risks duplicate content indexing. More important for content sites.",
    archetypeNotes: { content: "Content sites should have canonical URLs." },
  },
  mobile_app_links: {
    axis: "discoverability",
    label: "Mobile App Links",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "Deep links configured. Only relevant for sites with native apps. Informational — does not affect score.",
  },
  rss_feed: {
    axis: "discoverability",
    label: "RSS Feed",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "RSS enables syndication. Only relevant for content/blog sites. Informational — does not affect score.",
    archetypeNotes: { content: "Content sites should have RSS." },
  },
  hreflang: {
    axis: "discoverability",
    label: "Hreflang Tags",
    actionable: false,
    canBeNonGood: false,
    canBeGood: false,
    weightRange: [0, 0],
    promptGuidance:
      "International targeting tags. Only relevant for multi-language sites. Informational — does not affect score.",
  },
  favicon_missing: {
    axis: "discoverability",
    label: "No Favicon",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add favicon",
    fixDescription: "Add site favicon",
    weightRange: [1, 1],
    promptGuidance: "Minor polish issue. Low weight.",
  },
  title_tag_missing: {
    axis: "discoverability",
    label: "No Title Tag",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add title tag",
    fixDescription: "Add descriptive page title",
    weightRange: [1, 1],
    promptGuidance: "Hurts search visibility. Easy fix.",
  },
  title_tag_generic: {
    axis: "discoverability",
    label: "Generic Title Tag",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~10 min — write unique title",
    fixDescription: "Write a unique, descriptive page title",
    weightRange: [1, 1],
    promptGuidance: "Generic titles waste ranking potential.",
  },
  meta_description_missing: {
    axis: "discoverability",
    label: "No Meta Description",
    actionable: true,
    canBeNonGood: true,
    canBeGood: false,
    effort: "~5 min — add meta tag",
    fixDescription: "Add meta description tag",
    weightRange: [1, 1],
    promptGuidance: "Search engines generate own snippet. Having one is good practice.",
  },
  mobile_friendly: {
    axis: "discoverability",
    label: "Mobile Friendly",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~1 hour — add viewport meta",
    fixDescription: "Add responsive viewport configuration",
    weightRange: [2, 2],
    goodPrevalence: 0.893,
    promptGuidance: "Viewport meta is fundamental for mobile-first indexing. width=device-width is correct.",
    archetypeNotes: { infrastructure: "APIs may not need mobile-friendly design." },
    requiresHttpAccess: true,
  },
  og_completeness: {
    axis: "discoverability",
    label: "Open Graph Completeness",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~10 min — add OG meta tags",
    fixDescription: "Complete Open Graph meta tags",
    weightRange: [2, 2],
    goodPrevalence: 0.4,
    promptGuidance:
      "5 OG properties: title, description, image, url, type. Overlaps with social_meta — don't cite both.",
    archetypeNotes: {
      infrastructure: "API domains don't need OG tags.",
      application: "Apps behind login don't benefit.",
    },
    requiresHttpAccess: true,
  },
  accessibility: {
    axis: "discoverability",
    label: "Accessibility",
    actionable: true,
    canBeNonGood: true,
    canBeGood: true,
    effort: "~2-4 hours — fix WCAG issues",
    fixDescription: "Improve WCAG accessibility",
    weightRange: [1, 1],
    goodPrevalence: 0.361,
    promptGuidance:
      "Weight 1 but legal importance can be high. ≥80=good, 50-79=needs work, <50=poor. ADA (US), EAA (EU).",
    archetypeNotes: {
      institutional: "Government/education have higher legal obligations (Section 508).",
      corporate: "Increasing ADA litigation risk.",
    },
    requiresHttpAccess: true,
  },
  site_unreachable_visibility: {
    axis: "discoverability",
    label: "Site Unreachable (Visibility)",
    actionable: false,
    canBeNonGood: true,
    canBeGood: false,
    weightRange: [5, 5],
    promptGuidance: "Unreachable = zero visibility. Root cause is infrastructure.",
  },
};

// ─── Derived Constants ──────────────────────────────────────────────

/**
 * Detected context flags from a scan, used to exclude inapplicable signals
 * from normalization. E.g., cookieless sites shouldn't have cookie_security
 * counted in their max achievable score.
 */
export interface ScoringContext {
  cookies?: boolean;
  wordpress?: boolean;
  /** True when the HTTP probe was blocked (403/etc.), meaning header/content-based signals couldn't be assessed */
  httpBlocked?: boolean;
}

/** Precomputed max achievable good-bonus per axis (all contexts assumed present).
 *  Used by calibration tests. For per-scan scoring, use computeEffectiveMaxGoodWeight. */
export const AXIS_MAX_GOOD_WEIGHT: Record<Axis, number> = (() => {
  const result: Partial<Record<Axis, number>> = {};
  for (const [_key, def] of Object.entries(SIGNAL_REGISTRY)) {
    if (!def.canBeGood) continue;
    const axis = def.axis;
    result[axis] = (result[axis] ?? 0) + def.weightRange[1];
  }
  return result as Record<Axis, number>;
})();

/**
 * Compute effective max good weight per axis, excluding signals whose
 * requiresContext doesn't match what the scan detected.
 * Falls back to AXIS_MAX_GOOD_WEIGHT when no context is provided.
 */
export function computeEffectiveMaxGoodWeight(ctx?: ScoringContext): Record<Axis, number> {
  if (!ctx) return AXIS_MAX_GOOD_WEIGHT;
  const result: Partial<Record<Axis, number>> = {};
  for (const [_key, def] of Object.entries(SIGNAL_REGISTRY)) {
    if (!def.canBeGood) continue;
    // Skip signals that require a context not present in this scan
    if (def.requiresContext && !ctx[def.requiresContext]) continue;
    // Skip HTTP-dependent signals when the HTTP probe was blocked
    if (def.requiresHttpAccess && ctx.httpBlocked) continue;
    const axis = def.axis;
    result[axis] = (result[axis] ?? 0) + def.weightRange[1];
  }
  // Fill any missing axes with 0
  for (const axis of ["security", "speed", "foundations", "reputation", "discoverability", "email"] as Axis[]) {
    if (!(axis in result)) result[axis] = 0;
  }
  return result as Record<Axis, number>;
}

/** Signal IDs for signals that are non-actionable but CAN be non-good (i.e. should be excluded from Level-Up) */
export const NON_ACTIONABLE_SIGNALS: string[] = Object.entries(SIGNAL_REGISTRY)
  .filter(([, def]) => !def.actionable)
  .map(([id]) => id);

/** Non-actionable signals that can produce penalties (not just info/good) */
export const SCORE_DRAG_SIGNALS: string[] = Object.entries(SIGNAL_REGISTRY)
  .filter(([, def]) => !def.actionable && def.canBeNonGood)
  .map(([id]) => id);

/** All valid signal IDs */
export const SIGNAL_IDS = Object.keys(SIGNAL_REGISTRY);

/** Effort map keyed by signal ID */
export const EFFORT_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(SIGNAL_REGISTRY)
    .filter(([, def]) => def.effort)
    .map(([id, def]) => [id, def.effort!]),
);

/** Fix description map keyed by signal ID */
export const FIX_DESC_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(SIGNAL_REGISTRY)
    .filter(([, def]) => def.fixDescription)
    .map(([id, def]) => [id, def.fixDescription!]),
);

/** Compute tier from composite score */
export function tierFromComposite(score: number): string {
  for (const t of TIER_THRESHOLDS) {
    if (score >= t.min) return t.tier;
  }
  return "Critical";
}
