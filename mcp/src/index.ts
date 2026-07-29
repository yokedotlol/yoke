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
  "Analyze a domain across security, speed, DNS, SSL, email authentication, tech stack, and more. Returns comprehensive structured data with 160+ signals scored across 6 categories. Use yoke_score_summary for a concise overview instead.",
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

// ── Fix snippets for common regressions (zero-storage monitoring) ──
const FIX_SNIPPETS: Record<string, string> = {
  hsts_missing: "Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
  hsts_max_age: "Increase to max-age=31536000 (1 year) and add includeSubDomains",
  hsts_preload: "Submit at hstspreload.org after setting max-age ≥1yr + includeSubDomains",
  csp_missing: "Add header: Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none' — start in report-only mode if needed",
  csp_quality: "Tighten CSP: remove 'unsafe-inline' from script-src, avoid wildcards, add base-uri and object-src 'none'",
  xfo: "Add header: X-Frame-Options: DENY (or SAMEORIGIN if you need embeds)",
  xcto: "Add header: X-Content-Type-Options: nosniff",
  referrer_policy_missing: "Add header: Referrer-Policy: strict-origin-when-cross-origin",
  referrer_policy_unsafe: "Change to: Referrer-Policy: strict-origin-when-cross-origin",
  permissions_policy_missing: "Add header: Permissions-Policy: camera=(), microphone=(), geolocation=()",
  permissions_policy_unrestricted: "Restrict Permissions-Policy: remove wildcard grants for camera/microphone/geolocation",
  cookie_security: "Set cookies with: Secure; HttpOnly; SameSite=Lax (or Strict)",
  tls_version: "Disable TLS 1.0/1.1 in server config; enable TLS 1.2+ (1.3 preferred)",
  cert_expiry_proximity: "Renew TLS certificate; verify auto-renewal (e.g., certbot renew) and enable monitoring",
  ssl_grade: "Use Mozilla intermediate profile; disable RC4/3DES/EXPORT ciphers, enable ECDHE",
  ssl_forward_secrecy: "Enable ECDHE cipher suites for forward secrecy",
  dnssec: "Enable DNSSEC at registrar and DNS provider; publish DS record",
  caa_records: 'Add CAA: 0 issue "letsencrypt.org" (or your CA)',
  caa_iodef: 'Add CAA iodef: 0 iodef "mailto:security@example.com"',
  caa_wildcard_unrestricted: 'Add CAA issuewild restrictive, e.g., 0 issuewild ";"',
  spf_without_dmarc: 'Add TXT at _dmarc: v=DMARC1; p=none; rua=mailto:dmarc@example.com',
  email_auth_incomplete: "Publish SPF, DKIM (selector), and DMARC records — start DMARC p=none",
  mta_sts: "Publish _mta-sts TXT and serve /.well-known/mta-sts.txt with mode=enforce",
  no_http_to_https_redirect: "Configure 301 redirect http:// → https:// at CDN/server",
  server_version_disclosure: "Strip Server/X-Powered-By version headers in CDN/server config",
  subresource_integrity_missing: "Add integrity= and crossorigin= to external <script> tags (generate SRI hash via openssl)",
  vulnerable_js_libraries: "Update JS deps to latest; run npm audit fix",
  known_vulnerabilities: "Patch flagged software versions; verify CVE applicability to your usage",
};

function buildFindingMap(axMap: Record<string, AxisScore>): Map<string, Finding & { axisName: string }> {
  const m = new Map<string, Finding & { axisName: string }>();
  for (const [axisName, info] of Object.entries(axMap)) {
    for (const f of info.findings) {
      m.set(f.signal, { ...f, axisName });
    }
  }
  return m;
}

function severityRank(s: string): number {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4, good: 5 };
  return order[s] ?? 9;
}

// Tool 4: Diff vs baseline (zero-storage monitoring)
server.tool(
  "yoke_diff",
  "Compare current scan to a previous baseline you store locally (zero-storage monitoring). Fetches fresh analysis for a domain, diffs against the baseline JSON you provide, and returns score deltas, new/resolved issues, and fix snippets. You keep watch.json locally; Yoke never stores your domain list.",
  {
    domain: z.string().describe("Domain to check (e.g. example.com) — must match baseline.domain if present"),
    baseline: z.any().describe("Previous AnalysisResult JSON (from earlier yoke_analyze or yoke_score_summary storage). Must contain domain_score.axes or domain_score.composite"),
    force: z.boolean().optional().default(false).describe("Force fresh scan instead of using cache"),
  },
  async ({ domain, baseline, force }) => {
    try {
      if (!baseline || typeof baseline !== "object") {
        throw new Error("baseline must be the previous AnalysisResult JSON object");
      }
      const base = baseline as AnalysisResult & { domain_score?: DomainScore; domain?: string };
      if (!base.domain_score?.axes) {
        throw new Error("baseline is missing domain_score.axes — pass the full previous yoke_analyze result");
      }

      const current = await yokePost<AnalysisResult>("/api/analyze", { domain, force: !!force });

      const baseScore = base.domain_score.composite;
      const curScore = current.domain_score.composite;
      const delta = curScore - baseScore;

      const baseMap = buildFindingMap(base.domain_score.axes as Record<string, AxisScore>);
      const curMap = buildFindingMap(current.domain_score.axes as Record<string, AxisScore>);

      const added: (Finding & { axisName: string })[] = [];
      const resolved: (Finding & { axisName: string })[] = [];
      const worsened: { before: Finding & { axisName: string }; after: Finding & { axisName: string } }[] = [];
      const improved: { before: Finding & { axisName: string }; after: Finding & { axisName: string } }[] = [];

      for (const [sig, cur] of curMap.entries()) {
        if (cur.severity === "good" || cur.severity === "info") continue;
        const prev = baseMap.get(sig);
        if (!prev || prev.severity === "good" || prev.severity === "info") {
          if (!prev) added.push(cur);
          else if (severityRank(cur.severity) < severityRank(prev.severity)) worsened.push({ before: prev, after: cur });
        } else {
          if (severityRank(cur.severity) < severityRank(prev.severity)) worsened.push({ before: prev, after: cur });
          else if (severityRank(cur.severity) > severityRank(prev.severity)) improved.push({ before: prev, after: cur });
        }
      }
      for (const [sig, prev] of baseMap.entries()) {
        if (prev.severity === "good" || prev.severity === "info") continue;
        if (!curMap.has(sig) || curMap.get(sig)!.severity === "good") resolved.push(prev);
      }

      const axisDeltas: { axis: string; before: number; after: number; delta: number }[] = [];
      for (const [axis, curInfo] of Object.entries(current.domain_score.axes)) {
        const baseAxis = (base.domain_score.axes as Record<string, AxisScore>)[axis];
        if (baseAxis) axisDeltas.push({ axis, before: baseAxis.score, after: curInfo.score, delta: curInfo.score - baseAxis.score });
      }

      const lines: string[] = [];
      lines.push(`# ${domain} — Change Report`);
      lines.push(`Baseline: ${base.analyzed_at ?? "unknown"} → Current: ${current.analyzed_at}${current.cached ? " (cached)" : ""}`);
      lines.push("");
      lines.push(`Overall: ${baseScore} → ${curScore} (${delta >= 0 ? "+" : ""}${delta}) — ${base.domain_score.tier} → ${current.domain_score.tier}`);
      lines.push("");

      lines.push("## Axis deltas");
      axisDeltas.sort((a,b)=>a.delta-b.delta);
      for (const d of axisDeltas) {
        if (d.delta !== 0) lines.push(`- ${d.axis}: ${d.before} → ${d.after} (${d.delta >=0?"+":""}${d.delta})`);
      }
      if (axisDeltas.every(d=>d.delta===0)) lines.push("- No axis score changes");
      lines.push("");

      const showList = (title: string, items: (Finding & { axisName: string })[]) => {
        lines.push(`## ${title} (${items.length})`);
        if (items.length===0) { lines.push("_none_"); lines.push(""); return; }
        for (const it of items.slice(0,15)) {
          const fix = FIX_SNIPPETS[it.signal] ? ` | fix: ${FIX_SNIPPETS[it.signal]}` : it.tradeoff ? ` | note: ${it.tradeoff}` : "";
          lines.push(`- [${it.severity.toUpperCase()}] ${it.label} (${it.axisName}, ${it.signal})${fix}`);
        }
        if (items.length>15) lines.push(`- ...and ${items.length-15} more`);
        lines.push("");
      };

      showList("New issues", added);
      if (worsened.length>0) {
        lines.push(`## Worsened (${worsened.length})`);
        for (const w of worsened.slice(0,10)) {
          const fix = FIX_SNIPPETS[w.after.signal] ?? "";
          lines.push(`- ${w.after.label} (${w.after.axisName}): ${w.before.severity} → ${w.after.severity}${fix?` | fix: ${fix}`:""}`);
        }
        lines.push("");
      }
      showList("Resolved", resolved);
      if (improved.length>0) {
        lines.push(`## Improved (${improved.length})`);
        for (const im of improved.slice(0,10)) lines.push(`- ${im.before.label} (${im.before.axisName}): ${im.before.severity} → ${im.after.severity}`);
        lines.push("");
      }

      if (added.length>0 || worsened.length>0) {
        lines.push("## Quick fixes (copy/paste)");
        const toFix = [...added, ...worsened.map(w=>w.after)].slice(0,8);
        for (const f of toFix) if (FIX_SNIPPETS[f.signal]) lines.push(`- ${f.signal}: ${FIX_SNIPPETS[f.signal]}`);
        lines.push("");
      }

      lines.push("---");
      lines.push(`Storage: baseline kept client-side only. Yoke API called for ${domain} once${force?" (forced)":""}. No domain list retained server-side.`);

      const payload = {
        domain,
        baseline_at: base.analyzed_at ?? null,
        current_at: current.analyzed_at,
        cached: current.cached,
        composite: { before: baseScore, after: curScore, delta },
        tier: { before: base.domain_score.tier, after: current.domain_score.tier },
        axis_deltas: axisDeltas,
        added: added.map(a=>({ signal:a.signal, label:a.label, severity:a.severity, axis:a.axisName, weight:a.weight })),
        resolved: resolved.map(r=>({ signal:r.signal, label:r.label, severity:r.severity, axis:r.axisName })),
        worsened: worsened.map(w=>({ signal:w.after.signal, label:w.after.label, before:w.before.severity, after:w.after.severity, axis:w.after.axisName })),
        fixes: Object.fromEntries(added.concat(worsened.map(w=>w.after)).filter(f=>FIX_SNIPPETS[f.signal]).map(f=>[f.signal, FIX_SNIPPETS[f.signal]])),
      };

      return {
        content: [
          { type: "text" as const, text: lines.join("\n") },
          { type: "text" as const, text: JSON.stringify(payload, null, 2) },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: String(err instanceof Error ? err.message : err) }],
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
