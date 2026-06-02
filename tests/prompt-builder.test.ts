// ─── Prompt Builder Tests ─────────────────────────────────────────────
// Verifies the dynamic prompt builder composes prompts correctly with
// grade thresholds → tier thresholds, axis weights, signal calibration, and archetype context.

import type { ArchetypeResult } from "@worker/actions/analyze/contextual-scoring";
import { SIGNAL_REGISTRY } from "@worker/config/signal-registry";
import { buildSystemPrompt } from "@worker/prompts/prompt-builder";
import { describe, expect, it } from "vitest";

function makeArchetype(overrides: Partial<ArchetypeResult> = {}): ArchetypeResult {
  return {
    detected: "general",
    confidence: 0.8,
    secondary: null,
    signals: [],
    platform: null,
    weights: { security: 0.28, infrastructure: 0.25, performance: 0.2, visibility: 0.15, trust: 0.12 },
    ...overrides,
  };
}

describe("Prompt Builder", () => {
  it("returns a non-empty string", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("includes tier thresholds from signal registry", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("Excellent ≥90");
    expect(prompt).toContain("Strong ≥78");
    expect(prompt).toContain("Moderate ≥60");
    expect(prompt).toContain("Weak ≥40");
    expect(prompt).toContain("Critical ≥0");
  });

  it("includes axis weights", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("Security (24%)");
    expect(prompt).toContain("Speed (18%)");
    expect(prompt).toContain("Foundations (18%)");
    expect(prompt).toContain("Reputation (15%)");
    expect(prompt).toContain("Discoverability (13%)");
    expect(prompt).toContain("Email (12%)");
  });

  it("includes signal calibration guidance for provided signal IDs", () => {
    const prompt = buildSystemPrompt(makeArchetype(), ["ssl_grade", "hsts_missing", "cross_origin_isolation"]);
    expect(prompt).toContain("ssl_grade");
    expect(prompt).toContain("hsts_missing");
    expect(prompt).toContain("cross_origin_isolation");
    expect(prompt).toContain("COEP");
  });

  it("does NOT include signal calibration for signals not in the ID list", () => {
    const prompt = buildSystemPrompt(makeArchetype(), ["ssl_grade"]);
    // hsts_missing should NOT appear in calibration since it's not in signal list
    expect(prompt).not.toContain("hsts_missing (HSTS Not Configured):");
  });

  it("includes archetype context for commerce", () => {
    const prompt = buildSystemPrompt(makeArchetype({ detected: "commerce" }), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("SITE ARCHETYPE: commerce");
    expect(prompt).toContain("e-commerce");
    expect(prompt).toContain("Payment security");
  });

  it("includes archetype context for application", () => {
    const prompt = buildSystemPrompt(makeArchetype({ detected: "application" }), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("SITE ARCHETYPE: application");
    expect(prompt).toContain("SPA");
  });

  it("includes archetype context for infrastructure", () => {
    const prompt = buildSystemPrompt(makeArchetype({ detected: "infrastructure" }), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("SITE ARCHETYPE: infrastructure");
    expect(prompt).toContain("API");
  });

  it("includes managed platform caveat when platform is set", () => {
    const prompt = buildSystemPrompt(
      makeArchetype({ detected: "commerce", platform: "Shopify" }),
      Object.keys(SIGNAL_REGISTRY),
    );
    expect(prompt).toContain("MANAGED PLATFORM");
    expect(prompt).toContain("Shopify");
  });

  it("does NOT include dynamic managed platform caveat when platform is null", () => {
    const prompt = buildSystemPrompt(makeArchetype({ platform: null }), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).not.toContain("MANAGED PLATFORM: This site runs on");
  });

  it("includes archetype-specific notes for commerce signals", () => {
    const prompt = buildSystemPrompt(makeArchetype({ detected: "commerce" }), [
      "cross_origin_isolation",
      "hsts_missing",
    ]);
    // commerce has archetype notes for cross_origin_isolation
    expect(prompt).toContain("[commerce context]");
  });

  it("does NOT include archetype-specific notes for non-matching archetype", () => {
    const prompt = buildSystemPrompt(makeArchetype({ detected: "general" }), ["cross_origin_isolation"]);
    // general doesn't have archetype notes for cross_origin_isolation
    expect(prompt).not.toContain("[general context]:");
  });

  it("includes core rules content", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("NEVER fabricate consequences");
    expect(prompt).toContain("Severity calibration");
  });

  it("includes meta-rules content", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("DON'T BREAK THE SITE");
    expect(prompt).toContain("MANAGED PLATFORMS");
    expect(prompt).toContain("WHOIS PRIVACY");
    expect(prompt).toContain("REWARD-ONLY SIGNALS");
  });

  it("includes cross-signal examples", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("CROSS-SIGNAL INSIGHT EXAMPLES");
    expect(prompt).toContain("FOUNDATIONS EXAMPLES");
    expect(prompt).toContain("SPEED EXAMPLES");
    expect(prompt).toContain("REPUTATION EXAMPLES");
    expect(prompt).toContain("DISCOVERABILITY EXAMPLES");
  });

  it("includes output schema with correct category names", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("security|speed|foundations|reputation|discoverability|email|accessibility");
    // Should NOT contain the old "seo" category or orphan categories
    expect(prompt).not.toContain('"seo"');
    expect(prompt).not.toContain('"network"');
    expect(prompt).not.toContain('"privacy"');
  });

  it("includes performance context with CWV thresholds", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("LCP ≤2.5s good");
    expect(prompt).toContain("CLS ≤0.1");
    expect(prompt).toContain("INP ≤200ms");
    expect(prompt).toContain("60% mobile");
  });

  it("includes axis definitions with infrastructure clarification", () => {
    const prompt = buildSystemPrompt(makeArchetype(), Object.keys(SIGNAL_REGISTRY));
    expect(prompt).toContain("does NOT measure uptime");
  });

  it("includes COEP guidance in calibration", () => {
    const prompt = buildSystemPrompt(makeArchetype(), ["cross_origin_isolation"]);
    expect(prompt).toContain("NEVER recommend COEP require-corp");
    expect(prompt).toContain("Absence is NOT a security gap");
  });

  it("includes secondary archetype when present", () => {
    const prompt = buildSystemPrompt(
      makeArchetype({ detected: "commerce", secondary: "content" }),
      Object.keys(SIGNAL_REGISTRY),
    );
    expect(prompt).toContain("secondary: content");
  });
});
