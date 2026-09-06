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
        <strong>Last updated:</strong> September 2026
      </p>

      <Section title="What We Collect">
        <p>
          When you analyze a domain, we collect the domain name you submit. We do not use cookies, trackers, or
          fingerprinting. No accounts, no emails, no personal information.
        </p>
      </Section>

      <Section title="Rate Limiting & IP Handling">
        <p>
          To prevent abuse, Yoke enforces per-IP rate limits. Your IP address is{" "}
          <strong>never stored in raw form</strong>. Instead, we immediately hash it using SHA-256 with a secret salt.
          The resulting hash is used only to count requests within a rate-limit window — it cannot be reversed to
          recover your IP address.
        </p>
        <p>
          Rate-limit records are automatically cleaned up within hours. No raw IP addresses are written to any database
          or log at any point in the request lifecycle.
        </p>
      </Section>

      <Section title="Anonymous Analytics">
        <p>Yoke keeps hourly aggregate counters to operate the service:</p>
        <ul style={{ paddingLeft: "1.5rem", margin: "0.75rem 0" }}>
          <li>
            <strong>Country code</strong> — derived from Cloudflare's{" "}
            <code style={{ background: "var(--surface)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
              cf-ipcountry
            </code>{" "}
            header (2-letter code only, no geolocation)
          </li>
          <li>
            <strong>Client type</strong> — whether requests came from a browser, CLI, API client, or extension
          </li>
          <li>
            <strong>Operational totals</strong> — request counts, endpoint, HTTP status code, and total response latency
          </li>
        </ul>
        <p>
          These counters contain no IP address or hash, requested domain, request timestamp, or other per-request
          identifier. There are no user accounts, sessions, or tracking pixels.
        </p>
      </Section>

      <Section title="Caching">
        <p>
          Analysis results are cached for up to 24 hours to improve performance. Cached results contain public
          technical, registration, security, performance, reputation, and business information about the domains you
          analyze.
        </p>
      </Section>

      <Section title="BYO API Key (AI Analysis)">
        <p>
          Yoke's AI tab and CLI let you bring your own{" "}
          <a href="https://openrouter.ai" style={{ color: "var(--accent)" }}>
            OpenRouter
          </a>{" "}
          API key. Here's exactly how it works:
        </p>
        <ul style={{ paddingLeft: "1.5rem", margin: "0.75rem 0" }}>
          <li>
            <strong>Storage:</strong> In the browser, your API key is saved in{" "}
            <code style={{ background: "var(--surface)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
              localStorage
            </code>
            . In the CLI, it is saved in{" "}
            <code style={{ background: "var(--surface)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
              ~/.yoke.toml
            </code>
            . Both stay on your device, under your control.
          </li>
          <li>
            <strong>In flight:</strong> When you run an AI analysis, your key is sent to Yoke's server as part of the
            request. The server passes it through to OpenRouter to fulfill the API call, then discards it. We don't log
            or store your key at any point — it exists in memory only for the duration of that single request.
          </li>
          <li>
            <strong>Custom prompts:</strong> If you edit the AI prompt in the browser or configure one in the CLI, that
            prompt is sent through Yoke to OpenRouter with the request. Yoke does not log or store it; the browser copy
            stays in localStorage and the CLI copy stays in ~/.yoke.toml or the prompt file you selected.
          </li>
          <li>
            <strong>Removal:</strong> In the browser, click "Remove key" in the Advanced panel or clear your browser's
            site data. In the CLI, remove{" "}
            <code style={{ background: "var(--surface)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
              openrouter_key
            </code>{" "}
            from{" "}
            <code style={{ background: "var(--surface)", padding: "2px 6px", borderRadius: 4, fontSize: "0.9em" }}>
              ~/.yoke.toml
            </code>
            . That's it — there's nothing to delete on our side because we never stored it.
          </li>
          <li>
            <strong>Without a key:</strong> You still get shared-key AI analysis on yoke.lol within the current free
            limit. No key required for any other feature.
          </li>
        </ul>
      </Section>

      <Section title="Third-Party Services">
        <p>
          Analyses may query public APIs including DNS resolvers (Google, Cloudflare), RDAP/WHOIS registries, Shodan
          InternetDB, PageSpeed Insights, Have I Been Pwned, Brandfetch, and others. Each service has its own privacy
          policy. A full list of data sources is available at{" "}
          <a
            href="https://github.com/yokedotlol/yoke/blob/main/docs/DATA-SOURCES.md"
            style={{ color: "var(--accent)" }}
          >
            DATA-SOURCES.md
          </a>
          . When you use a BYO key, your AI requests go to{" "}
          <a href="https://openrouter.ai/privacy" style={{ color: "var(--accent)" }}>
            OpenRouter
          </a>
          , which routes to your selected model provider.
        </p>
      </Section>

      <Section title="Infrastructure">
        <p>
          Yoke is served through{" "}
          <a href="https://www.cloudflare.com/" style={{ color: "var(--accent)" }}>
            Cloudflare Workers
          </a>
          . Cloudflare collects anonymous server-side request metrics (traffic volume, country, status codes) as part of
          its infrastructure. No cookies, no client-side tracking. See{" "}
          <a href="https://www.cloudflare.com/privacypolicy/" style={{ color: "var(--accent)" }}>
            Cloudflare's privacy policy
          </a>{" "}
          for details.
        </p>
      </Section>

      <Section title="Data Retention">
        <p>
          Rate-limit hashes are cleaned up automatically within hours. Analytics data is retained for 90 days in
          aggregate form but contains no personal identifiers. Domain analysis results are cached for up to 24 hours.
          Domain scores and scan history are retained to power percentile rankings.
        </p>
      </Section>

      <Section title="GDPR">
        <p>
          Yoke does not store raw IP addresses. Short-lived rate-limit keys are pseudonymized via SHA-256 with a
          server-side secret salt before storage and are deleted within hours. Aggregate analytics contain no IP hash or
          other tracking identifier. No cookies or accounts are used. If you have questions about data handling,{" "}
          <a href="https://github.com/yokedotlol/yoke/issues" style={{ color: "var(--accent)" }}>
            open an issue
          </a>
          .
        </p>
      </Section>

      <Section title="Open Source">
        <p>
          Yoke is{" "}
          <a href="https://github.com/yokedotlol/yoke" style={{ color: "var(--accent)" }}>
            open source
          </a>{" "}
          (MIT license). You can audit exactly what data is collected and how it's handled. You can even{" "}
          <a
            href="https://github.com/yokedotlol/yoke/blob/main/docs/SELF-HOSTING.md"
            style={{ color: "var(--accent)" }}
          >
            host it yourself
          </a>{" "}
          with full control.
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
