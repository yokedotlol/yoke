import { Bot, CheckCircle, ExternalLink, Rss, XCircle } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { DataRow, GradeBadge, Panel, StatusBadge } from "./Panel";
import { Tooltip } from "./Tooltip";

/** Maps checklist item names to their specification/documentation URLs. */
const CHECK_DOCS: Record<string, { url: string; label: string }> = {
  "llms.txt exists": { url: "https://llmstxt.org/", label: "llmstxt.org spec" },
  "llms-full.txt exists": { url: "https://llmstxt.org/", label: "llmstxt.org spec" },
  "Allows GPTBot": { url: "https://platform.openai.com/docs/bots", label: "OpenAI crawler docs" },
  "Allows ClaudeBot": {
    url: "https://docs.anthropic.com/en/docs/build-with-claude/web-search#how-does-the-web-search-tool-work",
    label: "Anthropic crawler docs",
  },
  "Allows Bingbot": {
    url: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
    label: "Bing crawler docs",
  },
  "Structured data (JSON-LD)": { url: "https://schema.org/", label: "schema.org" },
  "Organization/WebSite schema": { url: "https://schema.org/Organization", label: "schema.org/Organization" },
  "Open Graph tags": { url: "https://ogp.me/", label: "Open Graph protocol" },
  "RSS/Atom feed": { url: "https://www.rssboard.org/rss-specification", label: "RSS 2.0 spec" },
  "ANS record (_ans.)": { url: "https://agentnetworkspec.org/", label: "ANS specification" },
  "DNS-AID record (_agents.)": { url: "https://agentnetworkspec.org/", label: "ANS specification" },
  "agent.json endpoint": { url: "https://agentnetworkspec.org/", label: "ANS specification" },
  "ARD ai-catalog.json": { url: "https://github.com/ARD-protocol/ard-spec", label: "ARD spec" },
  "ARD Trust Manifest": { url: "https://github.com/ARD-protocol/ard-spec", label: "ARD Trust Manifest" },
  "OpenAPI via ARD": { url: "https://spec.openapis.org/oas/v3.1.0.html", label: "OpenAPI 3.1" },
  "MCP Server Card": { url: "https://modelcontextprotocol.io/", label: "MCP spec" },
  "x402 payments": { url: "https://www.x402.org/", label: "x402 payments" },
};

export function AiReadinessPanel({ data }: { data: AnalysisResult }) {
  const ai = data.ai_readiness;
  if (!ai) return null;

  const ans = ai.ans;
  const hasAnyAgent = ans && (ans.ans_found || ans.agents_found || ans.agent_json_found);

  return (
    <Panel
      title="AI Readiness"
      icon={<Bot size={14} />}
      badge={
        <div className="flex items-center gap-1.5">
          <StatusBadge status="info" label={`${ai.score}/${ai.max_score}`} />
          <GradeBadge grade={ai.grade} />
        </div>
      }
    >
      {/* Score bar */}
      <div className="px-4 pt-3 pb-2">
        <div className="w-full h-2 rounded-full" style={{ background: "var(--surface-raised)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, (ai.score / ai.max_score) * 100)}%`,
              background:
                ai.grade === "A"
                  ? "var(--success)"
                  : ai.grade === "B"
                    ? "#7ee787"
                    : ai.grade === "C"
                      ? "var(--warning)"
                      : "var(--danger)",
            }}
          />
        </div>
      </div>

      {/* Checklist */}
      <div className="sub-section">Checklist</div>
      {ai.checks.map((check, _i) => {
        const doc = CHECK_DOCS[check.name];
        return (
          <div key={check.name} className="data-row" style={{ alignItems: "center" }}>
            <div className="flex items-center gap-2.5" style={{ flex: 1, minWidth: 0 }}>
              {check.passed ? (
                <CheckCircle size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
              ) : (
                <XCircle
                  size={12}
                  style={{ color: check.points < 0 ? "var(--danger)" : "var(--dim)", flexShrink: 0 }}
                />
              )}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "12px",
                  color: check.passed ? "var(--text)" : check.points < 0 ? "var(--danger)" : "var(--dim)",
                }}
              >
                {check.name}
              </span>
              {doc && (
                <Tooltip text={doc.label}>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={9} style={{ color: "var(--muted)", opacity: 0.7 }} />
                  </a>
                </Tooltip>
              )}
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: check.points > 0 ? "var(--success)" : check.points < 0 ? "var(--danger)" : "var(--dim)",
              }}
            >
              {check.points > 0 ? `+${check.points}` : check.points === 0 ? "0" : `${check.points}`}
            </span>
          </div>
        );
      })}

      {/* RSS Feed */}
      {ai.rss_feed && (
        <DataRow
          label="RSS Feed"
          value={
            <div className="flex items-center gap-1.5">
              <Rss size={11} style={{ color: "var(--accent)" }} />
              <a
                href={ai.rss_feed}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "var(--accent)",
                  textDecoration: "none",
                  wordBreak: "break-all",
                }}
              >
                {ai.rss_feed.length > 50 ? `${ai.rss_feed.slice(0, 50)}…` : ai.rss_feed}
              </a>
            </div>
          }
          copyValue={ai.rss_feed}
        />
      )}

      {/* Agent Discovery Details */}
      {hasAnyAgent && (
        <>
          <div className="sub-section">Agent Discovery</div>
          {ans.ans_found && (
            <DataRow
              label="ANS Record"
              value={
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--text)",
                    wordBreak: "break-all",
                  }}
                >
                  {ans.ans_records.map((r, i) => (
                    <div key={i}>{r.length > 80 ? `${r.slice(0, 80)}…` : r}</div>
                  ))}
                </div>
              }
              copyValue={ans.ans_records.join("\n")}
            />
          )}
          {ans.agents_found && (
            <DataRow
              label="DNS-AID Record"
              value={
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--text)",
                    wordBreak: "break-all",
                  }}
                >
                  {ans.agents_records.map((r, i) => (
                    <div key={i}>{r.length > 80 ? `${r.slice(0, 80)}…` : r}</div>
                  ))}
                </div>
              }
              copyValue={ans.agents_records.join("\n")}
            />
          )}
          {ans.agent_json_found && (
            <DataRow
              label="agent.json"
              value={
                <a
                  href={`https://${data.domain}/.well-known/agent.json`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--accent)",
                    textDecoration: "none",
                  }}
                >
                  /.well-known/agent.json
                </a>
              }
            />
          )}
        </>
      )}
    </Panel>
  );
}
