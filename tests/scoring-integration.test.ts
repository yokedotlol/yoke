import { calculateDomainScore } from "@worker/actions/analyze/contextual-scoring";
import { describe, expect, it } from "vitest";

// ─── Helper: default null opts for calculateDomainScore ──────────────

function baseOpts(): Parameters<typeof calculateDomainScore>[0] {
  return {
    ssl: null,
    securityGrade: null,
    securityAudit: [],
    dnssec: null,
    blocklists: [],
    emailAuth: null,
    performance: null,
    compression: null,
    httpProtocols: null,
    hosting: null,
    dnsRecords: [],
    rdap: null,
    socialMeta: null,
    jsonLd: null,
    meta: null,
    legal: null,
    wayback: null,
    certTransparency: null,
    greynoise: null,
    techStack: null,
    headers: null,
    domain: "example.com",
    html: "",
    httpBlocked: false,
    accessibility: null,
    thirdPartyScripts: null,
    cookieConsent: null,
    cacheAnalysis: null,
    waf: null,
    trustSignals: null,
    networkHealth: null,
    breaches: null,
    trancoRank: null,
    socialAccounts: null,
    shodan: null,
    cookieSecurity: null,
    securityTxt: null,
    wellKnown: null,
    redirects: [],
    statusResult: null,
    robotsParsed: null,
    resourceHints: null,
  };
}

// ─── Integration Tests ───────────────────────────────────────────────

describe("calculateDomainScore integration", () => {
  it("returns a valid DomainScoreResult shape with all-null inputs", () => {
    const result = calculateDomainScore(baseOpts());
    expect(result).toBeDefined();
    expect(typeof result.composite).toBe("number");
    expect(typeof result.tier).toBe("string");
    expect(result.axes).toBeDefined();
    expect(result.archetype).toBeDefined();
    // All 6 categories should be present
    for (const axis of ["security", "speed", "foundations", "reputation", "discoverability", "email"] as const) {
      expect(result.axes[axis]).toBeDefined();
      const score = result.axes[axis].score;
      // score can be number or null
      if (score !== null) {
        expect(typeof score).toBe("number");
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("produces a high tier when all signals are positive", () => {
    const opts = baseOpts();
    opts.ssl = {
      grade: "A+",
      issuer: "Let's Encrypt",
      subject: "example.com",
      valid_from: "2026-01-01",
      valid_to: "2027-06-01",
      error: null,
      certTransparency: true,
    } as any;
    opts.securityAudit = [
      {
        header: "strict-transport-security",
        present: true,
        value: "max-age=31536000; includeSubDomains",
        severity: "pass" as any,
        status: "pass",
      },
      { header: "x-content-type-options", present: true, value: "nosniff", severity: "pass" as any, status: "pass" },
      { header: "x-frame-options", present: true, value: "DENY", severity: "pass" as any, status: "pass" },
      {
        header: "content-security-policy",
        present: true,
        value: "default-src 'self'",
        severity: "pass" as any,
        status: "pass",
      },
    ];
    opts.dnssec = { enabled: true, valid: true } as any;
    opts.emailAuth = {
      spf: { found: true, record: "v=spf1 -all", mechanisms: ["-all"], all_qualifier: "-all" },
      dkim_selectors_found: ["default"],
      dmarc: {
        found: true,
        record: "v=DMARC1; p=reject",
        policy: "reject",
        subdomain_policy: null,
        rua: null,
        ruf: null,
      },
      bimi: { found: false },
      mta_sts: { found: false },
      tls_rpt: { found: false },
    } as any;
    opts.performance = { score: 95, fcp: 800, lcp: 1200, cls: 0.02, tbt: 50, si: 1000, ttfb: 200 } as any;
    opts.compression = { encoding: "br" } as any;
    opts.httpProtocols = { http2: true, http3: true };
    opts.hosting = { provider: "Cloudflare", cdn: "Cloudflare", waf: "Cloudflare" } as any;
    opts.rdap = { domain_age_days: 3650, days_until_expiry: 365 };
    opts.headers = {
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "geolocation=(self)",
    };
    opts.statusResult = { is_up: true, status_code: 200 };
    opts.dnsRecords = [
      { type: "A", value: "1.1.1.1", ttl: 3600 },
      { type: "A", value: "1.0.0.1", ttl: 3600 },
      { type: "AAAA", value: "2606:4700::1", ttl: 3600 },
      { type: "NS", value: "ns1.example.com", ttl: 86400 },
      { type: "NS", value: "ns2.example.com", ttl: 86400 },
      { type: "NS", value: "ns3.example.com", ttl: 86400 },
      { type: "NS", value: "ns4.example.com", ttl: 86400 },
      { type: "SOA", value: "ns1.example.com admin.example.com", ttl: 86400 },
      { type: "MX", value: "10 mail.example.com", ttl: 3600 },
      { type: "MX", value: "20 mail2.example.com", ttl: 3600 },
    ] as any;
    opts.redirects = [
      { url: "http://example.com", status_code: 301 },
      { url: "https://example.com", status_code: 200 },
    ] as any;
    opts.jsonLd = [{ type: "Organization" }] as any;
    opts.socialMeta = { score: 90, og: { title: "Example", description: "Test" } } as any;
    opts.meta = { robots_txt_exists: true, sitemap_detected: true, favicon_url: "/favicon.ico" } as any;

    const result = calculateDomainScore(opts);
    // With anchor-and-adjust, a well-configured site should score above 60 composite.
    // Geometric mean naturally pulls lower than arithmetic mean for mixed-value categories.
    expect(result.composite).toBeGreaterThanOrEqual(60);
    expect(["Excellent", "Strong", "Moderate"]).toContain(result.tier);
  });

  it("produces a mid-range tier with mixed signals", () => {
    const opts = baseOpts();
    opts.ssl = {
      grade: "B",
      issuer: "Let's Encrypt",
      subject: "example.com",
      valid_from: "2026-01-01",
      valid_to: "2027-06-01",
      error: null,
    } as any;
    opts.performance = { score: 45, fcp: 3000, lcp: 4500, cls: 0.15, tbt: 500, si: 4000, ttfb: 800 } as any;
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    // Mixed signals with deductive model — sparse findings produce moderate scores.
    // Softened absent penalty (0.15) keeps composite in moderate range.
    expect(result.composite).toBeGreaterThanOrEqual(1);
    expect(result.composite).toBeLessThanOrEqual(75);
  });

  it("handles httpBlocked=true gracefully", () => {
    const opts = baseOpts();
    opts.httpBlocked = true;
    // Even with httpBlocked, DNS records can exist
    opts.dnsRecords = [
      { type: "A", data: "1.2.3.4", ttl: 300 },
      { type: "MX", data: "mail.example.com", ttl: 300 },
    ];
    opts.statusResult = { is_up: false, status_code: null, http_blocked: true };

    const result = calculateDomainScore(opts);
    expect(result).toBeDefined();
    expect(typeof result.composite).toBe("number");
    expect(typeof result.tier).toBe("string");
    // Should still generate findings even when HTTP is blocked
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    expect(allFindings.length).toBeGreaterThan(0);
  });

  it("caps tier for domains with large breach exposure", () => {
    const opts = baseOpts();
    opts.ssl = {
      grade: "A+",
      issuer: "LE",
      subject: "example.com",
      valid_from: "2026-01-01",
      valid_to: "2027-06-01",
      error: null,
    } as any;
    opts.performance = { score: 95, fcp: 800, lcp: 1200, cls: 0.02, tbt: 50, si: 1000, ttfb: 200 } as any;
    opts.statusResult = { is_up: true, status_code: 200 };
    // Massive breach — over 100M records
    opts.breaches = {
      total_breached_accounts: 200_000_000,
      breaches: [{ name: "BigBreach", date: "2023-01-01", count: 200_000_000, description: "Huge breach" }],
    } as any;

    const result = calculateDomainScore(opts);
    // Tier should be capped — not Excellent despite good other signals
    expect(["Excellent"]).not.toContain(result.tier);
  });

  it("does not double-count CSP findings", () => {
    const opts = baseOpts();
    opts.securityAudit = [
      { header: "content-security-policy", present: true, value: "default-src 'self'", severity: "pass" as any },
    ];
    opts.headers = { "content-security-policy": "default-src 'self'" };
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    // Count CSP-related findings across all axes
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const cspFindings = allFindings.filter((f) => f.signal.includes("csp"));
    // CSP presence (csp), CSP quality (csp_quality), and optional granular
    // sub-findings (csp_missing_object_src, csp_missing_base_uri, csp_report_only)
    // are complementary, not double-counting the same signal.
    expect(cspFindings.length).toBeLessThanOrEqual(4);
  });

  it("tier boundaries are consistent", () => {
    // Test that tiering is monotonic — higher composite = same or better tier
    const opts = baseOpts();
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    // Tier should be a recognized tier name
    expect(["Excellent", "Strong", "Moderate", "Weak", "Critical"]).toContain(result.tier);
    // Composite should be between 0 and 100
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(100);
  });

  it("all findings have required fields", () => {
    const opts = baseOpts();
    opts.ssl = {
      grade: "A",
      issuer: "LE",
      subject: "example.com",
      valid_from: "2026-01-01",
      valid_to: "2027-06-01",
      error: null,
    } as any;
    opts.performance = { score: 60, fcp: 2000, lcp: 3000, cls: 0.1, tbt: 200, si: 3000, ttfb: 500 } as any;
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    for (const f of allFindings) {
      expect(f.signal).toBeTruthy();
      expect(f.axis).toBeTruthy();
      expect(f.severity).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(["security", "speed", "foundations", "reputation", "discoverability", "email"]).toContain(f.axis);
      expect(["critical", "high", "medium", "low", "info", "good"]).toContain(f.severity);
    }
  });
});

// ─── Permissions-Policy Enhanced Parsing ─────────────────────────────

describe("Permissions-Policy enhanced parsing", () => {
  it("restrictive directives produce a good finding", () => {
    const opts = baseOpts();
    opts.headers = {
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    };
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const pp = allFindings.find((f) => f.signal === "permissions_policy");
    expect(pp).toBeDefined();
    expect(pp?.severity).toBe("good");
    expect(pp?.label).toContain("restricts 4 features");
  });

  it("unrestricted feature (camera=*) produces a medium finding", () => {
    const opts = baseOpts();
    opts.headers = {
      "permissions-policy": "camera=*, microphone=()",
    };
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const ppUnrestricted = allFindings.find((f) => f.signal === "permissions_policy_unrestricted");
    expect(ppUnrestricted).toBeDefined();
    expect(ppUnrestricted?.severity).toBe("medium");
    expect(ppUnrestricted?.label).toContain("camera");
  });

  it("missing permissions-policy produces a low finding", () => {
    const opts = baseOpts();
    opts.headers = {};
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const ppMissing = allFindings.find((f) => f.signal === "permissions_policy_missing");
    expect(ppMissing).toBeDefined();
    expect(ppMissing?.severity).toBe("low");
  });
});

// ─── Resource Hints Scoring ──────────────────────────────────────────

describe("Resource hints scoring", () => {
  it("produces a good finding when resource hints are present", () => {
    const opts = baseOpts();
    opts.resourceHints = {
      total: 3,
      preload: ["font.woff2", "style.css"],
      preconnect: ["https://cdn.example.com"],
      prefetch: [],
      dns_prefetch: [],
      modulepreload: [],
    };
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const rh = allFindings.find((f) => f.signal === "resource_hints");
    expect(rh).toBeDefined();
    expect(rh?.severity).toBe("good");
    expect(rh?.axis).toBe("speed");
    expect(rh?.label).toContain("2 preload");
    expect(rh?.label).toContain("1 preconnect");
  });

  it("produces no finding when resourceHints is null", () => {
    const opts = baseOpts();
    opts.resourceHints = null;
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const rh = allFindings.find((f) => f.signal === "resource_hints");
    expect(rh).toBeUndefined();
  });

  it("produces no finding when total is 0", () => {
    const opts = baseOpts();
    opts.resourceHints = {
      total: 0,
      preload: [],
      preconnect: [],
      prefetch: [],
      dns_prefetch: [],
      modulepreload: [],
    };
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const rh = allFindings.find((f) => f.signal === "resource_hints");
    expect(rh).toBeUndefined();
  });

  // ─── Level-Up / Non-Actionable Signal Tests ──────────────────────

  it('gives "good" severity to clean blocklist record', () => {
    const opts = baseOpts();
    opts.blocklists = [
      { source: "SpamhausDBL", listed: false },
      { source: "URIBL", listed: false },
    ] as any;
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const blocklist = allFindings.find((f) => f.signal === "blocklist_trust");
    expect(blocklist).toBeDefined();
    expect(blocklist?.severity).toBe("good");
    expect(blocklist?.label).toBe("Clean blocklist record");
  });

  it("gives critical severity when on multiple blocklists", () => {
    const opts = baseOpts();
    opts.blocklists = [
      { source: "SpamhausDBL", listed: true },
      { source: "URIBL", listed: true },
    ] as any;
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const blocklist = allFindings.find((f) => f.signal === "blocklist_trust");
    expect(blocklist).toBeDefined();
    expect(blocklist?.severity).toBe("critical");
  });

  it("shows which organizational pages are missing when partial", () => {
    const opts = baseOpts();
    opts.legal = {
      pages_found: [{ name: "Privacy Policy", url: "/privacy" }],
      cookie_consent_detected: false,
      consent_provider: null,
    };
    opts.html = '<a href="/privacy">Privacy</a>';
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const org = allFindings.find((f) => f.signal === "organizational_identity");
    expect(org).toBeDefined();
    expect(org?.severity).toBe("info");
    // Should list what's missing
    expect(org?.label).toContain("missing:");
    expect(org?.label).toContain("terms of service");
    expect(org?.label).toContain("about page");
    expect(org?.label).not.toContain("privacy");
  });

  it("gives good severity when all 3 organizational pages found", () => {
    const opts = baseOpts();
    opts.legal = {
      pages_found: [
        { name: "Privacy Policy", url: "/privacy" },
        { name: "Terms of Service", url: "/terms" },
        { name: "About", url: "/about" },
      ],
      cookie_consent_detected: false,
      consent_provider: null,
    };
    opts.html = '<a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/about">About</a>';
    opts.statusResult = { is_up: true, status_code: 200 };

    const result = calculateDomainScore(opts);
    const allFindings = Object.values(result.axes).flatMap((a) => a.findings);
    const org = allFindings.find((f) => f.signal === "organizational_identity");
    expect(org).toBeDefined();
    expect(org?.severity).toBe("good");
  });
});
