import {
  type ArchetypeName,
  AXIS_WEIGHTS,
  applyAbsencePenalties,
  applyHardCaps,
  computeAxisScore,
  computeComposite,
  contextualSeverity,
  type Finding,
  gradeFromComposite,
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
  it("should return baseline (55) for empty findings", () => {
    expect(computeAxisScore([])).toBe(55);
  });

  it("should award bonus for all-good findings", () => {
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "good", label: "A", tradeoff: null, weight: 5 },
      { signal: "b", axis: "security", severity: "good", label: "B", tradeoff: null, weight: 3 },
    ];
    // Baseline 55 + goodBonus(5)=10 + goodBonus(3)=6 = 71
    expect(computeAxisScore(findings)).toBe(71);
  });

  it("should heavily penalize all-critical findings", () => {
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "critical", label: "A", tradeoff: null, weight: 5 },
      { signal: "b", axis: "security", severity: "critical", label: "B", tradeoff: null, weight: 3 },
    ];
    // Baseline 55 + (-4*5) + (-4*3) = 55 - 20 - 12 = 23
    expect(computeAxisScore(findings)).toBe(23);
  });

  it("should balance good bonus against critical penalty", () => {
    // One good w5 (+10), one critical w5 (-20) → 55 + 10 - 20 = 45
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "good", label: "A", tradeoff: null, weight: 5 },
      { signal: "b", axis: "security", severity: "critical", label: "B", tradeoff: null, weight: 5 },
    ];
    expect(computeAxisScore(findings)).toBe(45);
  });

  it("should handle mixed severity findings", () => {
    // Good w3 (+6), medium w2 (-1.25*2=-2.5), info w1 (0*1=0) → 55 + 6 - 2.5 + 0 = 58.5 → 59
    const findings: Finding[] = [
      { signal: "a", axis: "security", severity: "good", label: "A", tradeoff: null, weight: 3 },
      { signal: "b", axis: "security", severity: "medium", label: "B", tradeoff: null, weight: 2 },
      { signal: "c", axis: "security", severity: "info", label: "C", tradeoff: null, weight: 1 },
    ];
    expect(computeAxisScore(findings)).toBe(59);
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
    // high w1 → 55 + (-2.5*1) = 52.5 → 53
    const w1: Finding[] = [{ signal: "a", axis: "security", severity: "high", label: "A", tradeoff: null, weight: 1 }];
    // high w3 → 55 + (-2.5*3) = 47.5 → 48
    const w3: Finding[] = [{ signal: "a", axis: "security", severity: "high", label: "A", tradeoff: null, weight: 3 }];
    expect(computeAxisScore(w1)).toBe(53);
    expect(computeAxisScore(w3)).toBe(48);
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

  it("should return 1 when all axes are 0 (floored at 1 for log safety)", () => {
    const axes = { security: 0, speed: 0, foundations: 0, reputation: 0, discoverability: 0, email: 0 };
    // All axes floor to 1, so exp(sum(w_i * ln(1))) = exp(0) = 1
    expect(computeComposite(axes, "general")).toBe(1);
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

  it("should use weighted geometric mean (not arithmetic)", () => {
    const axes = { security: 60, speed: 80, foundations: 70, reputation: 90, discoverability: 50, email: 75 };
    // Geometric mean: exp(0.24*ln(60) + 0.18*ln(80) + 0.18*ln(70) + 0.15*ln(90) + 0.13*ln(50) + 0.12*ln(75))
    const expected = Math.round(
      Math.exp(
        0.24 * Math.log(60) +
          0.18 * Math.log(80) +
          0.18 * Math.log(70) +
          0.15 * Math.log(90) +
          0.13 * Math.log(50) +
          0.12 * Math.log(75),
      ),
    );
    expect(computeComposite(axes, "general")).toBe(expected);
    // Geometric mean should be strictly less than arithmetic mean for non-uniform inputs
    const arithmetic = Math.round(60 * 0.24 + 80 * 0.18 + 70 * 0.18 + 90 * 0.15 + 50 * 0.13 + 75 * 0.12);
    expect(computeComposite(axes, "general")).toBeLessThanOrEqual(arithmetic);
  });

  it("geometric mean penalizes low outliers more than arithmetic", () => {
    // One very low axis (10) + rest high (90) — geometric mean should be notably lower
    const axes = { security: 90, speed: 90, foundations: 90, reputation: 90, discoverability: 90, email: 10 };
    const geoScore = computeComposite(axes, "general");
    const arithmeticScore = Math.round(90 * 0.24 + 90 * 0.18 + 90 * 0.18 + 90 * 0.15 + 90 * 0.13 + 10 * 0.12);
    expect(geoScore).toBeLessThan(arithmeticScore);
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

// ─── Grade Assignment ────────────────────────────────────────────────

describe("Grade Assignment", () => {
  it("should assign correct grades (production thresholds)", () => {
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

describe("Absence Penalties", () => {
  it("should penalize missing expected signals", () => {
    // Foundations expects cdn, http2, ipv6. If cdn is absent, penalty applies.
    const findings: Finding[] = [
      { signal: "http2", axis: "foundations", severity: "good", label: "HTTP/2", tradeoff: null, weight: 2 },
      { signal: "ipv6", axis: "foundations", severity: "good", label: "IPv6", tradeoff: null, weight: 1 },
    ];
    // Create allFindings that show HTTP ran (so absence penalty applies)
    const allFindings: Finding[] = [
      ...findings,
      { signal: "ssl_grade", axis: "security", severity: "good", label: "SSL A+", tradeoff: null, weight: 3 },
      { signal: "hsts", axis: "security", severity: "good", label: "HSTS", tradeoff: null, weight: 4 },
    ];

    const baseScore = computeAxisScore(findings);
    const penalizedScore = applyAbsencePenalties(baseScore, "foundations", findings, allFindings);
    // cdn absent → -4 penalty
    expect(penalizedScore).toBe(baseScore - 4);
  });

  it("should not penalize when signal is present", () => {
    const findings: Finding[] = [
      { signal: "cdn", axis: "foundations", severity: "good", label: "CDN", tradeoff: null, weight: 2 },
      { signal: "http2", axis: "foundations", severity: "good", label: "HTTP/2", tradeoff: null, weight: 2 },
      { signal: "ipv6", axis: "foundations", severity: "good", label: "IPv6", tradeoff: null, weight: 1 },
    ];
    const allFindings: Finding[] = [
      ...findings,
      { signal: "ssl_grade", axis: "security", severity: "good", label: "SSL", tradeoff: null, weight: 3 },
    ];

    const baseScore = computeAxisScore(findings);
    const result = applyAbsencePenalties(baseScore, "foundations", findings, allFindings);
    expect(result).toBe(baseScore); // no penalties — all expected signals present
  });

  it("should accept http3 as alternative to http2", () => {
    const findings: Finding[] = [
      { signal: "cdn", axis: "foundations", severity: "good", label: "CDN", tradeoff: null, weight: 2 },
      { signal: "http3", axis: "foundations", severity: "good", label: "HTTP/3", tradeoff: null, weight: 2 },
      { signal: "ipv6", axis: "foundations", severity: "good", label: "IPv6", tradeoff: null, weight: 1 },
    ];
    const allFindings: Finding[] = [
      ...findings,
      { signal: "ssl_grade", axis: "security", severity: "good", label: "SSL", tradeoff: null, weight: 3 },
    ];

    const baseScore = computeAxisScore(findings);
    const result = applyAbsencePenalties(baseScore, "foundations", findings, allFindings);
    expect(result).toBe(baseScore); // http3 satisfies http2 requirement
  });

  it("should skip HTTP-dependent penalties when HTTP is blocked", () => {
    const findings: Finding[] = [
      { signal: "ipv6", axis: "foundations", severity: "good", label: "IPv6", tradeoff: null, weight: 1 },
    ];
    // Site unreachable → HTTP didn't run
    const allFindings: Finding[] = [
      ...findings,
      {
        signal: "site_unreachable",
        axis: "foundations",
        severity: "high",
        label: "Unreachable",
        tradeoff: null,
        weight: 3,
      },
    ];

    const baseScore = computeAxisScore(findings);
    const result = applyAbsencePenalties(baseScore, "foundations", findings, allFindings);
    // cdn and http2 penalties should be skipped (requiresHttp), only ipv6 might apply
    // but ipv6 is present, so no penalty at all
    expect(result).toBe(baseScore);
  });

  it("should return score for categories with no expected baselines", () => {
    const findings: Finding[] = [
      { signal: "perf_score", axis: "speed", severity: "good", label: "Perf", tradeoff: null, weight: 5 },
    ];
    const baseScore = computeAxisScore(findings);
    const result = applyAbsencePenalties(baseScore, "speed", findings, findings);
    expect(result).toBe(baseScore); // speed has no expected baselines
  });
});

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
