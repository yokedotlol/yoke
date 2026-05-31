// ─── Signal Registry Enforcement Tests ───────────────────────────────
// Ensures the signal registry stays in sync with the scoring engine,
// and derived constants (NON_ACTIONABLE, EFFORT_MAP, etc.) are correct.

import { calculateDomainScore } from "@worker/actions/analyze/contextual-scoring";
import {
  AXIS_WEIGHTS,
  EFFORT_MAP,
  FIX_DESC_MAP,
  GRADE_THRESHOLDS,
  gradeFromComposite,
  NON_ACTIONABLE_SIGNALS,
  SEVERITY_SCORES,
  SIGNAL_IDS,
  SIGNAL_REGISTRY,
} from "@worker/config/signal-registry";
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

describe("Signal Registry", () => {
  it("every signal emitted by scoring with null inputs exists in the registry", () => {
    const result = calculateDomainScore(baseOpts());
    const emittedSignals = new Set<string>();
    for (const axis of Object.values(result.axes)) {
      if (axis.findings) {
        for (const f of axis.findings) {
          emittedSignals.add(f.signal);
        }
      }
    }
    for (const sig of emittedSignals) {
      expect(SIGNAL_REGISTRY[sig], `Signal "${sig}" emitted by scoring but missing from registry`).toBeDefined();
    }
  });

  it("every signal emitted by scoring with rich inputs exists in the registry", () => {
    const opts = baseOpts();
    // Provide some data to exercise more signal paths
    opts.ssl = {
      valid: true,
      issuer: "Let's Encrypt",
      subject: "example.com",
      validFrom: new Date(Date.now() - 86400000 * 30).toISOString(),
      validTo: new Date(Date.now() + 86400000 * 300).toISOString(),
      protocol: "TLSv1.3",
      sans: ["example.com", "*.example.com"],
      serialNumber: "abc123",
      fingerprint: "AA:BB:CC",
      keySize: 2048,
      signatureAlgorithm: "SHA256withRSA",
      certChain: [],
    } as any;
    opts.dnsRecords = [
      { type: "A", name: "example.com", value: "1.2.3.4", ttl: 300 },
      { type: "AAAA", name: "example.com", value: "::1", ttl: 300 },
      { type: "NS", name: "example.com", value: "ns1.example.com", ttl: 3600 },
      { type: "NS", name: "example.com", value: "ns2.example.com", ttl: 3600 },
      { type: "MX", name: "example.com", value: "mail.example.com", ttl: 3600, priority: 10 },
      { type: "MX", name: "example.com", value: "mail2.example.com", ttl: 3600, priority: 20 },
    ] as any;
    opts.emailAuth = {
      spf: { found: true, record: "v=spf1 include:_spf.google.com ~all", mechanisms: [], all_qualifier: "~all" },
      dmarc: {
        found: true,
        record: "v=DMARC1; p=reject",
        policy: "reject",
        subdomain_policy: null,
        rua: null,
        ruf: null,
      },
      dkim_selectors_found: ["google"],
      bimi: { found: false, record: null, logo_url: null },
      mta_sts: { found: false, mode: null, mx: [], max_age: null },
      tls_rpt: { found: false, rua: [] },
    } as any;
    opts.headers = {
      "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
      "content-security-policy": "default-src 'self'",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    } as any;
    opts.rdap = {
      registrationDate: new Date(Date.now() - 86400000 * 365 * 5).toISOString(),
      expirationDate: new Date(Date.now() + 86400000 * 365 * 2).toISOString(),
      registrar: "Test Registrar",
    } as any;

    const result = calculateDomainScore(opts);
    const emittedSignals = new Set<string>();
    for (const axis of Object.values(result.axes)) {
      if (axis.findings) {
        for (const f of axis.findings) {
          emittedSignals.add(f.signal);
        }
      }
    }
    for (const sig of emittedSignals) {
      expect(SIGNAL_REGISTRY[sig], `Signal "${sig}" emitted by scoring but missing from registry`).toBeDefined();
    }
  });

  it("every actionable canBeNonGood signal has effort and fixDescription", () => {
    for (const [id, def] of Object.entries(SIGNAL_REGISTRY)) {
      if (def.actionable && def.canBeNonGood) {
        expect(def.effort, `Signal "${id}" is actionable+canBeNonGood but has no effort`).toBeTruthy();
        expect(def.fixDescription, `Signal "${id}" is actionable+canBeNonGood but has no fixDescription`).toBeTruthy();
      }
    }
  });

  it("NON_ACTIONABLE_SIGNALS matches all non-actionable signals in registry", () => {
    const expected = Object.entries(SIGNAL_REGISTRY)
      .filter(([, def]) => !def.actionable)
      .map(([id]) => id)
      .sort();
    expect([...NON_ACTIONABLE_SIGNALS].sort()).toEqual(expected);
  });

  it("GRADE_THRESHOLDS are sorted descending by min", () => {
    for (let i = 0; i < GRADE_THRESHOLDS.length - 1; i++) {
      expect(GRADE_THRESHOLDS[i].min).toBeGreaterThan(GRADE_THRESHOLDS[i + 1].min);
    }
  });

  it("no duplicate signal IDs", () => {
    const ids = Object.keys(SIGNAL_REGISTRY);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("every signal ID follows naming convention (lowercase, underscores, no spaces)", () => {
    for (const id of SIGNAL_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("EFFORT_MAP has entries for all actionable canBeNonGood signals", () => {
    for (const [id, def] of Object.entries(SIGNAL_REGISTRY)) {
      if (def.actionable && def.canBeNonGood) {
        expect(EFFORT_MAP[id], `Signal "${id}" missing from EFFORT_MAP`).toBeTruthy();
      }
    }
  });

  it("FIX_DESC_MAP has entries for all actionable canBeNonGood signals", () => {
    for (const [id, def] of Object.entries(SIGNAL_REGISTRY)) {
      if (def.actionable && def.canBeNonGood) {
        expect(FIX_DESC_MAP[id], `Signal "${id}" missing from FIX_DESC_MAP`).toBeTruthy();
      }
    }
  });

  it("gradeFromComposite matches GRADE_THRESHOLDS", () => {
    // Test boundary values
    expect(gradeFromComposite(100)).toBe("A+");
    expect(gradeFromComposite(92)).toBe("A+");
    expect(gradeFromComposite(87)).toBe("A");
    expect(gradeFromComposite(82)).toBe("A");
    expect(gradeFromComposite(81)).toBe("B+");
    expect(gradeFromComposite(76)).toBe("B+");
    expect(gradeFromComposite(75)).toBe("B");
    expect(gradeFromComposite(70)).toBe("B");
    expect(gradeFromComposite(69)).toBe("C+");
    expect(gradeFromComposite(64)).toBe("C+");
    expect(gradeFromComposite(63)).toBe("C");
    expect(gradeFromComposite(58)).toBe("C");
    expect(gradeFromComposite(57)).toBe("D+");
    expect(gradeFromComposite(50)).toBe("D+");
    expect(gradeFromComposite(49)).toBe("D");
    expect(gradeFromComposite(40)).toBe("D");
    expect(gradeFromComposite(39)).toBe("F");
    expect(gradeFromComposite(0)).toBe("F");
  });

  it("SEVERITY_SCORES has all severity levels", () => {
    expect(SEVERITY_SCORES.critical).toBe(0);
    expect(SEVERITY_SCORES.high).toBe(15);
    expect(SEVERITY_SCORES.medium).toBe(40);
    expect(SEVERITY_SCORES.low).toBe(65);
    expect(SEVERITY_SCORES.info).toBe(82);
    expect(SEVERITY_SCORES.good).toBe(100);
  });

  it("AXIS_WEIGHTS sum to 1.0", () => {
    const sum = Object.values(AXIS_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("AXIS_WEIGHTS has all 6 categories", () => {
    expect(AXIS_WEIGHTS).toHaveProperty("security");
    expect(AXIS_WEIGHTS).toHaveProperty("speed");
    expect(AXIS_WEIGHTS).toHaveProperty("foundations");
    expect(AXIS_WEIGHTS).toHaveProperty("reputation");
    expect(AXIS_WEIGHTS).toHaveProperty("discoverability");
    expect(AXIS_WEIGHTS).toHaveProperty("email");
  });

  it("registry contains exactly 142 signals", () => {
    expect(SIGNAL_IDS.length).toBe(142);
  });
});
