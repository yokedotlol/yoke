import {
  lookupCompositePercentile,
  lookupPercentiles,
  type PercentileData,
  type PercentileDistribution,
} from "@worker/percentiles";
import { describe, expect, it } from "vitest";

// ─── Test Helpers ────────────────────────────────────────────────────

/** Build a histogram with all domains at the given scores. */
function buildHistogram(scores: number[]): number[] {
  const h = new Array(101).fill(0);
  for (const s of scores) {
    const clamped = Math.max(0, Math.min(100, Math.round(s)));
    h[clamped]++;
  }
  return h;
}

/** Build a full PercentileDistribution from simple score arrays. */
function buildDistribution(
  compositeScores: number[],
  overrides?: Partial<Record<"security" | "speed" | "foundations" | "reputation" | "discoverability", number[]>>,
): PercentileDistribution {
  return {
    composite: buildHistogram(compositeScores),
    security: buildHistogram(overrides?.security ?? compositeScores),
    speed: buildHistogram(overrides?.speed ?? compositeScores),
    foundations: buildHistogram(overrides?.foundations ?? compositeScores),
    reputation: buildHistogram(overrides?.reputation ?? compositeScores),
    discoverability: buildHistogram(overrides?.discoverability ?? compositeScores),
    sample_size: compositeScores.length,
    computed_at: new Date().toISOString(),
  };
}

// ─── Percentile Rank Lookup ──────────────────────────────────────────

describe("lookupPercentiles", () => {
  it("should return 0th percentile for the lowest score", () => {
    // 10 domains with scores 0–9
    const dist = buildDistribution([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const result = lookupPercentiles(dist, { composite: 0 });
    expect(result.composite).toBe(0);
  });

  it("should return 100th percentile for score above all others", () => {
    // 10 domains at score 50
    const dist = buildDistribution(Array(10).fill(50));
    const result = lookupPercentiles(dist, { composite: 100 });
    expect(result.composite).toBe(100);
  });

  it("should return 50th percentile for the median score", () => {
    // Uniform distribution: 1 domain at each score 0–99
    const scores = Array.from({ length: 100 }, (_, i) => i);
    const dist = buildDistribution(scores);
    const result = lookupPercentiles(dist, { composite: 50 });
    expect(result.composite).toBe(50);
  });

  it("should handle score of exactly 100", () => {
    const scores = Array.from({ length: 101 }, (_, i) => i);
    const dist = buildDistribution(scores);
    const result = lookupPercentiles(dist, { composite: 100 });
    expect(result.composite).toBe(99); // 100 of 101 are below score 100
  });

  it("should handle score of exactly 0", () => {
    const scores = Array.from({ length: 101 }, (_, i) => i);
    const dist = buildDistribution(scores);
    const result = lookupPercentiles(dist, { composite: 0 });
    expect(result.composite).toBe(0);
  });

  it("should clamp scores below 0 to 0th percentile", () => {
    const dist = buildDistribution([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const result = lookupPercentiles(dist, { composite: -1 });
    expect(result.composite).toBe(0);
  });

  it("should clamp scores above 100", () => {
    const dist = buildDistribution([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const result = lookupPercentiles(dist, { composite: 101 });
    // 101 clamps to 100 → 9 of 10 domains are below score 100 → 90th
    expect(result.composite).toBe(90);
  });

  it("should return 0 for an empty histogram", () => {
    const dist: PercentileDistribution = {
      composite: new Array(101).fill(0),
      security: new Array(101).fill(0),
      speed: new Array(101).fill(0),
      foundations: new Array(101).fill(0),
      reputation: new Array(101).fill(0),
      discoverability: new Array(101).fill(0),
      sample_size: 0,
      computed_at: new Date().toISOString(),
    };
    const result = lookupPercentiles(dist, { composite: 50 });
    expect(result.composite).toBe(0);
  });

  it("should return null for email axis (always untracked)", () => {
    const dist = buildDistribution([50, 60, 70, 80, 90]);
    const result = lookupPercentiles(dist, { composite: 75 });
    expect(result.axes.email).toBeNull();
  });

  it("should return null for axes with null scores", () => {
    const dist = buildDistribution([50, 60, 70, 80, 90]);
    const result = lookupPercentiles(dist, {
      composite: 75,
      security: null,
      speed: 80,
    });
    expect(result.axes.security).toBeNull();
    expect(result.axes.speed).toBeTypeOf("number");
  });

  it("should carry through sample_size and computed_at", () => {
    const dist = buildDistribution([50, 60, 70, 80, 90]);
    const result = lookupPercentiles(dist, { composite: 75 });
    expect(result.sample_size).toBe(5);
    expect(result.computed_at).toBeTruthy();
  });
});

// ─── Per-Axis Independence ──────────────────────────────────────────

describe("per-axis percentiles", () => {
  it("should compute axes independently from composite", () => {
    const dist = buildDistribution(
      [10, 20, 30, 40, 50], // composite: 50 → 80th
      {
        security: [90, 91, 92, 93, 94], // all high — 85 would be below all
        speed: [5, 10, 15, 20, 25], // all low — 50 would be above all
      },
    );
    const result = lookupPercentiles(dist, {
      composite: 50,
      security: 85,
      speed: 50,
    });
    // security 85 is below all (90–94), percentile = 0
    expect(result.axes.security).toBe(0);
    // speed 50 is above all (5–25), percentile = 100
    expect(result.axes.speed).toBe(100);
  });
});

// ─── lookupCompositePercentile (recents feed) ───────────────────────

describe("lookupCompositePercentile", () => {
  it("should return the composite percentile for a given score", () => {
    const dist = buildDistribution(Array.from({ length: 100 }, (_, i) => i));
    expect(lookupCompositePercentile(dist, 75)).toBe(75);
  });

  it("should handle minimum score", () => {
    const dist = buildDistribution([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(lookupCompositePercentile(dist, 0)).toBe(0);
  });

  it("should handle maximum score", () => {
    const dist = buildDistribution([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    expect(lookupCompositePercentile(dist, 100)).toBe(100);
  });

  it("should handle all domains at the same score", () => {
    const dist = buildDistribution(Array(100).fill(50));
    // Score 50: 0 domains below → 0th percentile
    expect(lookupCompositePercentile(dist, 50)).toBe(0);
    // Score 51: all 100 domains below → 100th percentile
    expect(lookupCompositePercentile(dist, 51)).toBe(100);
  });
});

// ─── Distribution Structure ─────────────────────────────────────────

describe("PercentileDistribution shape", () => {
  it("should have 101 buckets per axis", () => {
    const dist = buildDistribution([42]);
    expect(dist.composite).toHaveLength(101);
    expect(dist.security).toHaveLength(101);
    expect(dist.speed).toHaveLength(101);
    expect(dist.foundations).toHaveLength(101);
    expect(dist.reputation).toHaveLength(101);
    expect(dist.discoverability).toHaveLength(101);
  });

  it("histogram values should be non-negative integers", () => {
    const dist = buildDistribution([10, 50, 90]);
    for (const h of [
      dist.composite,
      dist.security,
      dist.speed,
      dist.foundations,
      dist.reputation,
      dist.discoverability,
    ]) {
      for (const v of h) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});

// ─── PercentileData Interface ───────────────────────────────────────

describe("PercentileData shape", () => {
  it("should match expected structure", () => {
    const dist = buildDistribution([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const result: PercentileData = lookupPercentiles(dist, {
      composite: 75,
      security: 80,
      speed: 60,
      foundations: 90,
      reputation: 50,
      discoverability: 70,
    });

    expect(result).toHaveProperty("composite");
    expect(result).toHaveProperty("axes");
    expect(result).toHaveProperty("sample_size");
    expect(result).toHaveProperty("computed_at");

    expect(typeof result.composite).toBe("number");
    expect(typeof result.axes.security).toBe("number");
    expect(typeof result.axes.speed).toBe("number");
    expect(typeof result.axes.foundations).toBe("number");
    expect(typeof result.axes.reputation).toBe("number");
    expect(typeof result.axes.discoverability).toBe("number");
    expect(result.axes.email).toBeNull();
    expect(result.sample_size).toBe(10);

    // All percentiles should be 0–100
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(100);
  });
});
