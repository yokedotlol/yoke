import { CheckCircle, Cookie, ExternalLink, Scale, XCircle } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { DataRow, Panel, StatusBadge } from "./Panel";

export function LegalPanel({ data }: { data: AnalysisResult }) {
  const legal = data.legal;
  if (!legal) return null;

  const expectedPages = ["Privacy Policy", "Terms of Service", "Cookie Policy", "Accessibility", "GDPR", "Imprint"];
  const foundNames = new Set(legal.pages_found.map((p) => p.name));

  return (
    <Panel
      title="Legal & Compliance"
      icon={<Scale size={14} />}
      badge={
        <div className="flex items-center gap-1.5">
          <StatusBadge
            status={legal.pages_found.length >= 2 ? "pass" : legal.pages_found.length > 0 ? "warn" : "fail"}
            label={`${legal.pages_found.length} found`}
          />
          {legal.cookie_consent_detected && <StatusBadge status="pass" label="Consent ✓" />}
        </div>
      }
    >
      {/* Page checklist */}
      <div className="sub-section">Legal Pages</div>
      {expectedPages.map((name, _i) => {
        const found = foundNames.has(name);
        const page = legal.pages_found.find((p) => p.name === name);
        return (
          <div key={name} className="data-row" style={{ alignItems: "center" }}>
            <div className="flex items-center gap-2.5">
              {found ? (
                <CheckCircle size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
              ) : (
                <XCircle size={12} style={{ color: "var(--dim)", flexShrink: 0 }} />
              )}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "12px",
                  color: found ? "var(--text)" : "var(--dim)",
                }}
              >
                {name}
              </span>
            </div>
            {page && (
              <div className="flex items-center gap-1.5">
                {page.source === "spa-inferred" && (
                  <span
                    style={{
                      fontSize: "9px",
                      color: "var(--dim)",
                      fontFamily: "var(--font-ui)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                    title="Detected via SPA client-side routing"
                  >
                    SPA
                  </span>
                )}
                {page.source === "sitemap" && (
                  <span
                    style={{
                      fontSize: "9px",
                      color: "var(--dim)",
                      fontFamily: "var(--font-ui)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                    title="Found in sitemap.xml"
                  >
                    sitemap
                  </span>
                )}
                <a
                  href={page.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: "11px", textDecoration: "none" }}
                  title={page.url}
                >
                  <ExternalLink size={11} />
                </a>
              </div>
            )}
          </div>
        );
      })}

      {/* Cookie consent */}
      <div className="sub-section">Cookie Consent</div>
      <DataRow
        label="Consent Banner"
        value={
          legal.cookie_consent_detected ? (
            <StatusBadge status="pass" label="Detected" />
          ) : (
            <StatusBadge status="neutral" label="Not detected" />
          )
        }
      />
      {legal.consent_provider && (
        <DataRow
          label="Provider"
          value={
            <div className="flex items-center gap-1.5">
              <Cookie size={11} style={{ color: "var(--accent)" }} />
              <span>{legal.consent_provider}</span>
            </div>
          }
          copyValue={legal.consent_provider}
        />
      )}
    </Panel>
  );
}
