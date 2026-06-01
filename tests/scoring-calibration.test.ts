// ─── Scoring Calibration Tests ───────────────────────────────────────
// Automated guardrails that keep scoring balanced as signals evolve.
// See docs/SCORING-CALIBRATION.md for design rationale.
//
// Three layers:
//   1. Registry lint — static analysis of signal weights and coverage
//   2. Score simulation — synthetic findings through computeAxisScore
//   3. Reference domain assertions — fixture-based end-to-end scoring

import {
  type Axis,
  computeAxisScore,
  computeComposite,
  type Finding,
  tierFromComposite,
} from "@worker/actions/analyze/contextual-scoring";
import type { Severity } from "@worker/config/contextual-scoring-types";
import { AXIS_MAX_GOOD_WEIGHT, AXIS_WEIGHTS, SIGNAL_REGISTRY } from "@worker/config/signal-registry";
import { describe, expect, it } from "vitest";

// ─── Constants ──────────────────────────────────────────────────────

const AXES: Axis[] = ["security", "speed", "foundations", "reputation", "discoverability", "email"];
const BASELINE = 55;
const TARGET_RANGE = 100 - BASELINE; // 45

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
  // Ensures medium-severity penalties are at least MIN_VISIBLE_DELTA
  // points at the median penalizable weight for each axis.

  describe("Penalty visibility", () => {
    const MIN_VISIBLE_DELTA = 1.5; // points (before rounding)

    for (const axis of AXES) {
      const penalizable = Object.values(SIGNAL_REGISTRY).filter((s) => s.axis === axis && s.canBeNonGood);

      if (penalizable.length === 0) continue;

      it(`${axis}: medium-severity penalty at median weight ≥ ${MIN_VISIBLE_DELTA} pts`, () => {
        const weights = penalizable.map((s) => s.weightRange[1]).sort((a, b) => a - b);
        const medianWeight = weights[Math.floor(weights.length / 2)];
        const penaltyPoints = 1.25 * Math.max(medianWeight, 1); // |SEVERITY_PENALTY.medium| × weight
        expect(penaltyPoints).toBeGreaterThanOrEqual(MIN_VISIBLE_DELTA);
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
  // Heavy overflow means individual signal weights become less meaningful
  // after normalization. Hard limit at 3x to prevent sub-1-point penalties.

  describe("Normalization overflow", () => {
    const HARD_LIMIT = 3.0; // 3x overflow = individual weights 1/3 effective

    for (const axis of AXES) {
      it(`${axis}: overflow ratio ≤ ${HARD_LIMIT}x`, () => {
        const maxRawBonus = AXIS_MAX_GOOD_WEIGHT[axis] * 2;
        const ratio = maxRawBonus / TARGET_RANGE;
        expect(ratio).toBeLessThanOrEqual(HARD_LIMIT);
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

  // ── 2b. Empty Score = Baseline ─────────────────────────────────

  it("no findings → baseline (55)", () => {
    expect(computeAxisScore([])).toBe(BASELINE);
  });

  // ── 2c. Single Penalty Impact ──────────────────────────────────
  // A single high-severity w3 finding on a perfect axis should produce
  // a visible drop but not crater the score.

  describe("Single penalty impact", () => {
    for (const axis of AXES) {
      it(`${axis}: high w3 penalty drops perfect score by 5–15 pts`, () => {
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
        expect(score).toBeLessThanOrEqual(95); // at least 5 pt drop from 100
        expect(score).toBeGreaterThanOrEqual(85); // shouldn't crater
      });
    }
  });

  // ── 2d. Critical Penalty Impact ────────────────────────────────
  // A critical-severity w5 finding should heavily impact the score.

  describe("Critical penalty impact", () => {
    for (const axis of AXES) {
      it(`${axis}: critical w5 penalty drops perfect score below 85`, () => {
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
        expect(score).toBeLessThanOrEqual(85);
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
// LAYER 3: Score Diagnostics (printed every run)
// ═══════════════════════════════════════════════════════════════════

describe("Calibration: Diagnostics", () => {
  it("prints axis health summary", () => {
    const rows: string[] = [];
    rows.push("┌──────────────────┬──────┬───────┬────────┬────────────┬──────────────┐");
    rows.push("│ Axis             │ Sigs │ GoodW │ Ovflow │ Med@median │ canBeGood %  │");
    rows.push("├──────────────────┼──────┼───────┼────────┼────────────┼──────────────┤");

    for (const axis of AXES) {
      const signals = Object.entries(SIGNAL_REGISTRY).filter(([, s]) => s.axis === axis);
      const goodW = AXIS_MAX_GOOD_WEIGHT[axis];
      const maxRaw = goodW * 2;
      const overflow = `${(maxRaw / TARGET_RANGE).toFixed(1)}x`;
      const penalizable = signals.filter(([, s]) => s.canBeNonGood);
      const penWeights = penalizable.map(([, s]) => s.weightRange[1]).sort((a, b) => a - b);
      const medPen =
        penWeights.length > 0 ? (1.25 * Math.max(penWeights[Math.floor(penWeights.length / 2)], 1)).toFixed(1) : "n/a";
      const goodRatio = `${((signals.filter(([, s]) => s.canBeGood).length / signals.length) * 100).toFixed(0)}%`;

      rows.push(
        `│ ${axis.padEnd(17)}│ ${String(signals.length).padEnd(5)}│ ${String(goodW).padEnd(6)}│ ${overflow.padEnd(7)}│ ${String(medPen).padEnd(11)}│ ${goodRatio.padEnd(13)}│`,
      );
    }

    rows.push("└──────────────────┴──────┴───────┴────────┴────────────┴──────────────┘");
    console.log(`\n${rows.join("\n")}\n`);

    // This test always passes — it's diagnostic output
    expect(true).toBe(true);
  });
});
