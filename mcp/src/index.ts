#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.YOKE_API_URL || "https://yoke.lol";

// ── Helpers ──────────────────────────────────────────────────────────

async function yokePost<T = unknown>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach Yoke API at ${BASE_URL}${path}: ${msg}`);
  }

  if (res.status === 429) {
    throw new Error(
      "Rate limited by Yoke API. Wait a minute and try again, or use force:false to allow cached results."
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yoke API error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

interface Finding {
  signal: string;
  axis: string;
  severity: string;
  label: string;
  weight: number;
  tradeoff?: string | null;
  source?: string | null;
}

interface AxisScore {
  score: number;
  weight: number;
  findings: Finding[];
}

interface DomainScore {
  composite: number;
  tier: string;
  axes: Record<string, AxisScore>;
}

interface AnalysisResult {
  domain: string;
  analyzed_at: string;
  cached: boolean;
  domain_score: DomainScore;
  [key: string]: unknown;
}

// ── Score summary extraction ─────────────────────────────────────────

function extractScoreSummary(data: AnalysisResult): string {
  const { domain, domain_score, analyzed_at, cached } = data;
  const lines: string[] = [];

  lines.push(`# ${domain} — Yoke Score Summary`);
  lines.push(`Analyzed: ${analyzed_at}${cached ? " (cached)" : ""}`);
  lines.push("");
  lines.push(`## Overall: ${domain_score.composite}/100 — ${domain_score.tier}`);
  lines.push("");

  // Per-axis breakdown
  lines.push("## Axis Scores");
  for (const [axis, info] of Object.entries(domain_score.axes)) {
    lines.push(
      `- **${axis}**: ${info.score}/100 (weight: ${(info.weight * 100).toFixed(0)}%)`
    );
  }

  // Top issues (non-good findings, sorted by weight desc)
  const issues: (Finding & { axisName: string })[] = [];
  for (const [axis, info] of Object.entries(domain_score.axes)) {
    for (const f of info.findings) {
      if (f.severity !== "good" && f.severity !== "info") {
        issues.push({ ...f, axisName: axis });
      }
    }
  }
  issues.sort((a, b) => {
    const sevOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const sa = sevOrder[a.severity] ?? 4;
    const sb = sevOrder[b.severity] ?? 4;
    return sa !== sb ? sa - sb : b.weight - a.weight;
  });

  if (issues.length > 0) {
    lines.push("");
    lines.push("## Top Issues");
    for (const issue of issues.slice(0, 15)) {
      lines.push(
        `- [${issue.severity.toUpperCase()}] ${issue.label} (${issue.axisName}, weight: ${issue.weight})`
      );
    }
  }

  // Positive findings
  const positives: (Finding & { axisName: string })[] = [];
  for (const [axis, info] of Object.entries(domain_score.axes)) {
    for (const f of info.findings) {
      if (f.severity === "good") {
        positives.push({ ...f, axisName: axis });
      }
    }
  }

  if (positives.length > 0) {
    lines.push("");
    lines.push("## What's Working Well");
    for (const p of positives.slice(0, 10)) {
      lines.push(`- ✓ ${p.label} (${p.axisName})`);
    }
    if (positives.length > 10) {
      lines.push(`- ...and ${positives.length - 10} more positive signals`);
    }
  }

  return lines.join("\n");
}

// ── MCP Server ───────────────────────────────────────────────────────

const server = new McpServer({
  name: "yoke",
  version: "1.0.0",
});

// Tool 1: Full domain analysis
server.tool(
  "yoke_analyze",
  "Analyze a domain across security, speed, DNS, SSL, email authentication, tech stack, and more. Returns comprehensive structured data with 190+ signals scored across 6 categories. Use yoke_score_summary for a concise overview instead.",
  {
    domain: z
      .string()
      .describe("Domain to analyze (e.g. stripe.com, github.com)"),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe("Skip cache and force a fresh analysis (costs a rate limit credit)"),
  },
  async ({ domain, force }) => {
    try {
      const data = await yokePost("/api/analyze", { domain, force });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: String(err instanceof Error ? err.message : err) },
        ],
        isError: true,
      };
    }
  }
);

// Tool 2: Concise score summary
server.tool(
  "yoke_score_summary",
  "Get a concise score summary for a domain: overall score and tier, per-axis breakdown, top issues sorted by severity, and positive signals. Much smaller than yoke_analyze — use this when you need scores and findings without the full raw data.",
  {
    domain: z
      .string()
      .describe("Domain to analyze (e.g. stripe.com, github.com)"),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe("Skip cache and force a fresh analysis"),
  },
  async ({ domain, force }) => {
    try {
      const data = await yokePost<AnalysisResult>("/api/analyze", {
        domain,
        force,
      });
      const summary = extractScoreSummary(data);
      return {
        content: [{ type: "text" as const, text: summary }],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: String(err instanceof Error ? err.message : err) },
        ],
        isError: true,
      };
    }
  }
);

// Tool 3: Compare two domains
server.tool(
  "yoke_compare",
  "Compare two domains side-by-side across all scoring axes. Returns both full analyses plus a comparison summary showing which domain is stronger in each category.",
  {
    domain1: z.string().describe("First domain to compare (e.g. stripe.com)"),
    domain2: z.string().describe("Second domain to compare (e.g. square.com)"),
  },
  async ({ domain1, domain2 }) => {
    try {
      const data = await yokePost("/api/compare", { domain1, domain2 });
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: String(err instanceof Error ? err.message : err) },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
