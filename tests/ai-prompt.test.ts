import { describe, expect, it } from "vitest";
import { buildAIPrompt } from "../worker/src/actions/ai-analysis";

describe("buildAIPrompt", () => {
  const analysis = { domain: "example.com", domain_score: { composite: 80 } };

  it("uses the generated prompt by default", () => {
    const prompt = buildAIPrompt(analysis);

    expect(prompt.user).toContain("<domain_data>");
    expect(prompt.user).toContain("example.com");
  });

  it("uses a plain custom prompt as the user message", () => {
    const prompt = buildAIPrompt(analysis, "Focus on email security.");

    expect(prompt.user).toBe("Focus on email security.");
  });

  it("accepts an edited system and user prompt from the browser editor", () => {
    const prompt = buildAIPrompt(analysis, "Custom system\n\n---\n\nCustom user");

    expect(prompt).toEqual({ system: "Custom system", user: "Custom user" });
  });

  it("round-trips the complete generated browser prompt", () => {
    const generated = buildAIPrompt(analysis);
    const fullPrompt = `${generated.system}\n\n---\n\n${generated.user}`;

    expect(fullPrompt.length).toBeGreaterThan(8000);
    expect(buildAIPrompt(analysis, fullPrompt)).toEqual(generated);
  });
});
