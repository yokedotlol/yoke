import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, Shield, Zap, Layers, Star, Search, Mail } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AXIS_WEIGHTS,
  SIGNAL_REGISTRY,
  TIER_THRESHOLDS,
} from "../../../worker/src/config/signal-registry";

// ─── Reusable sub-components ────────────────────────────────────────

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

function Section({
  title,
  id,
  children,
}: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ marginBottom: 48, scrollMarginTop: 24 }}>
      <h2
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text)",
          marginBottom: 16,
          letterSpacing: "-0.01em",
          paddingBottom: 8,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function Collapsible({
  title,
  children,
  defaultOpen = false,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
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

// ─── Axis display helpers ───────────────────────────────────────────

const AXIS_DISPLAY: Record<
  string,
  { label: string; description: string; icon: React.ReactNode }
> = {
  security: {
    label: "Security",
    description: "HTTPS, security headers, WAF, SSL/TLS certificate quality, vulnerabilities",
    icon: <Shield size={14} />,
  },
  speed: {
    label: "Speed",
    description: "Core Web Vitals, HTTP/2, CDN, compression, page load performance",
    icon: <Zap size={14} />,
  },
  foundations: {
    label: "Foundations",
    description: "DNS health, IPv6, structured data, well-known files, legal compliance",
    icon: <Layers size={14} />,
  },
  reputation: {
    label: "Reputation",
    description: "Domain age, popularity ranking, data breach history, threat intelligence",
    icon: <Star size={14} />,
  },
  discoverability: {
    label: "Discoverability",
    description: "SEO meta tags, Open Graph, robots.txt, sitemap, structured data",
    icon: <Search size={14} />,
  },
  email: {
    label: "Email",
    description: "MX records, SPF, DKIM, DMARC authentication configuration",
    icon: <Mail size={14} />,
  },
};

const AXIS_ORDER = ["security", "speed", "foundations", "reputation", "discoverability", "email"];

// ─── Signal Reference ───────────────────────────────────────────────

function SignalCard({ id, signal }: { id: string; signal: (typeof SIGNAL_REGISTRY)[string] }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          {signal.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--dim)",
            opacity: 0.6,
          }}
        >
          {id}
        </span>
        {signal.actionable && (
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-ui)",
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(88, 166, 255, 0.1)",
              color: "var(--accent)",
              fontWeight: 500,
            }}
          >
            Actionable
          </span>
        )}
        {signal.requiresHttpAccess && (
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-ui)",
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(234, 179, 8, 0.1)",
              color: "var(--warning, #eab308)",
              fontWeight: 500,
            }}
          >
            Requires HTTP
          </span>
        )}
      </div>

      {signal.promptGuidance && (
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            color: "var(--dim)",
            lineHeight: "18px",
          }}
        >
          {signal.promptGuidance}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          fontFamily: "var(--font-ui)",
          fontSize: 11,
          color: "var(--dim)",
          opacity: 0.8,
        }}
      >
        <span>
          Weight: {signal.weightRange[0]}
          {signal.weightRange[1] !== signal.weightRange[0] && `–${signal.weightRange[1]}`}
        </span>
        {signal.effort && <span>Effort: {signal.effort}</span>}
        {signal.fixDescription && <span>Fix: {signal.fixDescription}</span>}
      </div>
    </div>
  );
}

function AxisSignalGroup({ axis, isFirst }: { axis: string; isFirst: boolean }) {
  const [open, setOpen] = useState(isFirst);
  const display = AXIS_DISPLAY[axis];
  const signals = useMemo(
    () =>
      Object.entries(SIGNAL_REGISTRY).filter(([, def]) => def.axis === axis),
    [axis],
  );

  if (!display || signals.length === 0) return null;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          background: "var(--surface)",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text)",
          textAlign: "left",
        }}
      >
        <span style={{ color: "var(--accent)", display: "flex" }}>{display.icon}</span>
        <span style={{ flex: 1 }}>
          {display.label}
          <span
            style={{
              fontWeight: 400,
              color: "var(--dim)",
              fontSize: 11,
              marginLeft: 8,
            }}
          >
            {signals.length} signals · weight {(AXIS_WEIGHTS[axis as keyof typeof AXIS_WEIGHTS] * 100).toFixed(0)}%
          </span>
        </span>
        {open ? (
          <ChevronUp size={14} style={{ color: "var(--dim)" }} />
        ) : (
          <ChevronDown size={14} style={{ color: "var(--dim)" }} />
        )}
      </button>
      {open && (
        <div>
          <div
            style={{
              padding: "6px 16px 8px",
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              color: "var(--dim)",
              lineHeight: "18px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {display.description}
          </div>
          {signals.map(([id, def]) => (
            <SignalCard key={id} id={id} signal={def} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FAQ Data ───────────────────────────────────────────────────────

const FAQ_ITEMS: { q: string; a: string; persona: string }[] = [
  // Sysadmin
  {
    persona: "sysadmin",
    q: "Why does my score change between scans?",
    a: "Scan results can vary because external data sources (PageSpeed, Shodan, breach databases) update independently. Your server's response time, load balancing, and CDN behavior can also produce slightly different results. Additionally, DNS may return different IPs from different locations. Cached results are served for up to 24 hours — add ?nocache to force a fresh scan.",
  },
  {
    persona: "sysadmin",
    q: "What does \"HTTP probe blocked\" mean?",
    a: "Your site's bot protection (WAF, Cloudflare, etc.) blocked our automated scanner from fetching your pages. We can still analyze DNS, SSL, WHOIS, and email authentication, but signals that require page access — like security headers, Core Web Vitals, and structured data — are excluded from scoring. Your score reflects only what we could measure, and blocked signals don't count against you.",
  },
  {
    persona: "sysadmin",
    q: "How do I whitelist Yoke's scanner?",
    a: "Yoke scans from two locations: Cloudflare Workers (DNS, API orchestration) and a Fly.io proxy (HTTP probes, SSL checks, geolocation). If you want full coverage, allow the User-Agent \"Yoke/1.0\" in your WAF rules. However, Yoke is designed to produce fair scores even when blocked — blocked signals are excluded, not penalized.",
  },
  // Freelancer
  {
    persona: "freelancer",
    q: "How do I improve my score?",
    a: "Open the Score Breakdown tab to see every deduction, grouped by axis. Items under \"Issues\" are things found that hurt the score. Items under \"Improvements\" are things we looked for but didn't find. Each item shows an effort estimate and a fix description. Focus on the highest-deduction items first for the biggest impact.",
  },
  {
    persona: "freelancer",
    q: "What's the difference between Issues, Improvements, and Not Assessed?",
    a: "\"Issues\" are problems we found (misconfigured SSL, missing security headers, etc.) — these have the largest deductions. \"Improvements\" are signals we expected but didn't detect (missing DMARC, no structured data, etc.) — these have smaller deductions. \"Not Assessed\" are signals that aren't applicable or couldn't be checked. Only Issues and Improvements affect the score.",
  },
  {
    persona: "freelancer",
    q: "Can I share a report?",
    a: "Yes — use the share buttons above your scan results. You can copy a permalink, download a PDF report, or share directly to X, LinkedIn, or Reddit. The permalink creates a static snapshot with your domain's score and axis breakdown that anyone can view without running a new scan.",
  },
  // Marketing
  {
    persona: "marketing",
    q: "Is a higher score always better?",
    a: "Generally yes, but context matters. A score of 75 for a small business blog is perfectly healthy. A score of 75 for a major bank would be concerning. Yoke adapts its scoring based on domain archetypes — an e-commerce site is held to different standards than a personal blog. Compare scores within the same category for the most meaningful benchmarks.",
  },
  {
    persona: "marketing",
    q: "What does the composite score actually mean?",
    a: "The composite score is a weighted average of six axes: Security (24%), Speed (18%), Foundations (18%), Reputation (15%), Discoverability (13%), and Email (12%). Each axis starts at 100 and subtracts points for issues and missing best practices. The composite gives you one number to track, while individual axes show where to focus.",
  },
  {
    persona: "marketing",
    q: "Can I use Yoke to benchmark competitors?",
    a: "Absolutely. Scan any public domain to see how it compares. The six-axis breakdown is especially useful for competitive analysis — you might score higher overall but discover a competitor has better email authentication or faster page loads. Use the Compare feature to view two domains side by side.",
  },
  // Small business
  {
    persona: "smb",
    q: "Is Yoke free?",
    a: "Yes, completely free and open source (MIT license). No accounts, no sign-ups, no hidden paywalls. You get 50 scans per hour. The API is free too — just curl any domain. AI-powered analysis uses a shared API key with a per-hour limit, or you can bring your own OpenRouter key for unlimited AI analysis.",
  },
  {
    persona: "smb",
    q: "Do you store my data?",
    a: "We cache scan results for up to 24 hours to speed up repeat lookups. We don't use cookies, trackers, or fingerprinting. We don't collect personal information or require an account. All data we analyze is publicly available information about domains (DNS records, SSL certificates, HTTP headers). See our Privacy Policy for full details.",
  },
  {
    persona: "smb",
    q: "What are SPF, DKIM, and DMARC?",
    a: "These are email authentication standards that prevent others from sending fake emails using your domain. SPF lists which servers can send email for you. DKIM adds a cryptographic signature to prove the email wasn't tampered with. DMARC tells receiving servers what to do when SPF or DKIM checks fail. Together, they protect your brand from phishing and spoofing. Every domain benefits from these, even if you don't send email — they prevent abuse of your domain name.",
  },
  {
    persona: "smb",
    q: "My site works fine — why is the score low?",
    a: "\"Works fine\" and \"well-configured\" are different things. Your site might load correctly but be missing security headers, have an outdated TLS configuration, lack email authentication, or be missing SEO best practices. Yoke checks 156 signals across security, performance, infrastructure, reputation, discoverability, and email. Open the Score Breakdown to see exactly what was deducted and why.",
  },
  {
    persona: "smb",
    q: "What should I fix first?",
    a: "Open the Score Breakdown tab and look at the \"Issues\" section — these are sorted by impact. The items at the top cost the most points. Many fixes are quick: adding security headers, setting up DMARC, or enabling HTTPS redirects. Each item shows an effort estimate to help you prioritize. Use the \"What if?\" toggle to simulate how fixing specific items would change your score.",
  },
];

// ─── Main Component ─────────────────────────────────────────────────

export default function DocsPage() {
  // Scroll to hash on mount
  useEffect(() => {
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, []);

  const totalSignals = Object.keys(SIGNAL_REGISTRY).length;

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
          Documentation
        </h1>
        <P style={{ margin: 0 }}>
          How Yoke scores domains, what each signal means, and answers to common questions.
        </P>
        <nav
          style={{
            display: "flex",
            gap: 16,
            marginTop: 16,
            fontFamily: "var(--font-ui)",
            fontSize: 12,
          }}
        >
          <a href="#faq" style={{ color: "var(--accent)", textDecoration: "none" }}>
            FAQ
          </a>
          <a href="#scoring" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Scoring
          </a>
          <a href="#signals" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Signal Reference
          </a>
        </nav>
      </div>

      {/* ── FAQ ──────────────────────────────────────────────────── */}
      <Section title="Frequently Asked Questions" id="faq">
        {FAQ_ITEMS.map((item) => (
          <Collapsible key={item.q} title={item.q}>
            <P style={{ margin: 0 }}>{item.a}</P>
          </Collapsible>
        ))}
      </Section>

      {/* ── Scoring Methodology ──────────────────────────────────── */}
      <Section title="Scoring Methodology" id="scoring">
        <P>
          <strong style={{ color: "var(--text)" }}>Budget-based deductive model.</strong> Every
          axis starts at 100 points. Points are deducted for issues found during the scan and for
          expected signals that weren't detected. The result is a score from 0 to 100 for each
          axis, combined into a single composite score.
        </P>

        <h3
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            margin: "20px 0 10px",
          }}
        >
          Six Axes
        </h3>
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
                {["Axis", "Weight", "What it measures"].map((h) => (
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
              {AXIS_ORDER.map((axis) => {
                const d = AXIS_DISPLAY[axis];
                const w = AXIS_WEIGHTS[axis as keyof typeof AXIS_WEIGHTS];
                return (
                  <tr key={axis}>
                    <td
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                        color: "var(--text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {d?.label ?? axis}
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                        color: "var(--dim)",
                      }}
                    >
                      {(w * 100).toFixed(0)}%
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid var(--border)",
                        color: "var(--dim)",
                      }}
                    >
                      {d?.description ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            margin: "24px 0 10px",
          }}
        >
          Composite Score & Tiers
        </h3>
        <P>
          The composite score is a weighted average of all six axis scores. If any single axis
          drops below 40, the composite is capped at the Moderate tier maximum (74) regardless
          of how well other axes perform. This prevents a critical weakness from being masked by
          strong performance elsewhere.
        </P>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              maxWidth: 300,
            }}
          >
            <thead>
              <tr>
                {["Tier", "Score range"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderBottom: "2px solid var(--border)",
                      color: "var(--text)",
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Excellent", "90–100"],
                ["Strong", "78–89"],
                ["Moderate", "60–77"],
                ["Weak", "40–59"],
                ["Critical", "0–39"],
              ].map(([tier, range]) => (
                <tr key={tier}>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    {tier}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--dim)",
                    }}
                  >
                    {range}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            margin: "24px 0 10px",
          }}
        >
          Absent Signal Penalty
        </h3>
        <P>
          Signals we look for but don't find incur a smaller deduction than active issues,
          weighted by how common they are across the web. Missing HTTPS (which 95%+ of sites
          have) costs more than missing HTTP/3 (which only ~30% have). This IDF-influenced
          penalty prevents unfair scoring for emerging best practices that aren't yet widely
          adopted.
        </P>

        <h3
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            margin: "24px 0 10px",
          }}
        >
          Deductive Scoring
        </h3>
        <P>
          Yoke detects domain archetypes — e-commerce, SaaS, institutional, content, marketing,
          infrastructure, and general — for display context, but all domains are scored against
          the same criteria. Some signals only apply when specific technologies are detected
          (WordPress-specific checks, cookie-related headers), and signals that aren't applicable
          are excluded rather than penalized.
        </P>

        <h3
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            margin: "24px 0 10px",
          }}
        >
          "Not Assessed" Signals
        </h3>
        <P>
          When our HTTP probe is blocked by a site's bot protection, signals that require page
          access (security headers, Core Web Vitals, tech detection, etc.) are excluded from
          scoring rather than penalized. Your score reflects only what we could actually measure.
          A banner in the Score Breakdown indicates when this applies.
        </P>

        <h3
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            margin: "24px 0 10px",
          }}
        >
          AI Readiness Score
        </h3>
        <P>
          Separate from the six-axis composite, Yoke calculates an AI Readiness score (0–100)
          that measures how well a domain is prepared for AI agents and LLM crawlers. This
          appears in the Tech Stack tab and is graded A–F. It checks:
        </P>
        <ul style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--dim)", margin: "8px 0 8px 20px", lineHeight: 1.7 }}>
          <li><strong style={{ color: "var(--text)" }}>llms.txt / llms-full.txt</strong> — structured content files for LLM consumption</li>
          <li><strong style={{ color: "var(--text)" }}>robots.txt AI bot rules</strong> — whether GPTBot, ClaudeBot, and Bingbot are allowed or blocked</li>
          <li><strong style={{ color: "var(--text)" }}>Structured data (JSON-LD)</strong> — schema.org markup that helps AI understand page content</li>
          <li><strong style={{ color: "var(--text)" }}>Open Graph tags</strong> — metadata for rich previews in AI-generated citations</li>
          <li><strong style={{ color: "var(--text)" }}>RSS/Atom feed</strong> — machine-readable content syndication</li>
          <li><strong style={{ color: "var(--text)" }}>ANS record</strong> — DNS-based agent namespace discovery (<code>_ans.</code> TXT record)</li>
          <li><strong style={{ color: "var(--text)" }}>DNS-AID record</strong> — agent identity discovery (<code>_agents.</code> TXT record)</li>
          <li><strong style={{ color: "var(--text)" }}>agent.json</strong> — well-known endpoint for agent capability negotiation</li>
        </ul>
        <P>
          AI Readiness does not affect the composite domain score. It{"'"}s an independent metric
          for sites that want to optimize for the emerging AI agent ecosystem.
        </P>
      </Section>

      {/* ── Signal Reference ─────────────────────────────────────── */}
      <Section title="Signal Reference" id="signals">
        <P>
          Yoke evaluates {totalSignals} signals across six axes. Each signal can detect a good
          configuration, a problem, or nothing (absent). Below is the complete registry — the
          same data that drives scoring.
        </P>
        <P style={{ marginBottom: 16 }}>
          <strong style={{ color: "var(--text)" }}>Legend:</strong>{" "}
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-ui)",
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(88, 166, 255, 0.1)",
              color: "var(--accent)",
              fontWeight: 500,
              marginRight: 8,
            }}
          >
            Actionable
          </span>{" "}
          = you can fix this.{" "}
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-ui)",
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(234, 179, 8, 0.1)",
              color: "var(--warning, #eab308)",
              fontWeight: 500,
            }}
          >
            Requires HTTP
          </span>{" "}
          = excluded when probe is blocked.
        </P>

        {AXIS_ORDER.map((axis, i) => (
          <AxisSignalGroup key={axis} axis={axis} isFirst={i === 0} />
        ))}
      </Section>

      {/* Footer nav */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 24,
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
        }}
      >
        <a href="/about" style={{ color: "var(--accent)", textDecoration: "none" }}>
          About Yoke
        </a>
        <a href="/api/docs" style={{ color: "var(--accent)", textDecoration: "none" }}>
          API Documentation
        </a>
        <a
          href="https://github.com/yokedotlol/yoke"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          GitHub <ExternalLink size={10} />
        </a>
        <a
          href="https://github.com/yokedotlol/yoke/issues"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          Report an issue
        </a>
      </div>
    </div>
  );
}
