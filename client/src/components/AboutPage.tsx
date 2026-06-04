import { ArrowLeft, ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";

/* ── Reusable sub-components ─────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
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
        {title}
      </h2>
      {children}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
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
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{code}</pre>
    </div>
  );
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text)",
          textAlign: "left",
        }}
      >
        {title}
        <ChevronDown
          size={16}
          style={{
            color: "var(--dim)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
          }}
        />
      </button>
      {open && (
        <div
          style={{
            padding: "0 16px 14px",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            color: "var(--dim)",
            lineHeight: "22px",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderBottom: "2px solid var(--border)",
                  color: "var(--text)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--border)",
                    color: j === 0 ? "var(--text)" : "var(--dim)",
                    whiteSpace: j === 0 ? "nowrap" : undefined,
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
    {children}
  </a>
);

/* ── Main page ───────────────────────────────────────────────────────── */

export default function AboutPage() {
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
          About Yoke
        </h1>
        <P style={{ margin: 0 }}>Free, open-source domain intelligence. Here's how it works.</P>
      </div>

      {/* ── How We Scan ─────────────────────────────────────────────── */}
      <Section title="How We Scan">
        <P>When you scan a domain on Yoke, here's what happens:</P>

        <ol
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            color: "var(--dim)",
            lineHeight: "22px",
            paddingLeft: 20,
            margin: "0 0 12px",
          }}
        >
          <li style={{ marginBottom: 14 }}>
            <strong style={{ color: "var(--text)" }}>DNS lookup</strong> — We query A, AAAA, MX, TXT, NS, and CAA
            records. We check for DNSSEC, DMARC, and DKIM (via common selectors like{" "}
            <code style={codeInline}>default._domainkey</code>, <code style={codeInline}>google._domainkey</code>,{" "}
            <code style={codeInline}>selector1._domainkey</code>).
          </li>
          <li style={{ marginBottom: 14 }}>
            <strong style={{ color: "var(--text)" }}>HTTPS connection</strong> — We send a GET request to{" "}
            <code style={codeInline}>https://your-domain.com</code>, following up to 10 redirects. We analyze response
            headers, SSL certificate details, and TLS protocol version.
          </li>
          <li style={{ marginBottom: 14 }}>
            <strong style={{ color: "var(--text)" }}>HTML analysis</strong> — We parse the page source to detect tech
            stack, structured data (JSON-LD), resource hints, accessibility attributes, cookie consent, third-party
            scripts, and CDN asset URLs.
          </li>
          <li style={{ marginBottom: 14 }}>
            <strong style={{ color: "var(--text)" }}>Well-known paths</strong> — We check for the presence of:
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              <li>
                <code style={codeInline}>/robots.txt</code> — crawler directives
              </li>
              <li>
                <code style={codeInline}>/ads.txt</code> — ad inventory transparency
              </li>
              <li>
                <code style={codeInline}>/sitemap.xml</code> — search engine discovery
              </li>
              <li>
                <code style={codeInline}>/.well-known/security.txt</code> — vulnerability disclosure policy
              </li>
              <li>
                <code style={codeInline}>/manifest.json</code> / <code style={codeInline}>/manifest.webmanifest</code> —
                PWA readiness
              </li>
              <li>
                <code style={codeInline}>/.well-known/apple-app-site-association</code> — iOS app links
              </li>
            </ul>
          </li>
          <li style={{ marginBottom: 14 }}>
            <strong style={{ color: "var(--text)" }}>Legal page discovery</strong> — We probe common paths (
            <code style={codeInline}>/privacy</code>, <code style={codeInline}>/terms</code>,{" "}
            <code style={codeInline}>/about</code>, etc.) via HEAD requests.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>PageSpeed Insights</strong> — We call Google's PageSpeed Insights
            API for Core Web Vitals (LCP, CLS, INP) on both mobile and desktop.
          </li>
        </ol>
      </Section>

      {/* ── Our Scanner Identity ────────────────────────────────────── */}
      <Section title="Our Scanner Identity">
        <P>
          <strong style={{ color: "var(--text)" }}>User-Agent strings:</strong>
        </P>
        <P>Our primary scanner identifies as a standard Chrome browser:</P>
        <CodeBlock code="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" />

        <P style={{ marginTop: 16 }}>For some probes (network health, news, social), we use:</P>
        <CodeBlock code="Mozilla/5.0 (compatible; Yoke/1.0; +https://github.com/yokedotlol/yoke)" />

        <P style={{ marginTop: 20 }}>
          <strong style={{ color: "var(--text)" }}>IP ranges:</strong>
        </P>
        <P>
          Yoke scans from two locations:{" "}
          <A href="https://www.cloudflare.com/ips/">Cloudflare Workers</A> (DNS, API orchestration)
          and a <A href="https://fly.io">Fly.io</A> proxy (HTTP probes, SSL checks, geolocation).
        </P>
        <P>PageSpeed Insights data comes from Google's infrastructure — we don't control those IPs.</P>

        <P style={{ marginTop: 20 }}>
          <strong style={{ color: "var(--text)" }}>If your WAF blocks us:</strong>
        </P>
        <P>
          If your firewall or WAF blocks our requests, some signals may show as "not detected" even if they exist. To
          ensure accurate results:
        </P>
        <ol
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            color: "var(--dim)",
            lineHeight: "22px",
            paddingLeft: 20,
            margin: 0,
          }}
        >
          <li>
            Whitelist <A href="https://www.cloudflare.com/ips/">Cloudflare's IP ranges</A>
          </li>
          <li>Ensure your WAF doesn't block requests without cookies</li>
          <li>Check that your CDN passes through standard response headers</li>
        </ol>
      </Section>

      {/* ── How Scoring Works ───────────────────────────────────────── */}
      <Section title="How Scoring Works">
        <P>
          <strong style={{ color: "var(--text)" }}>Budget-based deductive scoring:</strong> Each of the 6 axes starts at
          100 points. Points are deducted for issues found and for expected signals that are absent.
        </P>

        <P style={{ marginTop: 20 }}>
          <strong style={{ color: "var(--text)" }}>Six axes with weights:</strong>
        </P>
        <SimpleTable
          headers={["Axis", "Weight", "What it measures"]}
          rows={[
            ["Security", "24%", "HTTPS, headers (HSTS, CSP, X-Frame-Options), WAF, certificate quality"],
            ["Speed", "18%", "Core Web Vitals (LCP, CLS, INP), HTTP/2, CDN, compression"],
            ["Foundations", "18%", "DNS health, IPv6, structured data, well-known files, legal pages"],
            ["Reputation", "15%", "Domain age, Tranco ranking, breach history"],
            ["Discoverability", "13%", "SEO meta tags, Open Graph, robots.txt, sitemap, ads.txt"],
            ["Email", "12%", "MX records, SPF, DKIM, DMARC configuration"],
          ]}
        />

        <P style={{ marginTop: 20 }}>
          <strong style={{ color: "var(--text)" }}>Absent signal penalty:</strong> Signals we look for but don't find
          incur a smaller deduction, weighted by how common they are across the web. Missing HTTPS (which 95%+ of sites
          have) costs more than missing HTTP/3 (which only ~30% have). This is called IDF-influenced absent penalty.
        </P>

        <P style={{ marginTop: 16 }}>
          <strong style={{ color: "var(--text)" }}>Composite score:</strong> Weighted average of all six axis scores. If
          any single axis drops below 40, the composite is capped at Moderate tier (≤74), regardless of other axes.
        </P>

        <P style={{ marginTop: 20 }}>
          <strong style={{ color: "var(--text)" }}>Tier thresholds:</strong>
        </P>
        <SimpleTable
          headers={["Tier", "Score range"]}
          rows={[
            ["Excellent", "90–100"],
            ["Strong", "78–89"],
            ["Moderate", "60–77"],
            ["Weak", "40–59"],
            ["Critical", "0–39"],
          ]}
        />

        <P style={{ marginTop: 16 }}>
          Every deduction is visible in the <strong style={{ color: "var(--text)" }}>Score Breakdown</strong> tab of
          your scan results — nothing is hidden.{" "}
          <a href="/docs#signals" style={{ color: "var(--accent)", textDecoration: "none" }}>
            See our full signal reference →
          </a>
        </P>
      </Section>

      {/* ── Rate Limits ─────────────────────────────────────────────── */}
      <Section title="Rate Limits">
        <SimpleTable
          headers={["Endpoint", "Limit", "Window"]}
          rows={[
            ["Domain scan", "50 requests", "per hour"],
            ["Compare", "50 requests", "per hour"],
            ["Subdomain scan", "30 requests", "per hour"],
            ["Availability check", "60 requests", "per hour"],
          ]}
        />

        <P style={{ marginTop: 16 }}>
          Rate limits are per IP address. Cached results don't count against your limit — if we've recently scanned a
          domain, you get the cached result for free.
        </P>
        <P>
          If you hit a rate limit, wait for the window to reset. For bulk scanning needs, consider the{" "}
          <a href="/cli" style={{ color: "var(--accent)" }}>
            Yoke CLI
          </a>
          .
        </P>
      </Section>

      {/* ── Troubleshooting FAQ ─────────────────────────────────────── */}
      <Section title="Troubleshooting">
        <Collapsible title={`"My score seems wrong"`}>
          <P>
            Every deduction is listed in the Score Breakdown tab. Click any signal to see what we checked and why points
            were deducted. If a specific detection is incorrect,{" "}
            <A href="https://github.com/yokedotlol/yoke/issues/new?template=false-positive.yml">
              report it as a false positive
            </A>
            .
          </P>
        </Collapsible>

        <Collapsible title={`"Yoke can't scan my site"`}>
          <P style={{ marginBottom: 8 }}>Common causes:</P>
          <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            <li>Your WAF blocks requests from Cloudflare or Fly.io IP ranges</li>
            <li>Your server requires cookies or JavaScript to respond</li>
            <li>DNS doesn't resolve or HTTPS certificate is invalid</li>
            <li>The domain is behind a login wall</li>
          </ul>
          <P>
            Solution: Whitelist <A href="https://www.cloudflare.com/ips/">Cloudflare IP ranges</A> and ensure your root
            URL responds to a standard GET request.
          </P>
        </Collapsible>

        <Collapsible title={`"Why didn't Yoke detect my [header/feature]?"`}>
          <P style={{ marginBottom: 8 }}>Common reasons a signal might not be detected:</P>
          <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            <li>The header is only served on specific paths (we check the root URL)</li>
            <li>The header is conditional on User-Agent or cookies</li>
            <li>Your CDN strips the header before it reaches us</li>
            <li>The feature is behind authentication</li>
          </ul>
          <P>
            Try: <code style={codeInline}>curl -sI https://your-domain.com</code> — if the header appears there,{" "}
            <A href="https://github.com/yokedotlol/yoke/issues/new?template=false-positive.yml">
              report it as a false positive
            </A>
            .
          </P>
        </Collapsible>

        <Collapsible title={`"How do I improve my score?"`}>
          <P>
            Each signal in the Score Breakdown shows an effort level (⚡ Quick Win, 🔧 Moderate, 🏗️ Major) and fix
            guidance. Focus on Quick Wins first for the fastest improvement.
          </P>
        </Collapsible>
      </Section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
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
        <span>
          Found a bug or detection issue?{" "}
          <A href="https://github.com/yokedotlol/yoke/issues/new/choose">Report it on GitHub</A>
        </span>
        <span style={{ color: "var(--border)" }}>·</span>
        <a href="/" style={{ color: "var(--accent)", textDecoration: "none" }}>
          yoke.lol
        </a>
        <span style={{ color: "var(--border)" }}>·</span>
        <A href="https://github.com/yokedotlol/yoke">GitHub</A>
      </div>
    </div>
  );
}

/* Inline code style constant */
const codeInline: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text)",
  background: "var(--bg)",
  padding: "2px 6px",
  borderRadius: 4,
  fontFamily: "var(--font-mono)",
};
