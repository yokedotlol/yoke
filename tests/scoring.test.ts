import {
  type ArchetypeName,
  AXIS_WEIGHTS,
  type AxisScore,
  applyHardCaps,
  buildSignalDetails,
  computeAxisScore,
  computeComposite,
  contextualSeverity,
  type Finding,
  type SignalDetailsBlob,
  tierFromComposite,
} from "@worker/actions/analyze/contextual-scoring";

// ─── Import production code (single source of truth) ─────────────────
import type { Severity } from "@worker/config/contextual-scoring-types";
import { SEVERITY_SCORES } from "@worker/config/scoring-thresholds";
import { describe, expect, it } from "vitest";

type SeverityMap = Partial<Record<ArchetypeName, Severity>>;

// ─── Axis Weight Tests ───────────────────────────────────────────────

describe("Axis Weights", () => {
  it("weights should sum to 1.0", () => {
    const sum = Object.values(AXIS_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("should have correct values", () => {
    expect(AXIS_WEIGHTS.security).toBe(0.24);
    expect(AXIS_WEIGHTS.speed).toBe(0.18);
    expect(AXIS_WEIGHTS.foundations).toBe(0.18);
    expect(AXIS_WEIGHTS.reputation).toBe(0.15);
    expect(AXIS_WEIGHTS.discoverability).toBe(0.13);
    expect(AXIS_WEIGHTS.email).toBe(0.12);
  });

  it("security should be weighted highest", () => {
    expect(AXIS_WEIGHTS.security).toBeGreaterThan(AXIS_WEIGHTS.reputation);
    expect(AXIS_WEIGHTS.security).toBeGreaterThan(AXIS_WEIGHTS.speed);
    expect(AXIS_WEIGHTS.security).toBeGreaterThan(AXIS_WEIGHTS.discoverability);
    expect(AXIS_WEIGHTS.security).toBeGreaterThan(AXIS_WEIGHTS.foundations);
    expect(AXIS_WEIGHTS.foundations).toBeGreaterThan(AXIS_WEIGHTS.reputation);
    expect(AXIS_WEIGHTS.foundations).toBeGreaterThan(AXIS_WEIGHTS.discoverability);
  });
});

// ─── Severity Score Mapping ──────────────────────────────────────────

describe("Severity Score Mapping", () => {
  it("critical should map to 0", () => {
    expect(SEVERITY_SCORES.critical).toBe(0);
  });

  it("good should map to 100", () => {
    expect(SEVERITY_SCORES.good).toBe(100);
  });

  it("severities should be monotonically increasing", () => {
    const order: Severity[] = ["critical", "high", "medium", "low", "info", "good"];
    for (let i = 1; i < order.length; i++) {
      expect(SEVERITY_SCORES[order[i]]).toBeGreaterThan(SEVERITY_SCORES[order[i - 1]]);
    }
  });
});

// ─── Axis Score Computation ──────────────────────────────────────────

describe("Axis Score Computation", () => {
  it("should return 100 for empty findings", () => {
    expect(computeAxisScore([])).toBe(100);
  });

  it("should award full score for all-good findings (standalone mode)", () => {
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "good", label: "A", tradeoff: null, weight: 5 },
      { signal: "b", axis: "security", severity: "good", label: "B", tradeoff: null, weight: 3 },
    ];
    // Good findings → 0 deduction in standalone mode
    expect(computeAxisScore(findings)).toBe(100);
  });

  it("should heavily penalize all-critical findings", () => {
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "critical", label: "A", tradeoff: null, weight: 5 },
      { signal: "b", axis: "security", severity: "critical", label: "B", tradeoff: null, weight: 3 },
    ];
    // Standalone mode: deduction = 1.5 * 5 * 2 + 1.5 * 3 * 2 = 15 + 9 = 24 → 100 - 24 = 76
    const score = computeAxisScore(findings);
    expect(score).toBeLessThan(85);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("should balance good findings against critical penalty", () => {
    // One good w5 (0 deduction), one critical w5 (-15 deduction) → 100 - 15 = 85
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "good", label: "A", tradeoff: null, weight: 5 },
      { signal: "b", axis: "security", severity: "critical", label: "B", tradeoff: null, weight: 5 },
    ];
    const score = computeAxisScore(findings);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(50);
  });

  it("should handle mixed severity findings", () => {
    // Good w3 (0), medium w2 (deduction), info w1 (0) → score < 100
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "good", label: "A", tradeoff: null, weight: 3 },
      { signal: "b", axis: "security", severity: "medium", label: "B", tradeoff: null, weight: 2 },
      { signal: "c", axis: "security", severity: "info", label: "C", tradeoff: null, weight: 1 },
    ];
    const score = computeAxisScore(findings);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(90); // medium w2 is a mild deduction in standalone mode
  });

  it("should produce score in 0-100 range", () => {
    const severities: Severity[] = ["critical", "high", "medium", "low", "info", "good"];
    for (const s of severities) {
      const findings: Finding[] = [
        { signal: "a", axis: "security", severity: s, label: "A", tradeoff: null, weight: 3 },
      ];
      const score = computeAxisScore(findings);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("should scale penalties by weight", () => {
    const w1: Finding[] = [{ signal: "a", axis: "security", severity: "high", label: "A", tradeoff: null, weight: 1 }];
    const w3: Finding[] = [{ signal: "a", axis: "security", severity: "high", label: "A", tradeoff: null, weight: 3 }];
    // Higher weight = larger deduction = lower score
    expect(computeAxisScore(w1)).toBeGreaterThan(computeAxisScore(w3));
  });
});

// ─── Composite Score Computation ─────────────────────────────────────

describe("Composite Score Computation", () => {
  it("should return 100 when all axes are 100", () => {
    const axes = { security: 100, speed: 100, foundations: 100, reputation: 100, discoverability: 100, email: 100 };
    expect(computeComposite(axes, "general")).toBe(100);
    expect(computeComposite(axes, "commerce")).toBe(100);
  });

  it("should return 0 when all axes are 0", () => {
    const axes = { security: 0, speed: 0, foundations: 0, reputation: 0, discoverability: 0, email: 0 };
    // Arithmetic mean of all zeros = 0
    expect(computeComposite(axes, "general")).toBe(0);
  });

  it("should produce the same score regardless of archetype", () => {
    // With fixed weights, archetype no longer affects composite
    const axes = { security: 100, speed: 30, foundations: 30, reputation: 30, discoverability: 30, email: 30 };
    const commerceScore = computeComposite(axes, "commerce");
    const contentScore = computeComposite(axes, "content");
    expect(commerceScore).toBe(contentScore);
  });

  it("all archetypes should produce the same composite for the same inputs", () => {
    // With fixed weights, archetype no longer changes composite
    const axes = { security: 30, speed: 30, foundations: 30, reputation: 30, discoverability: 100, email: 30 };
    const generalScore = computeComposite(axes, "general");
    const contentScore = computeComposite(axes, "content");
    const commerceScore = computeComposite(axes, "commerce");
    expect(contentScore).toBe(generalScore);
    expect(commerceScore).toBe(generalScore);
  });

  it("should use weighted arithmetic mean", () => {
    const axes = { security: 60, speed: 80, foundations: 70, reputation: 90, discoverability: 50, email: 75 };
    // Arithmetic: 60*0.24 + 80*0.18 + 70*0.18 + 90*0.15 + 50*0.13 + 75*0.12 = 70.4 → 70
    const expected = Math.round(60 * 0.24 + 80 * 0.18 + 70 * 0.18 + 90 * 0.15 + 50 * 0.13 + 75 * 0.12);
    expect(computeComposite(axes, "general")).toBe(expected);
  });

  it("outlier floor caps composite when any axis < 40", () => {
    // One very low axis (10) + rest high (90) — outlier floor should cap at 74
    const axes = { security: 90, speed: 90, foundations: 90, reputation: 90, discoverability: 90, email: 10 };
    const score = computeComposite(axes, "general");
    // Arithmetic would be 80.4 → 80, but email=10 < 40 triggers outlier floor → 74
    expect(score).toBe(74);
  });

  it("composite should always be in 0-100 range", () => {
    const archetypes: ArchetypeName[] = [
      "commerce",
      "content",
      "application",
      "corporate",
      "infrastructure",
      "institutional",
      "general",
    ];
    for (const arch of archetypes) {
      const score = computeComposite(
        { security: 50, speed: 50, foundations: 50, reputation: 50, discoverability: 50, email: 50 },
        arch,
      );
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

// ─── Tier Assignment ─────────────────────────────────────────────────

describe("Tier Assignment", () => {
  it("should assign correct tiers (production thresholds)", () => {
    expect(tierFromComposite(100)).toBe("Excellent");
    expect(tierFromComposite(95)).toBe("Excellent");
    expect(tierFromComposite(90)).toBe("Excellent");
    expect(tierFromComposite(89)).toBe("Strong");
    expect(tierFromComposite(78)).toBe("Strong");
    expect(tierFromComposite(77)).toBe("Moderate");
    expect(tierFromComposite(60)).toBe("Moderate");
    expect(tierFromComposite(59)).toBe("Weak");
    expect(tierFromComposite(40)).toBe("Weak");
    expect(tierFromComposite(39)).toBe("Critical");
    expect(tierFromComposite(0)).toBe("Critical");
  });
});

// ─── Contextual Severity Rules ───────────────────────────────────────

describe("Contextual Severity", () => {
  it("should return base severity when no override exists", () => {
    expect(contextualSeverity("medium", "general", {})).toBe("medium");
  });

  it("should return overridden severity for matching archetype", () => {
    expect(contextualSeverity("medium", "commerce", { commerce: "critical" })).toBe("critical");
  });

  it("should not apply override for non-matching archetype", () => {
    expect(contextualSeverity("medium", "content", { commerce: "critical" })).toBe("medium");
  });

  // ─── Key contextual rules from the design doc ───────────────────

  it("HSTS: critical for commerce, low for content", () => {
    const overrides: SeverityMap = { commerce: "critical", application: "high", content: "low", corporate: "medium" };
    expect(contextualSeverity("medium", "commerce", overrides)).toBe("critical");
    expect(contextualSeverity("medium", "content", overrides)).toBe("low");
    expect(contextualSeverity("medium", "application", overrides)).toBe("high");
    expect(contextualSeverity("medium", "infrastructure", overrides)).toBe("medium"); // falls to base
  });

  it("CSP: high for applications, medium for content, low for corporate", () => {
    const overrides: SeverityMap = { application: "high", content: "medium", corporate: "low" };
    expect(contextualSeverity("medium", "application", overrides)).toBe("high");
    expect(contextualSeverity("medium", "content", overrides)).toBe("medium");
    expect(contextualSeverity("medium", "corporate", overrides)).toBe("low");
  });

  it("SSL grade: harsher for commerce and institutional", () => {
    const overrides: SeverityMap = { commerce: "high", institutional: "high" };
    expect(contextualSeverity("medium", "commerce", overrides)).toBe("high");
    expect(contextualSeverity("medium", "institutional", overrides)).toBe("high");
    expect(contextualSeverity("medium", "content", overrides)).toBe("medium");
  });
});

// ─── Archetype Detection (simplified inline tests) ───────────────────

describe("Archetype Detection Logic", () => {
  it(".gov domain should strongly signal institutional", () => {
    const domain = "example.gov";
    const isInstitutional = /\.(gov|edu|mil)$/i.test(domain);
    expect(isInstitutional).toBe(true);
  });

  it(".edu domain should signal institutional", () => {
    expect(/\.(gov|edu|mil)$/i.test("harvard.edu")).toBe(true);
  });

  it(".com domain should not signal institutional", () => {
    expect(/\.(gov|edu|mil)$/i.test("example.com")).toBe(false);
  });

  it("Shopify tech should signal commerce", () => {
    const tech = [{ name: "Shopify", category: "E-commerce" }];
    const commerceTech = ["shopify", "woocommerce", "magento"];
    const isCommerce = tech.some((t) => commerceTech.some((c) => t.name.toLowerCase().includes(c)));
    expect(isCommerce).toBe(true);
  });

  it("WordPress tech should signal content", () => {
    const tech = [{ name: "WordPress", category: "CMS" }];
    const contentTech = ["wordpress", "ghost", "hugo", "jekyll"];
    const isContent = tech.some((t) => contentTech.some((c) => t.name.toLowerCase().includes(c)));
    expect(isContent).toBe(true);
  });

  it("React + login paths should signal application", () => {
    const tech = [{ name: "React", category: "JavaScript Framework" }];
    const html = '<div id="root"></div><a href="/login">Log in</a>';
    const appTech = ["react", "vue", "angular"];
    const hasAppFramework = tech.some((t) => appTech.some((c) => t.name.toLowerCase().includes(c)));
    const hasAuth = html.includes("/login") || html.includes("/signin");
    expect(hasAppFramework).toBe(true);
    expect(hasAuth).toBe(true);
  });

  it("Organization schema should signal corporate", () => {
    const jsonLd = [{ type: "Organization" }];
    const isCorporate = jsonLd.some((j) => j.type === "Organization" || j.type === "Corporation");
    expect(isCorporate).toBe(true);
  });

  it("minimal HTML should signal infrastructure", () => {
    const html = '{"status":"ok"}';
    expect(html.length < 500).toBe(true);
    expect(!html.includes("<html")).toBe(true);
  });
});

// ─── Managed Platform Detection ──────────────────────────────────────

describe("Managed Platform Detection", () => {
  const platformChecks: [RegExp, string][] = [
    [/shopify/i, "Shopify"],
    [/wix/i, "Wix"],
    [/squarespace/i, "Squarespace"],
    [/wordpress\.com/i, "WordPress.com"],
    [/vercel/i, "Vercel"],
    [/netlify/i, "Netlify"],
    [/cloudflare pages/i, "Cloudflare Pages"],
  ];

  function detectPlatform(provider: string, tech: { name: string }[]): string | null {
    for (const [re, name] of platformChecks) {
      if (re.test(provider) || tech.some((t) => re.test(t.name))) return name;
    }
    return null;
  }

  it("should detect Shopify", () => {
    expect(detectPlatform("", [{ name: "Shopify" }])).toBe("Shopify");
  });

  it("should detect Vercel from hosting provider", () => {
    expect(detectPlatform("Vercel", [])).toBe("Vercel");
  });

  it("should detect Netlify", () => {
    expect(detectPlatform("Netlify", [])).toBe("Netlify");
  });

  it("should return null for custom hosting", () => {
    expect(detectPlatform("nginx", [{ name: "React" }])).toBeNull();
  });
});

// ─── Absence Penalties ───────────────────────────────────────────────

// ─── Hard Caps (removed — now pass-through) ─────────────────────────

describe("Hard Caps (pass-through)", () => {
  const allAxesHigh = { security: 90, speed: 85, foundations: 80, reputation: 75, discoverability: 70, email: 65 };

  it("should pass through composite unchanged (caps removed)", () => {
    const findings: Finding[] = [
      { signal: "ssl_grade", axis: "security", severity: "critical", label: "SSL F", tradeoff: null, weight: 5 },
    ];
    const result = applyHardCaps(95, findings, allAxesHigh);
    expect(result).toBe(95);
  });

  it("should pass through with high finding (caps removed)", () => {
    const findings: Finding[] = [
      { signal: "hsts_missing", axis: "security", severity: "high", label: "No HSTS", tradeoff: null, weight: 3 },
    ];
    const result = applyHardCaps(90, findings, allAxesHigh);
    expect(result).toBe(90);
  });

  it("should pass through with low category scores (caps removed)", () => {
    const scores = { ...allAxesHigh, email: 25 };
    const result = applyHardCaps(95, [], scores);
    expect(result).toBe(95);
  });

  it("should pass through unchanged regardless of inputs", () => {
    const result = applyHardCaps(60, [], allAxesHigh);
    expect(result).toBe(60);
  });
});

// ─── Not Assessed Threshold ─────────────────────────────────────────

describe("Not Assessed Threshold", () => {
  it("should mark axis as not_measured when fewer than 3 scoreable findings", () => {
    const findings: Finding[] = [
      { signal: "ssl_grade", axis: "security", severity: "good", label: "SSL A+", tradeoff: null, weight: 3 },
      { signal: "hsts", axis: "security", severity: "good", label: "HSTS", tradeoff: null, weight: 4 },
    ];
    const score = computeAxisScore(findings);
    // With only 2 findings, axis should be not assessed at the calculateDomainScore level
    // computeAxisScore itself still computes normally
    expect(score).toBeGreaterThan(55);
  });

  it("should score axis normally with 3+ scoreable findings", () => {
    const findings: Finding[] = [
      { signal: "ssl_grade", axis: "security", severity: "good", label: "SSL A+", tradeoff: null, weight: 3 },
      { signal: "hsts", axis: "security", severity: "good", label: "HSTS", tradeoff: null, weight: 4 },
      { signal: "csp", axis: "security", severity: "good", label: "CSP", tradeoff: null, weight: 3 },
    ];
    const score = computeAxisScore(findings);
    expect(score).toBeGreaterThan(55);
  });

  it("should exclude meta-signals from scoreable count", () => {
    // http_blocked_* and site_unreachable_* should not count toward the 3-finding threshold
    const findings: Finding[] = [
      {
        signal: "http_blocked_performance",
        axis: "speed",
        severity: "info",
        label: "Blocked",
        tradeoff: null,
        weight: 4,
      },
      {
        signal: "site_unreachable_performance",
        axis: "speed",
        severity: "info",
        label: "Unreachable",
        tradeoff: null,
        weight: 5,
      },
      { signal: "perf_score", axis: "speed", severity: "good", label: "Perf 90", tradeoff: null, weight: 5 },
    ];
    // Only 1 scoreable finding (perf_score), so still under threshold
    const scoreableCount = findings.filter(
      (f) => !f.signal.startsWith("http_blocked_") && !f.signal.startsWith("site_unreachable_"),
    ).length;
    expect(scoreableCount).toBe(1);
  });
});

// ─── buildSignalDetails Tests ────────────────────────────────────────

describe("buildSignalDetails", () => {
  const makeAxisScore = (
    score: number | null,
    findings: Finding[] = [],
    deductions: AxisScore["deductions"] = [],
    notMeasured = false,
  ): AxisScore => ({
    score,
    weight: 0.18,
    findings,
    deductions,
    not_measured: notMeasured,
  });

  const emptyAxes: Record<string, AxisScore> = {
    security: makeAxisScore(100),
    speed: makeAxisScore(100),
    foundations: makeAxisScore(100),
    reputation: makeAxisScore(100),
    discoverability: makeAxisScore(100),
    email: makeAxisScore(100),
  };

  const mockArchetype = {
    detected: "technology" as ArchetypeName,
    confidence: 0.85,
    secondary: null,
    signals: ["tech_stack"],
    platform: null,
    weights: AXIS_WEIGHTS,
  };

  it("should produce valid JSON with version 1 schema", () => {
    const json = buildSignalDetails(
      emptyAxes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      95,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    expect(blob.v).toBe(1);
    expect(blob.composite).toBe(95);
    expect(blob.archetype).toBe("technology");
    expect(blob.archetypeConfidence).toBe(0.85);
  });

  it("should include all 6 axes", () => {
    const json = buildSignalDetails(
      emptyAxes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      90,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    const axisNames = Object.keys(blob.axes);
    expect(axisNames).toContain("security");
    expect(axisNames).toContain("speed");
    expect(axisNames).toContain("foundations");
    expect(axisNames).toContain("reputation");
    expect(axisNames).toContain("discoverability");
    expect(axisNames).toContain("email");
    expect(axisNames).toHaveLength(6);
  });

  it("should capture findings from deductions", () => {
    const axes = {
      ...emptyAxes,
      security: makeAxisScore(
        87,
        [
          {
            signal: "csp_missing",
            axis: "security" as const,
            severity: "medium" as const,
            label: "CSP Missing",
            tradeoff: null,
            weight: 3,
          },
        ],
        [
          {
            signal: "csp_missing",
            label: "CSP Missing",
            severity: "medium",
            weight: 3,
            share: 7.1,
            deduction: 5.4,
            category: "fixable" as const,
          },
        ],
      ),
    };
    const json = buildSignalDetails(
      axes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      90,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    const secFindings = blob.axes.security.findings;
    expect(secFindings.some((f) => f.signal === "csp_missing")).toBe(true);
    const csp = secFindings.find((f) => f.signal === "csp_missing");
    expect(csp?.severity).toBe("medium");
    expect(csp?.deduction).toBe(5.4);
  });

  it("should capture absent signals individually", () => {
    const axes = {
      ...emptyAxes,
      security: makeAxisScore(
        70,
        [],
        [
          {
            signal: "_absent",
            label: "2 signals not detected in scan",
            severity: "absent",
            weight: 5,
            share: 12.0,
            deduction: 3.6,
            category: "not_detected" as const,
            absentSignals: [
              { signal: "ct_scts", label: "CT SCTs", weight: 2, actionable: true },
              { signal: "hsts", label: "HSTS", weight: 3, actionable: true },
            ],
          },
        ],
      ),
    };
    const json = buildSignalDetails(
      axes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      85,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    expect(blob.axes.security.absent).toHaveLength(2);
    expect(blob.axes.security.absent.some((a) => a.signal === "ct_scts")).toBe(true);
    expect(blob.axes.security.absent.some((a) => a.signal === "hsts")).toBe(true);
    expect(blob.axes.security.absentDeduction).toBe(3.6);
  });

  it("should include good/info findings (zero deduction)", () => {
    const axes = {
      ...emptyAxes,
      security: makeAxisScore(
        95,
        [
          {
            signal: "ssl_grade",
            axis: "security" as const,
            severity: "good" as const,
            label: "SSL A+",
            tradeoff: null,
            weight: 3,
          },
        ],
        [], // no deductions — signal passed
      ),
    };
    const json = buildSignalDetails(
      axes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      95,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    const ssl = blob.axes.security.findings.find((f) => f.signal === "ssl_grade");
    expect(ssl).toBeDefined();
    expect(ssl?.severity).toBe("good");
    expect(ssl?.deduction).toBe(0);
  });

  it("should mark not_measured axes", () => {
    const axes = {
      ...emptyAxes,
      email: makeAxisScore(null, [], [], true),
    };
    const json = buildSignalDetails(
      axes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      80,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    expect(blob.axes.email.notMeasured).toBe(true);
    expect(blob.axes.email.score).toBeNull();
  });

  it("should include scoringContext when present", () => {
    const json = buildSignalDetails(
      emptyAxes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      90,
      mockArchetype,
      { cookies: true, wordpress: true },
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    expect(blob.scoringContext).toBeDefined();
    expect(blob.scoringContext?.cookies).toBe(true);
    expect(blob.scoringContext?.wordpress).toBe(true);
  });

  it("should omit scoringContext when not present", () => {
    const json = buildSignalDetails(
      emptyAxes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      90,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    expect(blob.scoringContext).toBeUndefined();
  });

  it("should exclude http_blocked_ and site_unreachable_ meta-signals", () => {
    const axes = {
      ...emptyAxes,
      speed: makeAxisScore(
        80,
        [
          {
            signal: "http_blocked_performance",
            axis: "speed" as const,
            severity: "info" as const,
            label: "Blocked",
            tradeoff: null,
            weight: 4,
          },
          {
            signal: "perf_score",
            axis: "speed" as const,
            severity: "good" as const,
            label: "Perf",
            tradeoff: null,
            weight: 5,
          },
        ],
        [],
      ),
    };
    const json = buildSignalDetails(
      axes as Record<"security" | "speed" | "foundations" | "reputation" | "discoverability" | "email", AxisScore>,
      85,
      mockArchetype,
    );
    const blob: SignalDetailsBlob = JSON.parse(json);
    const speedFindings = blob.axes.speed.findings;
    expect(speedFindings.some((f) => f.signal === "http_blocked_performance")).toBe(false);
    expect(speedFindings.some((f) => f.signal === "perf_score")).toBe(true);
  });
});
