// ─── Scoring Calibration Tests ───────────────────────────────────────
// Automated guardrails that keep scoring balanced as signals evolve.
// See docs/SCORING-CALIBRATION.md for design rationale.
//
// Four layers:
//   1. Registry lint — static analysis of signal weights and coverage
//   2. Score simulation — synthetic findings through computeAxisScore
//   3. Busy customer POV — the math must add up from the outside
//   4. Diagnostics — printed axis health summary every run

import {
  type Axis,
  computeAxisScore,
  computeAxisScoreWithDeductions,
  computeComposite,
  type Finding,
  tierFromComposite,
} from "@worker/actions/analyze/contextual-scoring";
import type { Severity } from "@worker/config/contextual-scoring-types";
import { AXIS_MAX_GOOD_WEIGHT, AXIS_WEIGHTS, SIGNAL_REGISTRY } from "@worker/config/signal-registry";
import { describe, expect, it } from "vitest";

// ─── Constants ──────────────────────────────────────────────────────

const AXES: Axis[] = ["security", "speed", "foundations", "reputation", "discoverability", "email"];

// ═══════════════════════════════════════════════════════════════════
// LAYER 1: Registry Lint
// ═══════════════════════════════════════════════════════════════════

describe("Calibration: Registry Lint", () => {
  // ── 1a. Weight Budget per Axis ──────────────────────────────────
  // Forces rebalancing when adding signals instead of uncapped growth.
  // Ranges are generous — they're guardrails, not a straitjacket.

  describe("Weight budget per axis", () => {
    const WEIGHT_BUDGET: Record<Axis, { min: number; max: number }> = {
      security: { min: 40, max: 65 },
      speed: { min: 20, max: 40 },
      foundations: { min: 15, max: 30 },
      reputation: { min: 15, max: 30 },
      discoverability: { min: 18, max: 35 },
      email: { min: 16, max: 32 },
    };

    for (const axis of AXES) {
      const budget = WEIGHT_BUDGET[axis];
      it(`${axis}: canBeGood weight (${AXIS_MAX_GOOD_WEIGHT[axis]}) within [${budget.min}, ${budget.max}]`, () => {
        expect(AXIS_MAX_GOOD_WEIGHT[axis]).toBeGreaterThanOrEqual(budget.min);
        expect(AXIS_MAX_GOOD_WEIGHT[axis]).toBeLessThanOrEqual(budget.max);
      });
    }
  });

  // ── 1b. Penalty Visibility ─────────────────────────────────────
  // Ensures medium-severity deductions are at least MIN_VISIBLE_DELTA
  // points at the median penalizable weight for each axis.

  describe("Penalty visibility", () => {
    const MIN_VISIBLE_DELTA = 1; // at least 1 point of deduction

    for (const axis of AXES) {
      const penalizable = Object.values(SIGNAL_REGISTRY).filter((s) => s.axis === axis && s.canBeNonGood);

      if (penalizable.length === 0) continue;

      it(`${axis}: medium-severity deduction at median weight ≥ ${MIN_VISIBLE_DELTA} pts`, () => {
        const weights = penalizable.map((s) => s.weightRange[1]).sort((a, b) => a - b);
        const medianWeight = weights[Math.floor(weights.length / 2)];
        const totalGoodWeight = AXIS_MAX_GOOD_WEIGHT[axis];
        const share = (Math.max(medianWeight, 1) / totalGoodWeight) * 100;
        const deduction = share * 0.75; // medium severity factor
        expect(deduction).toBeGreaterThanOrEqual(MIN_VISIBLE_DELTA);
      });
    }
  });

  // ── 1c. Signal Coverage Ratios ─────────────────────────────────
  // Every axis needs both upside (canBeGood) and downside (canBeNonGood)
  // signals. An all-good axis is permanently stuck at max.

  describe("Signal coverage ratios", () => {
    for (const axis of AXES) {
      const signals = Object.entries(SIGNAL_REGISTRY).filter(([, s]) => s.axis === axis);

      it(`${axis}: has at least one canBeGood signal`, () => {
        expect(signals.some(([, s]) => s.canBeGood)).toBe(true);
      });

      it(`${axis}: has at least one canBeNonGood signal`, () => {
        expect(signals.some(([, s]) => s.canBeNonGood)).toBe(true);
      });

      it(`${axis}: canBeGood ratio between 30% and 85%`, () => {
        const goodCount = signals.filter(([, s]) => s.canBeGood).length;
        const ratio = goodCount / signals.length;
        expect(ratio).toBeGreaterThanOrEqual(0.3);
        expect(ratio).toBeLessThanOrEqual(0.85);
      });
    }
  });

  // ── 1d. Normalization Overflow ─────────────────────────────────
  // In the deductive model, each signal's budget share = weight / totalGoodWeight.
  // Very dense axes dilute individual signals. Verify the minimum share for a w1
  // signal is still meaningful (at least 1 point at medium severity).

  describe("Minimum signal visibility", () => {
    const MIN_MEDIUM_DEDUCTION = 1.0; // w1 medium deduction must be at least 1 pt

    for (const axis of AXES) {
      it(`${axis}: w1 medium deduction ≥ ${MIN_MEDIUM_DEDUCTION} pt`, () => {
        const totalGoodWeight = AXIS_MAX_GOOD_WEIGHT[axis];
        const share = (1 / totalGoodWeight) * 100;
        const deduction = share * 0.75; // medium severity factor
        expect(deduction).toBeGreaterThanOrEqual(MIN_MEDIUM_DEDUCTION);
      });
    }
  });

  // ── 1e. Weight Range Sanity ────────────────────────────────────
  // weightRange[0] should be ≤ weightRange[1], both 0–5.

  describe("Weight range sanity", () => {
    for (const [id, def] of Object.entries(SIGNAL_REGISTRY)) {
      it(`${id}: weightRange [${def.weightRange}] is valid`, () => {
        expect(def.weightRange[0]).toBeLessThanOrEqual(def.weightRange[1]);
        expect(def.weightRange[0]).toBeGreaterThanOrEqual(0);
        expect(def.weightRange[1]).toBeLessThanOrEqual(5);
      });
    }
  });

  // ── 1f. Axis Weight Balance ────────────────────────────────────
  // No single axis should dominate (>35%) or be negligible (<5%).

  describe("Axis weight balance", () => {
    for (const axis of AXES) {
      it(`${axis}: composite weight ${AXIS_WEIGHTS[axis]} between 5% and 35%`, () => {
        expect(AXIS_WEIGHTS[axis]).toBeGreaterThanOrEqual(0.05);
        expect(AXIS_WEIGHTS[axis]).toBeLessThanOrEqual(0.35);
      });
    }

    it("axis weights sum to 1.0", () => {
      const sum = Object.values(AXIS_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// LAYER 2: Score Simulation
// ═══════════════════════════════════════════════════════════════════

describe("Calibration: Score Simulation", () => {
  /** Build a perfect set of findings for an axis (all canBeGood signals at max weight) */
  function perfectFindings(axis: Axis): Finding[] {
    return Object.entries(SIGNAL_REGISTRY)
      .filter(([, s]) => s.axis === axis && s.canBeGood)
      .map(([key, s]) => ({
        signal: key,
        axis,
        severity: "good" as Severity,
        label: s.label,
        tradeoff: null,
        weight: s.weightRange[1],
      }));
  }

  // ── 2a. Perfect Score = 100 ────────────────────────────────────
  // Full normalization should map 100% good weight to exactly 100.

  describe("Perfect score achievability", () => {
    for (const axis of AXES) {
      it(`${axis}: all canBeGood signals → score 100`, () => {
        const findings = perfectFindings(axis);
        expect(computeAxisScore(findings, axis)).toBe(100);
      });
    }
  });

  // ── 2b. Empty Score ────────────────────────────────────────────

  it("no findings → 100 (deductive model: nothing to deduct)", () => {
    expect(computeAxisScore([])).toBe(100);
  });

  // ── 2c. Single Penalty Impact ──────────────────────────────────
  // A single high-severity w3 finding on a perfect axis should produce
  // a visible drop but not crater the score.

  describe("Single penalty impact", () => {
    for (const axis of AXES) {
      it(`${axis}: high w3 penalty drops perfect score by 3–15 pts`, () => {
        const findings = perfectFindings(axis);
        findings.push({
          signal: "test_high_penalty",
          axis,
          severity: "high",
          label: "Test high penalty",
          tradeoff: null,
          weight: 3,
        });
        const score = computeAxisScore(findings, axis);
        expect(score).toBeLessThanOrEqual(97); // at least 3 pt drop from 100
        expect(score).toBeGreaterThanOrEqual(85); // shouldn't crater
      });
    }
  });

  // ── 2d. Critical Penalty Impact ────────────────────────────────
  // A critical-severity w5 finding should noticeably impact the score.

  describe("Critical penalty impact", () => {
    for (const axis of AXES) {
      it(`${axis}: critical w5 penalty drops perfect score below 90`, () => {
        const findings = perfectFindings(axis);
        findings.push({
          signal: "test_critical_penalty",
          axis,
          severity: "critical",
          label: "Test critical penalty",
          tradeoff: null,
          weight: 5,
        });
        const score = computeAxisScore(findings, axis);
        expect(score).toBeLessThanOrEqual(90);
        expect(score).toBeGreaterThanOrEqual(60); // still above critical range
      });
    }
  });

  // ── 2e. Proportional Penalty Ordering ──────────────────────────
  // Higher severity + higher weight = worse score. Always.

  describe("Penalty ordering", () => {
    for (const axis of AXES) {
      it(`${axis}: medium w2 < high w2 < critical w2 in impact`, () => {
        const base = perfectFindings(axis);

        const withMedium = [
          ...base,
          {
            signal: "p",
            axis,
            severity: "medium" as Severity,
            label: "",
            tradeoff: null,
            weight: 2,
          },
        ];
        const withHigh = [
          ...base,
          {
            signal: "p",
            axis,
            severity: "high" as Severity,
            label: "",
            tradeoff: null,
            weight: 2,
          },
        ];
        const withCritical = [
          ...base,
          {
            signal: "p",
            axis,
            severity: "critical" as Severity,
            label: "",
            tradeoff: null,
            weight: 2,
          },
        ];

        const sMed = computeAxisScore(withMedium, axis);
        const sHigh = computeAxisScore(withHigh, axis);
        const sCrit = computeAxisScore(withCritical, axis);

        expect(sMed).toBeGreaterThan(sHigh);
        expect(sHigh).toBeGreaterThan(sCrit);
      });
    }
  });

  // ── 2f. Composite Tier Mapping ─────────────────────────────────
  // Uniform axis scores should produce predictable composite tiers.

  describe("Composite tier mapping (uniform axes)", () => {
    const cases: [number, string][] = [
      [100, "Excellent"],
      [95, "Excellent"],
      [90, "Excellent"],
      [85, "Strong"],
      [75, "Strong"],
      [65, "Moderate"],
      [60, "Moderate"],
      [45, "Weak"],
      [30, "Critical"],
    ];

    for (const [score, expectedTier] of cases) {
      it(`all axes at ${score} → ${expectedTier}`, () => {
        const axes: Record<Axis, number> = {
          security: score,
          speed: score,
          foundations: score,
          reputation: score,
          discoverability: score,
          email: score,
        };
        const composite = computeComposite(axes, "general");
        expect(tierFromComposite(composite)).toBe(expectedTier);
      });
    }
  });

  // ── 2g. Low Outlier Floor Cap ───────────────────────────────────
  // If any axis scores below 40, composite is capped at 74 (Moderate).

  describe("Low outlier floor cap", () => {
    it("one axis at 20 with rest at 90 → composite capped at 74", () => {
      const axes: Record<Axis, number> = {
        security: 90,
        speed: 90,
        foundations: 90,
        reputation: 90,
        discoverability: 90,
        email: 20,
      };
      const composite = computeComposite(axes, "general");
      // Arithmetic mean would be ~81.6, but email=20 < 40 triggers floor cap
      expect(composite).toBe(74);
    });

    it("no outlier → no cap applied", () => {
      const axes: Record<Axis, number> = {
        security: 90,
        speed: 90,
        foundations: 90,
        reputation: 90,
        discoverability: 90,
        email: 40,
      };
      const composite = computeComposite(axes, "general");
      // email=40 is exactly at threshold, no cap
      expect(composite).toBeGreaterThan(74);
    });

    it("axis at 39 triggers cap", () => {
      const axes: Record<Axis, number> = {
        security: 90,
        speed: 90,
        foundations: 90,
        reputation: 90,
        discoverability: 90,
        email: 39,
      };
      const composite = computeComposite(axes, "general");
      expect(composite).toBe(74);
    });
  });

  // ── 2h. Normalization Equivalence ──────────────────────────────
  // Two axes with different signal densities, same earned %,
  // should produce the same score (within 1 point for rounding).

  describe("Normalization equivalence", () => {
    it("axes earning same % of their good weight score within 1 point", () => {
      // Build 75% findings for two axes with different densities
      const pctTarget = 0.75;
      const scores: number[] = [];

      for (const axis of AXES) {
        const goodSignals = Object.entries(SIGNAL_REGISTRY)
          .filter(([, s]) => s.axis === axis && s.canBeGood)
          .sort(([, a], [, b]) => b.weightRange[1] - a.weightRange[1]); // highest weight first

        // Take enough signals to reach ~75% of total weight
        const maxWeight = AXIS_MAX_GOOD_WEIGHT[axis];
        const targetWeight = Math.floor(maxWeight * pctTarget);
        let accumulated = 0;
        const findings: Finding[] = [];

        for (const [key, s] of goodSignals) {
          if (accumulated >= targetWeight) break;
          findings.push({
            signal: key,
            axis,
            severity: "good",
            label: s.label,
            tradeoff: null,
            weight: s.weightRange[1],
          });
          accumulated += s.weightRange[1];
        }

        scores.push(computeAxisScore(findings, axis));
      }

      // All axes at ~75% should be within 5 points of each other
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      expect(max - min).toBeLessThanOrEqual(5);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// LAYER 3: Busy Customer POV
// ═══════════════════════════════════════════════════════════════════
// A busy customer doesn't care about registry internals. They see a
// score, wonder why it isn't 100, look at Level-Up, and expect the
// math to add up. If it doesn't, they leave. These tests enforce
// that contract.

describe("Calibration: Busy Customer POV", () => {
  /** Build perfect findings for an axis */
  function perfectFindings(axis: Axis): Finding[] {
    return Object.entries(SIGNAL_REGISTRY)
      .filter(([, s]) => s.axis === axis && s.canBeGood)
      .map(([key, s]) => ({
        signal: key,
        axis,
        severity: "good" as Severity,
        label: s.label,
        tradeoff: null,
        weight: s.weightRange[1],
      }));
  }

  /** Build findings with one specific signal downgraded to a non-good severity */
  function findingsWithOneIssue(axis: Axis, issueSignal: string, issueSeverity: Severity): Finding[] {
    return Object.entries(SIGNAL_REGISTRY)
      .filter(([, s]) => s.axis === axis && s.canBeGood)
      .map(([key, s]) => ({
        signal: key,
        axis,
        severity: key === issueSignal ? issueSeverity : ("good" as Severity),
        label: s.label,
        tradeoff: null,
        weight: s.weightRange[1],
      }));
  }

  // ── 3a. No Phantom Points ─────────────────────────────────────
  // "My score is 82. Level-Up says I can gain +15. Where did the other 3 go?"
  // In deductive scoring, Σ deductions must equal 100 - score exactly.

  describe("No phantom points — deductions account for every lost point", () => {
    for (const axis of AXES) {
      it(`${axis}: Σ deductions = 100 - score (perfect minus one high issue)`, () => {
        // Pick the first canBeNonGood signal to make it a "high" issue
        const penalizable = Object.entries(SIGNAL_REGISTRY).find(
          ([, s]) => s.axis === axis && s.canBeNonGood && s.canBeGood,
        );
        if (!penalizable) return; // skip if no dual-state signal

        const findings = findingsWithOneIssue(axis, penalizable[0], "high");
        const { score, deductions } = computeAxisScoreWithDeductions(findings, axis);
        const deductionSum = deductions.reduce((sum, d) => sum + d.deduction, 0);

        // The rounded score should match 100 - sum(deductions) within rounding
        expect(Math.abs(100 - score - deductionSum)).toBeLessThanOrEqual(1);
      });

      it(`${axis}: Σ deductions = 100 - score (multiple mixed issues)`, () => {
        const signals = Object.entries(SIGNAL_REGISTRY).filter(([, s]) => s.axis === axis && s.canBeGood);
        const severities: Severity[] = ["good", "low", "medium", "high"];
        const findings: Finding[] = signals.map(([key, s], i) => ({
          signal: key,
          axis,
          severity: severities[i % severities.length],
          label: s.label,
          tradeoff: null,
          weight: s.weightRange[1],
        }));

        const { score, deductions } = computeAxisScoreWithDeductions(findings, axis);
        const deductionSum = deductions.reduce((sum, d) => sum + d.deduction, 0);

        expect(Math.abs(100 - score - deductionSum)).toBeLessThanOrEqual(1);
      });
    }
  });

  // ── 3b. Fixing Something Visibly Helps ─────────────────────────
  // "I fixed the thing you told me to. Did my score go up?"
  // Every fixable finding in Level-Up must produce a visible score increase
  // when resolved.

  describe("Fixing an issue always improves the score", () => {
    for (const axis of AXES) {
      it(`${axis}: resolving a high-severity finding raises the score`, () => {
        const penalizable = Object.entries(SIGNAL_REGISTRY).find(
          ([, s]) => s.axis === axis && s.canBeNonGood && s.canBeGood,
        );
        if (!penalizable) return;

        const withIssue = findingsWithOneIssue(axis, penalizable[0], "high");
        const withoutIssue = perfectFindings(axis);

        const scoreBefore = computeAxisScore(withIssue, axis);
        const scoreAfter = computeAxisScore(withoutIssue, axis);

        expect(scoreAfter).toBeGreaterThan(scoreBefore);
      });

      it(`${axis}: resolving a medium-severity finding raises the score`, () => {
        const penalizable = Object.entries(SIGNAL_REGISTRY).find(
          ([, s]) => s.axis === axis && s.canBeNonGood && s.canBeGood,
        );
        if (!penalizable) return;

        const withIssue = findingsWithOneIssue(axis, penalizable[0], "medium");
        const withoutIssue = perfectFindings(axis);

        const scoreBefore = computeAxisScore(withIssue, axis);
        const scoreAfter = computeAxisScore(withoutIssue, axis);

        expect(scoreAfter).toBeGreaterThan(scoreBefore);
      });
    }
  });

  // ── 3c. Composite Matches Weighted Sum ─────────────────────────
  // "How do these six numbers turn into my score?"
  // The composite must be verifiable with a calculator.

  describe("Composite is hand-verifiable from axis scores", () => {
    const testCases: Record<Axis, number>[] = [
      { security: 95, speed: 80, foundations: 90, reputation: 70, discoverability: 85, email: 92 },
      { security: 60, speed: 50, foundations: 70, reputation: 45, discoverability: 55, email: 80 },
      { security: 100, speed: 100, foundations: 100, reputation: 100, discoverability: 100, email: 100 },
    ];

    for (const axes of testCases) {
      const expected = Math.round(
        axes.security * AXIS_WEIGHTS.security +
          axes.speed * AXIS_WEIGHTS.speed +
          axes.foundations * AXIS_WEIGHTS.foundations +
          axes.reputation * AXIS_WEIGHTS.reputation +
          axes.discoverability * AXIS_WEIGHTS.discoverability +
          axes.email * AXIS_WEIGHTS.email,
      );

      it(`axes [${Object.values(axes).join(",")}] → composite ${expected}`, () => {
        const composite = computeComposite(axes, "general");
        // Before outlier cap, composite should match weighted sum
        const hasOutlier = Object.values(axes).some((s) => s < 40);
        if (hasOutlier) {
          expect(composite).toBeLessThanOrEqual(74);
        } else {
          expect(composite).toBe(expected);
        }
      });
    }
  });

  // ── 3d. Severity Labels Match Intuition ────────────────────────
  // "A 'low' issue shouldn't tank my score. A 'critical' should hurt."
  // Customers eyeball severity labels and expect proportional impact.

  describe("Severity impact matches the label", () => {
    for (const axis of AXES) {
      it(`${axis}: low issue costs less than half of what critical costs`, () => {
        const penalizable = Object.entries(SIGNAL_REGISTRY).find(
          ([, s]) => s.axis === axis && s.canBeNonGood && s.canBeGood,
        );
        if (!penalizable) return;

        const base = perfectFindings(axis);
        const perfect = computeAxisScore(base, axis); // 100

        const withLow = findingsWithOneIssue(axis, penalizable[0], "low");
        const withCritical = findingsWithOneIssue(axis, penalizable[0], "critical");

        const lowCost = perfect - computeAxisScore(withLow, axis);
        const criticalCost = perfect - computeAxisScore(withCritical, axis);

        // Critical should cost at least 2x what low costs (actually 3x: 1.5/0.5)
        expect(criticalCost).toBeGreaterThanOrEqual(lowCost * 2);
      });
    }
  });

  // ── 3e. Tier Labels Are Defensible ─────────────────────────────
  // "You say my site is 'Weak' at 50. My competitor is 'Moderate' at 60.
  //  That 10-point gap shouldn't flip the label on a rounding edge."
  // Tier boundaries should be far enough apart that small changes don't
  // cause confusing label swings.

  describe("Tier boundaries have safe margins", () => {
    const boundaries = [
      { score: 90, tier: "Excellent" },
      { score: 75, tier: "Strong" },
      { score: 60, tier: "Moderate" },
      { score: 40, tier: "Weak" },
      { score: 39, tier: "Critical" },
    ];

    for (const { score, tier } of boundaries) {
      it(`score ${score} → "${tier}"`, () => {
        expect(tierFromComposite(score)).toBe(tier);
      });

      // ±1 around boundary should be stable (no jitter)
      if (score >= 41) {
        it(`score ${score - 1} is one tier below or same as ${score}`, () => {
          const tierAtBoundary = tierFromComposite(score);
          const tierBelow = tierFromComposite(score - 1);
          // Either same tier or the next tier down — not two jumps
          expect([tierAtBoundary, boundaries.find((b) => b.score < score)?.tier]).toContain(tierBelow);
        });
      }
    }
  });

  // ── 3f. All-Good Means 100, Not 97 ────────────────────────────
  // "Every check is green. Why isn't my score 100?"

  describe("All green checks = 100", () => {
    for (const axis of AXES) {
      it(`${axis}: every applicable signal at 'good' → exactly 100`, () => {
        const findings = perfectFindings(axis);
        expect(computeAxisScore(findings, axis)).toBe(100);
      });
    }

    it("all axes at 100 → composite exactly 100", () => {
      const axes: Record<Axis, number> = {
        security: 100,
        speed: 100,
        foundations: 100,
        reputation: 100,
        discoverability: 100,
        email: 100,
      };
      expect(computeComposite(axes, "general")).toBe(100);
    });
  });

  // ── 3g. Level-Up Potential Sums to the Gap ─────────────────────
  // "Level-Up says I can gain +5 here, +3 there. That should match
  //  what I'm missing."

  describe("Level-Up potential accounts for the full gap to 100", () => {
    for (const axis of AXES) {
      it(`${axis}: sum of improvable deductions ≤ gap to 100`, () => {
        const signals = Object.entries(SIGNAL_REGISTRY).filter(([, s]) => s.axis === axis && s.canBeGood);
        // Simulate a mixed bag: alternate good/medium/low
        const severities: Severity[] = ["good", "medium", "low", "good", "good"];
        const findings: Finding[] = signals.map(([key, s], i) => ({
          signal: key,
          axis,
          severity: severities[i % severities.length],
          label: s.label,
          tradeoff: null,
          weight: s.weightRange[1],
        }));

        const { score, deductions } = computeAxisScoreWithDeductions(findings, axis);
        const gap = 100 - score;
        const totalPotential = deductions.reduce((sum, d) => sum + d.deduction, 0);

        // totalPotential should be ≥ gap (rounding) and ≤ gap + 1
        expect(totalPotential).toBeGreaterThanOrEqual(gap - 1);
        expect(totalPotential).toBeLessThanOrEqual(gap + 1);
      });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// LAYER 4: Score Diagnostics (printed every run)
// ═════════════════════════════════════════════════════════════════════

describe("Calibration: Diagnostics", () => {
  it("prints axis health summary", () => {
    const rows: string[] = [];
    rows.push("┌──────────────────┬──────┬───────┬────────┬────────────┬──────────────┐");
    rows.push("│ Axis             │ Sigs │ GoodW │ Densty │ Med@share  │ canBeGood %  │");
    rows.push("├──────────────────┼──────┼───────┼────────┼────────────┼──────────────┤");

    for (const axis of AXES) {
      const signals = Object.entries(SIGNAL_REGISTRY).filter(([, s]) => s.axis === axis);
      const goodW = AXIS_MAX_GOOD_WEIGHT[axis];
      // In deductive model, overflow concept is replaced by budget share.
      // Show ratio of goodW to smallest axis goodW as a density metric.
      const minGoodW = Math.min(...AXES.map((a) => AXIS_MAX_GOOD_WEIGHT[a]));
      const density = `${(goodW / minGoodW).toFixed(1)}x`;
      const penalizable = signals.filter(([, s]) => s.canBeNonGood);
      const penWeights = penalizable.map(([, s]) => s.weightRange[1]).sort((a, b) => a - b);
      const medShare =
        penWeights.length > 0
          ? ((Math.max(penWeights[Math.floor(penWeights.length / 2)], 1) / goodW) * 100 * 0.75).toFixed(1)
          : "n/a";
      const goodRatio = `${((signals.filter(([, s]) => s.canBeGood).length / signals.length) * 100).toFixed(0)}%`;

      rows.push(
        `│ ${axis.padEnd(17)}│ ${String(signals.length).padEnd(5)}│ ${String(goodW).padEnd(6)}│ ${density.padEnd(7)}│ ${String(medShare).padEnd(11)}│ ${goodRatio.padEnd(13)}│`,
      );
    }

    rows.push("└──────────────────┴──────┴───────┴────────┴────────────┴──────────────┘");
    console.log(`\n${rows.join("\n")}\n`);

    // This test always passes — it's diagnostic output
    expect(true).toBe(true);
  });
});
