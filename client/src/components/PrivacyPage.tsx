import { BookOpen } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "2rem 1.5rem",
        fontFamily: "var(--font-ui)",
        color: "var(--text)",
        lineHeight: 1.7,
      }}
    >
      <a
        href="/"
        style={{
          color: "var(--accent)",
          textDecoration: "none",
          fontSize: "0.9rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "0.3rem",
          marginBottom: "1.5rem",
        }}
      >
        ← Back to Yoke
      </a>

      <h1
        style={{
          fontSize: "1.75rem",
          fontWeight: 700,
          color: "var(--accent)",
          marginBottom: "0.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <BookOpen size={24} /> Privacy Policy
      </h1>
      <p style={{ color: "var(--dim)", fontSize: "0.85rem", marginBottom: "2rem" }}>
        <strong>Last updated:</strong> May 2026
      </p>

      <Section title="What We Collect">
        <p>
          When you analyze a domain, we collect only the domain name you submit. We do not use cookies, trackers, or
          fingerprinting. No accounts, no emails, no personal information.
        </p>
      </Section>

      <Section title="Caching">
        <p>
          Analysis results are cached in our database for up to 24 hours to improve performance. Cached data includes
          only publicly available DNS, WHOIS, SSL, and HTTP header information about the domains you analyze.
        </p>
      </Section>

      <Section title="BYO API Key (AI Analysis)">
        <p>
          Yoke's AI tab lets you bring your own{" "}
          <a href="https://openrouter.ai" style={{ color: "var(--accent)" }}>
            OpenRouter
          </a>{" "}
          API key. Here's exactly how it works:
        </p>
        <ul style={{ paddingLeft: "1.5rem", margin: "0.75rem 0" }}>
          <li>
            <strong>Storage:</strong> Your API key is saved in your browser's{" "}
            <code style={{ background: "var(--surface)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
              localStorage
            </code>{" "}
            — on your device, under your control.
          </li>
          <li>
            <strong>In flight:</strong> When you run an AI analysis, your key is sent to Yoke's server as part of the
            request. The server passes it through to OpenRouter to fulfill the API call, then discards it. We don't log
            or store your key at any point — it exists in memory only for the duration of that single request.
          </li>
          <li>
            <strong>Removal:</strong> Click "Remove key" in the Advanced panel, or clear your browser's site data.
            That's it — there's nothing to delete on our side because we never stored it.
          </li>
          <li>
            <strong>Without a key:</strong> You still get 10 AI analyses per hour using Yoke's shared platform key. No
            key required for any other feature.
          </li>
        </ul>
      </Section>

      <Section title="Third-Party Services">
        <p>
          Analyses may query public APIs including DNS resolvers (Google, Cloudflare), RDAP/WHOIS registries, Shodan
          InternetDB, PageSpeed Insights, and others. Each service has its own privacy policy. When you use a BYO key,
          your AI requests go to{" "}
          <a href="https://openrouter.ai/privacy" style={{ color: "var(--accent)" }}>
            OpenRouter
          </a>
          , which routes to your selected model provider.
        </p>
      </Section>

      <Section title="Analytics">
        <p>
          Yoke is served through{" "}
          <a href="https://www.cloudflare.com/" style={{ color: "var(--accent)" }}>
            Cloudflare
          </a>
          , which collects anonymous server-side request metrics (request count, country, response time). We use no
          client-side analytics scripts.
        </p>
      </Section>

      <Section title="Breach Data">
        <p>
          Breach information is sourced from{" "}
          <a href="https://haveibeenpwned.com" style={{ color: "var(--accent)" }}>
            Have I Been Pwned
          </a>{" "}
          (HIBP). HIBP data is licensed under{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" style={{ color: "var(--accent)" }}>
            CC BY 4.0
          </a>
          . We display breach summaries only — no passwords, hashes, or personal data.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions? Open an issue on{" "}
          <a href="https://github.com/yokedotlol/yoke/issues" style={{ color: "var(--accent)" }}>
            GitHub
          </a>
          .
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "1.75rem" }}>
      <h2
        style={{
          fontSize: "1.15rem",
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: "0.5rem",
          paddingBottom: "0.3rem",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {title}
      </h2>
      <div style={{ color: "var(--dim)", fontSize: "0.95rem" }}>{children}</div>
    </section>
  );
}
