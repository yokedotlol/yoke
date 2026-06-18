import { ArrowLeft, ExternalLink } from "lucide-react";

/* ── Types ──────────────────────────────────────────────────────────── */

interface Tool {
  name: string;
  domain: string;
  accent: string;
  tagline: string;
  description: string;
  website: string;
  cli?: string;
  docs: string;
  github: string;
  isHub?: boolean;
}

/* ── Data ───────────────────────────────────────────────────────────── */

const tools: Tool[] = [
  {
    name: "yoke",
    domain: "yoke.lol",
    accent: "#58a6ff",
    tagline: "Free Domain Intelligence & OSINT",
    description:
      "Comprehensive domain analysis — 157 scoring signals across 6 axes (security, speed, foundations, reputation, discoverability, email). The hub that ties everything together.",
    website: "https://yoke.lol",
    cli: "brew install yokedotlol/tap/yoke",
    docs: "https://yoke.lol/docs",
    github: "https://github.com/yokedotlol/yoke",
    isHub: true,
  },
  {
    name: "certs",
    domain: "certs.lol",
    accent: "#9b8afb",
    tagline: "fast, API-first TLS scanning",
    description:
      "Deep-dive TLS and certificate analysis. Chain validation, CT log lookups, expiry monitoring, protocol version detection.",
    website: "https://certs.lol",
    cli: "brew install yokedotlol/tap/certs",
    docs: "https://certs.lol/api/docs",
    github: "https://github.com/yokedotlol/certs-lol",
  },
  {
    name: "ns",
    domain: "ns.lol",
    accent: "#22d3ee",
    tagline: "fast, API-first DNS toolkit",
    description:
      "Full DNS record enumeration, DNSSEC validation, propagation checks, reverse lookups, and zone transfer detection.",
    website: "https://ns.lol",
    cli: "brew install yokedotlol/tap/ns",
    docs: "https://ns.lol/docs",
    github: "https://github.com/yokedotlol/ns-lol",
  },
  {
    name: "xhttp",
    domain: "xhttp.lol",
    accent: "#d4a24c",
    tagline: "fast, API-first HTTP response debugger",
    description:
      "CORS, CSP, and security header analysis. Redirect chain tracing, cache behavior inspection, and a live CORS simulator.",
    website: "https://xhttp.lol",
    cli: "brew install yokedotlol/tap/xhttp",
    docs: "https://xhttp.lol/api/docs",
    github: "https://github.com/yokedotlol/xhttp",
  },
  {
    name: "vrfy",
    domain: "vrfy.lol",
    accent: "#f97316",
    tagline: "fast, API-first email validation",
    description:
      "Know everything DNS can tell you about an email address. MX, SPF, DKIM, DMARC, disposable provider detection — no SMTP probes, no accounts.",
    website: "https://vrfy.lol",
    docs: "https://vrfy.lol/api/docs",
    github: "https://github.com/yokedotlol/vrfy-lol",
  },
];

/* ── Shared styles ──────────────────────────────────────────────────── */

const P = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <p
    style={{
      fontFamily: "var(--font-ui)",
      fontSize: 13,
      color: "var(--dim)",
      lineHeight: "22px",
      margin: "0 0 12px",
      ...style,
    }}
  >
    {children}
  </p>
);

/* ── Components ─────────────────────────────────────────────────────── */

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: tool.accent,
          borderRadius: "10px 10px 0 0",
        }}
      />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 16,
            fontWeight: 700,
            color: "var(--text)",
            letterSpacing: "-0.02em",
          }}
        >
          {tool.name}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--dim)",
          }}
        >
          {tool.domain}
        </span>
        {tool.isHub && (
          <span
            style={{
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: tool.accent,
              background: `${tool.accent}18`,
              padding: "2px 7px",
              borderRadius: 4,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            hub
          </span>
        )}
      </div>

      {/* Tagline */}
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          color: tool.accent,
          letterSpacing: "0.02em",
        }}
      >
        {tool.tagline}
      </div>

      {/* Description */}
      <P style={{ margin: 0 }}>{tool.description}</P>

      {/* Links row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 4,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
      >
        <a
          href={tool.website}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--dim)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = tool.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
        >
          <ExternalLink size={10} /> website
        </a>
        <a
          href={tool.docs}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--dim)", textDecoration: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = tool.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
        >
          docs
        </a>
        <a
          href={tool.github}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--dim)", textDecoration: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = tool.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
        >
          github
        </a>
      </div>

      {/* CLI install */}
      {tool.cli && (
        <div
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 12px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--dim)",
            overflowX: "auto",
          }}
        >
          <span style={{ color: "var(--muted)", userSelect: "none" }}>$ </span>
          {tool.cli}
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function ToolsPage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px 64px" }}>
      {/* Back link */}
      <a
        href="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          color: "var(--dim)",
          textDecoration: "none",
          marginBottom: 24,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
      >
        <ArrowLeft size={14} /> Back to Yoke
      </a>

      {/* Hero */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 28,
            fontWeight: 800,
            color: "var(--text)",
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          .lol tools
        </h1>
        <P style={{ margin: 0 }}>
          A family of fast, API-first developer tools for domain intelligence. Each tool does one thing well — use them
          standalone or together.
        </P>
      </div>

      {/* Hub callout */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#58a6ff",
            flexShrink: 0,
          }}
        />
        <P style={{ margin: 0 }}>
          <strong style={{ color: "var(--text)" }}>yoke.lol</strong> is the hub — comprehensive domain intelligence
          across 157 scoring signals. The satellite tools (<strong style={{ color: "var(--text)" }}>certs</strong>,{" "}
          <strong style={{ color: "var(--text)" }}>ns</strong>, <strong style={{ color: "var(--text)" }}>xhttp</strong>,{" "}
          <strong style={{ color: "var(--text)" }}>vrfy</strong>) go deeper on TLS, DNS, HTTP, and email respectively.
          Scan on yoke, then drill down.
        </P>
      </div>

      {/* Tool cards */}
      <div style={{ marginBottom: 40 }}>
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 16,
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: 16,
            letterSpacing: "-0.01em",
          }}
        >
          The family
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 14,
          }}
        >
          {tools.map((tool) => (
            <ToolCard key={tool.domain} tool={tool} />
          ))}
        </div>
      </div>

      {/* Philosophy */}
      <div style={{ marginBottom: 40 }}>
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 16,
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: 14,
            letterSpacing: "-0.01em",
          }}
        >
          Design philosophy
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          {[
            {
              label: "No PII logged",
              detail:
                "Emails and sensitive inputs are POST-only — never in URLs, server logs, or CDN analytics. Privacy by architecture.",
            },
            {
              label: "No accounts",
              detail: "No signups, no API keys, no newsletter, no login. Rate-limited per IP — just use it.",
            },
            {
              label: "No cookies · No ads",
              detail:
                "Zero tracking. No analytics cookies, no ad networks, no third-party pixels. Nothing phones home.",
            },
            {
              label: "No premium tier",
              detail:
                'Everything is free. No upsells, no "upgrade to unlock", no gated features. Same tool for everyone.',
            },
            {
              label: "Abuse-resistant",
              detail:
                "Per-IP rate limiting, proof-of-work challenges, SSRF protection. Designed to prevent weaponization.",
            },
            {
              label: "API-first",
              detail: "Every tool is curl-friendly. JSON by default for programmatic clients, HTML for browsers.",
            },
            {
              label: "MIT licensed",
              detail: "All tools are open source. Fork them, self-host them, build on them.",
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12,
                  color: "var(--dim)",
                  lineHeight: "18px",
                }}
              >
                {item.detail}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 24,
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          color: "var(--dim)",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
        }}
      >
        <a href="/" style={{ color: "var(--accent)", textDecoration: "none" }}>
          yoke.lol
        </a>
        <span style={{ color: "var(--border)" }}>·</span>
        <a
          href="https://github.com/yokedotlol"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)" }}
        >
          GitHub
        </a>
      </div>
    </div>
  );
}
