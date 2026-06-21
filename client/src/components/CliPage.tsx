import { ArrowLeft, Check, Copy, Terminal } from "lucide-react";
import { useCallback, useState } from "react";

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);
  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        lineHeight: "22px",
        overflowX: "auto",
        color: "var(--text)",
      }}
    >
      <button
        onClick={copy}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "4px 8px",
          cursor: "pointer",
          color: "var(--dim)",
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--accent)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.color = "var(--dim)";
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{code}</pre>
    </div>
  );
}

/** Read-only output block (no copy button, dimmer styling) */
function OutputBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: "20px",
        overflowX: "auto",
        color: "var(--dim)",
      }}
    >
      <pre style={{ margin: 0, whiteSpace: "pre" }}>{text}</pre>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <h2
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 16,
          fontWeight: 700,
          color: "var(--text)",
          marginBottom: 12,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function CliPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 64px" }}>
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
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Terminal size={24} style={{ color: "var(--accent)" }} />
          <h1
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 28,
              fontWeight: 800,
              color: "var(--text)",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Yoke CLI
          </h1>
        </div>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: "var(--dim)", lineHeight: "22px", margin: 0 }}>
          Domain intelligence from your terminal. Single binary, same data as the web app.
        </p>
      </div>

      {/* Install + first analysis — above the fold */}
      <Section title="Install">
        <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
          Homebrew (macOS/Linux):
        </p>
        <CopyBlock code={`brew install yokedotlol/tap/yoke`} />

        <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", margin: "16px 0 8px" }}>
          Or install script:
        </p>
        <CopyBlock code={`curl -sSL https://yoke.lol/install.sh | bash`} />
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            color: "var(--dim)",
            margin: "8px 0 0",
            lineHeight: "18px",
          }}
        >
          Downloads the latest release for your platform (macOS/Linux, amd64/arm64). No dependencies required.
        </p>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            color: "var(--dim)",
            margin: "6px 0 16px",
            lineHeight: "18px",
          }}
        >
          Or{" "}
          <a
            href="#build"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("build")?.scrollIntoView({ behavior: "smooth" });
            }}
            style={{ color: "var(--accent)" }}
          >
            build from source
          </a>{" "}
          with{" "}
          <a href="https://go.dev/dl/" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>
            Go 1.22+
          </a>
          .
        </p>
      </Section>

      <Section title="Quick Start">
        <CopyBlock code="yoke stripe.com" />
        <div style={{ marginTop: 8 }}>
          <OutputBlock
            text={`╭──────────────────────────────────────────────────────────────╮
│ stripe.com  89/100 Strong                                    │
│ application                                                  │
│                                                              │
│ SECURITY       ███████████████████░ 98                       │
│ SPEED          █████████████░░░░░░░ 69                       │
│ FOUNDATIONS    ██████████████████░░ 90                       │
│ REPUTATION     ████████████████████ 100                      │
│ DISCOVERABILITY███████████████████░ 97                       │
│ EMAIL          ████████████████████ 100                      │
│                                                              │
│ SSL A+ · HTTP/3 · Stripe · LCP 5.6s                          │
│                                                              │
│ Findings                                                     │
│ ~ 1 privacy concern(s) from third-party scripts              │
│ ! Low performance score 44/100                               │
│ ! LCP: 5.6s                                                  │
│ ! 71 third-party scripts — significant performance overhead  │
│ ℹ DNSSEC not enabled                                         │
│ ✓ SSL grade A+                                               │
│ ✓ HSTS enabled                                               │
│ ✓ Content Security Policy present                            │
│ ✓ Full email auth (SPF+DKIM+DMARC reject)                    │
│ ✓ CAA records restrict certificate issuance                  │
│ ✓ Established domain (30+ years)                             │
│ +10 more passing                                             │
╰──────────────────────────────────────────────────────────────╯`}
          />
        </div>
      </Section>

      {/* More examples with output */}
      <Section title="Examples">
        <div className="space-y-4">
          <div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
              Quick score check:
            </p>
            <CopyBlock code="yoke score stripe.com" />
            <div style={{ marginTop: 6 }}>
              <OutputBlock text="stripe.com  89/100  A" />
            </div>
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
              JSON output — pipe to jq, use in scripts or CI:
            </p>
            <CopyBlock
              code={`yoke stripe.com --json | jq '.domain_score.axes | to_entries[] | "\\(.key): \\(.value.score)"'`}
            />
            <div style={{ marginTop: 6 }}>
              <OutputBlock
                text={`"security: 98"
"speed: 69"
"foundations: 90"
"reputation: 100"
"discoverability: 97"
"email: 100"`}
              />
            </div>
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
              Compare two domains side-by-side:
            </p>
            <CopyBlock code="yoke compare stripe.com google.com" />
            <div style={{ marginTop: 6 }}>
              <OutputBlock
                text={`  stripe.com                      89/100 Strong
  google.com                      92/100 Excellent

  SECURITY         98 vs 96   +2
  SPEED            69 vs 73   -4
  FOUNDATIONS      90 vs 94   -4
  REPUTATION      100 vs 100  +0
  DISCOVERABILITY  97 vs 100  -3
  EMAIL           100 vs  95  +5

  https://yoke.lol/compare/stripe.com/google.com`}
              />
            </div>
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
              AI analysis (requires{" "}
              <a href="https://openrouter.ai/" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>
                OpenRouter
              </a>{" "}
              API key):
            </p>
            <CopyBlock
              code={`yoke ai --setup          # one-time: set your API key
yoke ai stripe.com      # expert security/SEO/dev analysis`}
            />
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
              Deep-dive with satellite tools:
            </p>
            <CopyBlock
              code={`yoke dns stripe.com          # DNS records via ns.lol
yoke headers stripe.com      # security headers via xhttp.lol
yoke tls stripe.com          # TLS certificate via certs.lol`}
            />
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
              CI gate — fail the build if score drops below a threshold:
            </p>
            <CopyBlock code={`yoke check stripe.com --min-grade B    # exit 1 if below Strong (78)`} />
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", marginBottom: 8 }}>
              Batch processing — pipe domains from stdin:
            </p>
            <CopyBlock
              code={`cat domains.txt | yoke fast --json     # batch quick scan
cat domains.txt | yoke dns --raw       # batch DNS lookup
cat domains.txt | yoke check --min-grade B  # batch CI gate`}
            />
          </div>
        </div>
      </Section>

      {/* Commands reference */}
      <Section title="Commands">
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {[
            ["yoke <domain>", "Full analysis card"],
            ["yoke <domain> --json", "Raw JSON output"],
            ["yoke <domain> --fresh", "Bypass cache, force fresh scan"],
            ["yoke score <domain>", 'Quick score (e.g. "92/100 Strong")'],
            ["yoke fast <domain>", "Lightweight scan — skip heavy probes"],
            ["yoke compare <d1> <d2>", "Side-by-side comparison"],
            ["yoke dns <domain>", "DNS records + DNSSEC via ns.lol"],
            ["yoke headers <domain>", "Security headers + CORS via xhttp.lol"],
            ["yoke tls <domain>", "TLS cert + chain via certs.lol"],
            ["yoke check <domain> --min-grade B", "CI gate — exit 1 if below threshold"],
            ["yoke ai <domain>", "AI-powered analysis"],
            ["yoke ai --setup", "Configure OpenRouter API key"],
            ["cat domains.txt | yoke fast", "Batch processing via stdin pipe"],
            ["yoke config", "Show current configuration"],
            ["yoke config --set-base-url <url>", "Point to self-hosted instance"],
            ["yoke config --set-prompt <file>", "Custom AI prompt from file"],
            ['yoke config --set-prompt-inline "..."', "Custom AI prompt inline"],
          ].map(([cmd, desc], i, arr) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                padding: "10px 16px",
                borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                gap: 16,
              }}
            >
              <code
                style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", whiteSpace: "nowrap" }}
              >
                {cmd}
              </code>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--dim)", textAlign: "right" }}>
                {desc}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* Configuration */}
      <Section title="Configuration">
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            color: "var(--dim)",
            lineHeight: "22px",
            marginBottom: 12,
          }}
        >
          Config file at{" "}
          <code
            style={{
              fontSize: 12,
              color: "var(--text)",
              background: "var(--surface)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            ~/.yoke.toml
          </code>
          . Override per-session with env vars:
        </p>
        <CopyBlock
          code={`export YOKE_BASE_URL=https://your-instance.com
export OPENROUTER_API_KEY=sk-or-...`}
        />
      </Section>

      {/* Build from source */}
      <Section title="Build from Source">
        <div id="build">
          <CopyBlock
            code={`git clone https://github.com/yokedotlol/yoke
cd yoke/cli
go build -o yoke .
./yoke stripe.com`}
          />
        </div>
      </Section>

      {/* Privacy notice */}
      <div
        style={{
          margin: "24px 0",
          padding: "8px 12px",
          background: "var(--surface)",
          borderLeft: "3px solid var(--accent)",
          borderRadius: 4,
          fontSize: 12,
          color: "var(--dim)",
          lineHeight: "20px",
          fontFamily: "var(--font-ui)",
        }}
      >
        🌐 <strong style={{ color: "var(--accent)" }}>Privacy:</strong> This CLI queries the yoke.lol API and its
        satellite services (certs.lol, ns.lol, xhttp.lol) to analyze domains. Only the domain name is sent — no
        accounts, no tracking, no personal data collected.{" "}
        <a href="https://github.com/yokedotlol/yoke" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>
          You can always self-host if you need privacy.
        </a>
      </div>

      {/* Self-hosting */}
      <Section title="Self-Hosting">
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            color: "var(--dim)",
            lineHeight: "22px",
            marginBottom: 12,
          }}
        >
          Yoke is open source. Deploy your own Worker and point the CLI at it:
        </p>
        <CopyBlock
          code={`# Deploy the API/web app to Cloudflare Workers
cd yoke && npm install && npx wrangler deploy

# Point your CLI at your instance
yoke config --set-base-url https://your-yoke.workers.dev`}
        />
        <p style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--dim)", marginTop: 12 }}>
          <a
            href="https://github.com/yokedotlol/yoke"
            target="_blank"
            rel="noopener"
            style={{ color: "var(--accent)" }}
          >
            View on GitHub →
          </a>
        </p>
      </Section>
    </div>
  );
}
