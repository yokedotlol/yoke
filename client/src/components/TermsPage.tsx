import { Scale } from "lucide-react";

export default function TermsPage() {
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
        <Scale size={24} /> Terms of Service
      </h1>
      <p style={{ color: "var(--dim)", fontSize: "0.85rem", marginBottom: "2rem" }}>
        <strong>Last updated:</strong> June 2026
      </p>

      <Section title="Service">
        <p>
          Yoke is a free, open-source domain intelligence tool that aggregates publicly available information about
          internet domains.
        </p>
      </Section>

      <Section title="Use">
        <p>
          You may use Yoke for lawful purposes only. You must be authorized to analyze any domain you submit. Do not use
          this service for unauthorized reconnaissance, harassment, or any activity that violates applicable law. Do not
          abuse the service with excessive automated requests. Rate limits are applied per IP to ensure fair access.
        </p>
      </Section>

      <Section title="Data Accuracy">
        <p>
          Information is provided as-is from public sources. We make no guarantees about accuracy or completeness.
          Domain scores are heuristic assessments, not security certifications.
        </p>
      </Section>

      <Section title="Open Source">
        <p>
          Yoke is{" "}
          <a href="https://github.com/yokedotlol/yoke" style={{ color: "var(--accent)" }}>
            MIT-licensed
          </a>
          . You may self-host, fork, or contribute. Third-party dependencies are listed in{" "}
          <a
            href="https://github.com/yokedotlol/yoke/blob/main/docs/THIRD-PARTY-NOTICES.md"
            style={{ color: "var(--accent)" }}
          >
            THIRD-PARTY-NOTICES.md
          </a>
          .
        </p>
      </Section>

      <Section title="Liability">
        <p>
          Yoke is provided without warranty of any kind, express or implied. We are not liable for decisions made based
          on information displayed by this tool.
        </p>
      </Section>

      <Section title="Changes">
        <p>We may update these terms. Continued use constitutes acceptance of updated terms.</p>
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
