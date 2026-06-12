import { Check, ChevronDown, ChevronUp, Copy, Terminal } from "lucide-react";
import { useState } from "react";
import type { TabId } from "./TabBar";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 px-2 py-0.5 rounded transition-all"
      style={{
        background: copied ? "rgba(63, 185, 80, 0.15)" : "transparent",
        border: "none",
        color: copied ? "var(--success)" : "var(--dim)",
        cursor: "pointer",
        fontSize: "11px",
        fontFamily: "var(--font-mono)",
      }}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

// ─── Tab → jq filter mapping ───────────────────────────────────

const TAB_FILTERS: Record<TabId, { label: string; filter: string } | null> = {
  overview: { label: "Overview", filter: "'{status, domain_score, hosting, tranco_rank}'" },
  security: { label: "Security", filter: "'{headers, ssl, dnssec, caa}'" },
  foundations: {
    label: "Foundations",
    filter: "'{dns, ip_info, ssl, rdap, shodan, redirects, tech_stack, wordpress}'",
  },
  speed: { label: "Speed", filter: "'{performance, compression, http_protocols}'" },
  reputation: { label: "Reputation", filter: "'{breaches, blocklists, rdap, tranco_rank, cookie_consent}'" },
  discoverability: { label: "Discoverability", filter: "'{social_meta, json_ld, meta_tags, accessibility}'" },
  email: { label: "Email", filter: "'{email_auth}'" },
  insights: null,
};

// ─── Results page: contextual curl bar for current domain ──────────

export function CurlBar({ domain, activeTab = "overview" }: { domain: string; activeTab?: TabId }) {
  const [expanded, setExpanded] = useState(false);

  const tabFilter = TAB_FILTERS[activeTab];
  const host = window.location.host;
  const mainCmd = tabFilter
    ? `curl -s https://${host}/${domain} | jq ${tabFilter.filter}`
    : `curl -s https://${host}/${domain} | jq`;

  const extraCmds = [
    { label: "Full output", cmd: `curl -s https://${host}/${domain} | jq` },
    ...(tabFilter
      ? [{ label: tabFilter.label, cmd: `curl -s https://${host}/${domain} | jq ${tabFilter.filter}` }]
      : []),
    { label: "Pretty print", cmd: `curl -s "https://${host}/${domain}?pretty"` },
  ];

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border-muted)",
      }}
    >
      {/* Main command bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-all"
        onClick={() => setExpanded(!expanded)}
        style={{ minHeight: "36px" }}
      >
        <Terminal size={13} style={{ color: "var(--dim)", flexShrink: 0, opacity: 0.6 }} />
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--success)",
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ color: "var(--dim)", opacity: 0.5 }}>$ </span>
          {mainCmd}
        </code>
        <CopyBtn text={mainCmd} />
        {expanded ? (
          <ChevronUp size={13} style={{ color: "var(--dim)", flexShrink: 0, opacity: 0.5 }} />
        ) : (
          <ChevronDown size={13} style={{ color: "var(--dim)", flexShrink: 0, opacity: 0.5 }} />
        )}
      </div>

      {/* Expanded examples */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border-muted)",
            padding: "6px 8px",
          }}
        >
          {extraCmds.map((item, i) => (
            <div
              key={`curl-${i}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5"
              style={{ background: "transparent" }}
            >
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "10px",
                  color: "var(--dim)",
                  width: "72px",
                  flexShrink: 0,
                  textAlign: "right",
                  opacity: 0.7,
                }}
              >
                {item.label}
              </span>
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--accent)",
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.cmd}
              </code>
              <CopyBtn text={item.cmd} />
            </div>
          ))}
          <div className="flex justify-end mt-1 px-2 pb-1">
            <a
              href="/api/docs"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "10px",
                color: "var(--accent)",
                textDecoration: "none",
                opacity: 0.7,
              }}
            >
              API docs →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Home page: API teaser below search ────────────────────────

export function ApiTeaser() {
  const host = window.location.host;
  const cmd = `curl -s https://${host}/any-domain.com | jq`;
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col items-center gap-2 mt-6">
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "11px",
          color: "var(--dim)",
          letterSpacing: "0.03em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        Also available as an API
      </span>
      <div
        className="flex items-center gap-2 rounded-lg px-4 py-2.5 cursor-pointer transition-all"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          maxWidth: "440px",
          width: "100%",
        }}
        onClick={() => {
          navigator.clipboard.writeText(cmd).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        title="Click to copy"
      >
        <Terminal size={14} style={{ color: "var(--dim)", flexShrink: 0, opacity: 0.6 }} />
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            color: "var(--success)",
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ color: "var(--dim)", opacity: 0.5 }}>$ </span>
          {cmd}
        </code>
        <span
          className="flex items-center gap-1 transition-all"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            color: copied ? "var(--success)" : "var(--dim)",
            opacity: copied ? 1 : 0.5,
            flexShrink: 0,
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied!" : ""}
        </span>
      </div>
      <a
        href="/api/docs"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "11px",
          color: "var(--accent)",
          textDecoration: "none",
          opacity: 0.7,
        }}
      >
        View API docs →
      </a>
    </div>
  );
}
