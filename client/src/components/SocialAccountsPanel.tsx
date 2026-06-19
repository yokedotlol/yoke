import { CheckCircle2, HelpCircle, Share2 } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { Panel, StatusBadge } from "./Panel";
import { Tooltip } from "./Tooltip";

export function SocialAccountsPanel({ data }: { data: AnalysisResult }) {
  const accounts = data.social_accounts?.accounts ?? [];

  if (accounts.length === 0) {
    return (
      <Panel title="Social Accounts" icon={<Share2 size={14} />}>
        <div className="p-4">
          <StatusBadge status="neutral" label="No social accounts found" />
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Social Accounts"
      icon={<Share2 size={14} />}
      badge={<StatusBadge status="pass" label={`${accounts.length} found`} />}
    >
      <div className="p-3 flex flex-wrap gap-2">
        {accounts.map((acc) => {
          const trust = acc.found_via === "rel-me" ? "verified" : acc.found_via === "homepage" ? "linked" : "probable";
          const tooltipText =
            trust === "verified"
              ? 'Verified via rel="me" — the site explicitly claims ownership of this social profile'
              : trust === "linked"
                ? "Linked from site — this social profile is referenced in the site's HTML"
                : "Username match — discovered by probing common social URL patterns";
          const badgeColor =
            trust === "verified"
              ? "var(--success)"
              : trust === "linked"
                ? "var(--info, var(--accent))"
                : "var(--warning)";
          const Icon = trust === "probable" ? HelpCircle : CheckCircle2;
          return (
            <Tooltip key={acc.url} text={tooltipText}>
              <a href={acc.url} target="_blank" rel="noopener noreferrer" className="social-badge">
                <Icon size={10} style={{ color: badgeColor, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: "11px" }}>{acc.platform}</span>
                {acc.username && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--dim)" }}>
                    @{acc.username}
                  </span>
                )}
                <span
                  style={{
                    fontSize: "8px",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    padding: "1px 4px",
                    borderRadius: "3px",
                    lineHeight: 1.3,
                    background: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
                    color: badgeColor,
                  }}
                >
                  {trust}
                </span>
              </a>
            </Tooltip>
          );
        })}
      </div>
    </Panel>
  );
}
