import { ExternalLink, Lock, ShieldCheck } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { CliButton, headersCliCommands, sslCliCommands } from "./CliModal";
import { DataRow, ErrorState, GradeBadge, Panel, StatusBadge } from "./Panel";
import { Tooltip } from "./Tooltip";

/** Links to MDN documentation for each security header. */
const HEADER_DOCS: Record<string, string> = {
  "strict-transport-security":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security",
  "content-security-policy":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy",
  "x-frame-options": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options",
  "x-content-type-options":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options",
  "referrer-policy": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy",
  "permissions-policy": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy",
  "x-xss-protection": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-XSS-Protection",
  "cross-origin-opener-policy":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy",
  "cross-origin-embedder-policy":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy",
  "cross-origin-resource-policy":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Resource-Policy",
};

const HEADER_TOOLTIPS: Record<string, string> = {
  "strict-transport-security":
    "HSTS forces browsers to only connect via HTTPS, preventing downgrade attacks and cookie hijacking",
  "content-security-policy":
    "CSP restricts what resources (scripts, styles, images) a page can load, mitigating cross-site scripting (XSS) attacks",
  "x-frame-options":
    "Prevents the page from being embedded in iframes on other sites, protecting against clickjacking attacks",
  "x-content-type-options":
    "Stops browsers from guessing (MIME-sniffing) the content type, preventing attacks that exploit type confusion",
  "referrer-policy":
    "Controls how much URL information is shared when navigating to other sites, protecting user privacy",
  "permissions-policy": "Restricts which browser features (camera, microphone, geolocation) the page can use",
  "x-xss-protection": "Legacy XSS filter (largely replaced by CSP). Some browsers still respect it as an extra layer",
  "cross-origin-opener-policy": "Isolates the browsing context to prevent cross-origin attacks like Spectre",
  "cross-origin-embedder-policy":
    "Controls whether the page can load cross-origin resources, enabling shared memory features",
  "cross-origin-resource-policy": "Prevents other sites from reading this site's resources, blocking data leaks",
  "cache-control": "Controls how browsers and CDNs cache responses — improper caching can leak sensitive data",
  "x-permitted-cross-domain-policies": "Restricts Flash and PDF cross-domain data loading (legacy but still checked)",
  nel: "Network Error Logging — reports network errors to a specified endpoint for monitoring",
  "expect-ct": "Certificate Transparency — ensures the site's SSL cert is publicly logged (now largely automated)",
};

const SSL_GRADE_TOOLTIPS: Record<string, string> = {
  "A+": "Excellent — strong configuration with HSTS. Best possible rating.",
  A: "Strong — secure configuration, no significant weaknesses found.",
  "A-": "Good — minor configuration improvements possible.",
  B: "Adequate — some legacy cipher suites or missing best practices.",
  C: "Weak — outdated protocols or cipher suites in use.",
  D: "Insecure — significant vulnerabilities or weak encryption.",
  F: "Failing — critical security issues detected.",
  T: "Certificate not trusted — self-signed or invalid cert chain.",
  Valid: "SSL certificate detected — full grade pending from SSL Labs.",
};

export function SslPanel({ data }: { data: AnalysisResult }) {
  const ssl = data.ssl;
  if (!ssl)
    return (
      <Panel title="SSL / TLS" icon={<Lock size={14} />}>
        <ErrorState message="SSL analysis unavailable" />
      </Panel>
    );

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return iso;
    }
  };

  const gradeTooltip = ssl.grade ? (SSL_GRADE_TOOLTIPS[ssl.grade] ?? `SSL Labs grade: ${ssl.grade}`) : "";

  return (
    <Panel
      title="SSL / TLS"
      icon={<Lock size={14} />}
      badge={
        <div className="flex items-center gap-1.5">
          <CliButton commands={sslCliCommands(data.domain)} domain={data.domain} />
          {ssl.grade ? (
            <Tooltip text={gradeTooltip}>
              <span style={{ cursor: "help" }}>
                <GradeBadge grade={ssl.grade} />
              </span>
            </Tooltip>
          ) : ssl.error ? (
            <StatusBadge status="warn" label="N/A" />
          ) : undefined}
        </div>
      }
    >
      {ssl.error && (
        <div className="px-4 py-3" style={{ color: "var(--dim)", fontFamily: "var(--font-ui)", fontSize: "12px" }}>
          {ssl.error}
        </div>
      )}
      {ssl.subject && ssl.subject !== data.domain && <DataRow label="Subject" value={ssl.subject} />}
      {ssl.issuer && <DataRow label="Issuer" value={ssl.issuer} />}
      {ssl.valid_from && <DataRow label="Valid From" value={formatDate(ssl.valid_from)} />}
      {ssl.valid_to && <DataRow label="Valid To" value={formatDate(ssl.valid_to)} />}
      {ssl.protocols.length > 0 && (
        <DataRow
          label="Protocols"
          value={
            <div className="flex flex-wrap gap-1.5 justify-end">
              {ssl.protocols.map((p, _i) => (
                <Tooltip
                  key={p}
                  text={
                    p.includes("1.3")
                      ? "TLS 1.3 — latest and most secure protocol"
                      : p.includes("1.2")
                        ? "TLS 1.2 — widely supported and secure"
                        : p.includes("1.1") || p.includes("1.0")
                          ? "Outdated protocol — should be disabled"
                          : `Protocol: ${p}`
                  }
                >
                  <span className="badge badge-info" style={{ fontSize: "10px", cursor: "help" }}>
                    {p}
                  </span>
                </Tooltip>
              ))}
            </div>
          }
          copyValue={ssl.protocols.join(", ")}
        />
      )}
      {ssl.key_exchange && <DataRow label="Key Exchange" value={ssl.key_exchange} />}
      {!ssl.issuer &&
        !ssl.valid_from &&
        !ssl.valid_to &&
        ssl.protocols.length === 0 &&
        !ssl.key_exchange &&
        !ssl.error && (
          <div className="px-4 py-3" style={{ color: "var(--dim)", fontFamily: "var(--font-ui)", fontSize: "12px" }}>
            Certificate details unavailable — only the grade could be determined
          </div>
        )}
      {ssl.forward_secrecy != null && (
        <DataRow
          label="Forward Secrecy"
          value={
            <Tooltip
              text={
                ssl.forward_secrecy
                  ? "Past sessions stay safe even if the private key is compromised"
                  : "Without forward secrecy, compromised keys decrypt past sessions"
              }
            >
              <span
                className={`badge ${ssl.forward_secrecy ? "badge-good" : "badge-warn"}`}
                style={{ fontSize: "10px", cursor: "help" }}
              >
                {ssl.forward_secrecy ? "✓ Enabled" : "✗ Not enabled"}
              </span>
            </Tooltip>
          }
        />
      )}
      {ssl.ocsp_stapling != null && (
        <DataRow
          label="OCSP Stapling"
          value={
            <Tooltip
              text={
                ssl.ocsp_stapling
                  ? "Certificate revocation status included in TLS handshake"
                  : "Client must check revocation status separately"
              }
            >
              <span
                className={`badge ${ssl.ocsp_stapling ? "badge-good" : "badge-dim"}`}
                style={{ fontSize: "10px", cursor: "help" }}
              >
                {ssl.ocsp_stapling ? "✓ Enabled" : "Not detected"}
              </span>
            </Tooltip>
          }
        />
      )}
      {ssl.has_scts != null && (
        <DataRow
          label="Certificate Transparency"
          value={
            <Tooltip
              text={
                ssl.has_scts
                  ? `${ssl.sct_count} Signed Certificate Timestamp(s) — certificate is publicly logged`
                  : "No SCTs found — certificate may not be publicly logged"
              }
            >
              <span
                className={`badge ${ssl.has_scts ? "badge-good" : "badge-dim"}`}
                style={{ fontSize: "10px", cursor: "help" }}
              >
                {ssl.has_scts ? `✓ ${ssl.sct_count} SCT${(ssl.sct_count ?? 0) > 1 ? "s" : ""}` : "No SCTs"}
              </span>
            </Tooltip>
          }
        />
      )}
      {ssl.ciphers && ssl.ciphers.length > 0 && (
        <DataRow
          label="Cipher Suites"
          value={
            <div className="flex flex-wrap gap-1.5 justify-end">
              {ssl.ciphers.map((c) => (
                <Tooltip key={c.name} text={`${c.name} — ${c.strength}`}>
                  <span
                    className={`badge ${c.strength === "strong" ? "badge-good" : c.strength === "acceptable" ? "badge-info" : "badge-warn"}`}
                    style={{ fontSize: "9px", cursor: "help" }}
                  >
                    {c.name
                      .replace(/^TLS_/, "")
                      .replace(/^ECDHE_/, "")
                      .substring(0, 30)}
                  </span>
                </Tooltip>
              ))}
            </div>
          }
          copyValue={ssl.ciphers.map((c) => `${c.name} (${c.strength})`).join("\n")}
        />
      )}
      <div className="px-4 py-2" style={{ borderTop: "1px solid var(--border-muted)" }}>
        <a
          href={`https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(data.domain)}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--accent)", textDecoration: "none" }}
        >
          Deep dive on SSL Labs →
        </a>
      </div>
    </Panel>
  );
}

export function SecurityHeadersPanel({ data }: { data: AnalysisResult }) {
  const headers = data.headers;
  if (!headers)
    return (
      <Panel title="Security Headers" icon={<ShieldCheck size={14} />}>
        <ErrorState message="HTTP headers unavailable" />
      </Panel>
    );

  const passCount = headers.security_audit.filter((h) => h.status === "pass").length;
  const totalCount = headers.security_audit.length;

  return (
    <Panel
      title="Security Headers"
      icon={<ShieldCheck size={14} />}
      badge={
        <div className="flex items-center gap-2">
          <CliButton commands={headersCliCommands(data.domain)} domain={data.domain} />
          <Tooltip text={`${passCount} of ${totalCount} recommended security headers are present`}>
            <span style={{ cursor: "help" }}>
              <StatusBadge
                status={passCount === totalCount ? "pass" : passCount > totalCount / 2 ? "warn" : "fail"}
                label={`${passCount}/${totalCount}`}
              />
            </span>
          </Tooltip>
          <Tooltip text="Overall security headers grade. A = most headers present, F = most headers missing.">
            <span style={{ cursor: "help" }}>
              <GradeBadge grade={headers.security_grade} />
            </span>
          </Tooltip>
        </div>
      }
    >
      {headers.security_audit.map((check, _i) => {
        const headerKey = check.header.toLowerCase();
        const tooltip = HEADER_TOOLTIPS[headerKey];
        const docUrl = HEADER_DOCS[headerKey];
        const headerLabel = (
          <div className="flex items-center gap-2.5 min-w-0 flex-shrink-0">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background:
                  check.status === "pass"
                    ? "var(--success)"
                    : check.status === "fail"
                      ? "var(--danger)"
                      : "var(--warning)",
              }}
            />
            {tooltip ? (
              <Tooltip text={tooltip}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    cursor: "help",
                    color:
                      check.status === "pass"
                        ? "var(--text)"
                        : check.status === "fail"
                          ? "var(--danger)"
                          : "var(--warning)",
                    borderBottom: "1px dotted var(--dim)",
                  }}
                >
                  {check.header}
                </span>
              </Tooltip>
            ) : (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color:
                    check.status === "pass"
                      ? "var(--text)"
                      : check.status === "fail"
                        ? "var(--danger)"
                        : "var(--warning)",
                }}
              >
                {check.header}
              </span>
            )}
            {docUrl && (
              <a
                href={docUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={9} style={{ color: "var(--muted)", opacity: 0.7 }} />
              </a>
            )}
          </div>
        );
        const displayValue = check.value ? (
          <span className="break-all" style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--dim)" }}>
            {check.value.length > 60 ? `${check.value.slice(0, 60)}…` : check.value}
          </span>
        ) : check.recommendation ? (
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "10px", color: "var(--dim)" }}>
            {check.recommendation}
          </span>
        ) : null;
        return (
          <DataRow key={check.header} label={headerLabel} value={displayValue} copyValue={check.value || undefined} />
        );
      })}
    </Panel>
  );
}
