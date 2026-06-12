import { Cloud, Cookie, Lock, Server, ShieldCheck, Zap } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { CliButton, compressionCliCommands, dnssecCliCommands } from "./CliModal";
import { DataRow, Panel, StatusBadge } from "./Panel";
import { Tooltip } from "./Tooltip";

// ─── DNSSEC Panel ───────────────────────────────────────────────────

export function DnssecPanel({ data }: { data: AnalysisResult }) {
  const dnssec = data.dnssec;
  if (!dnssec) return null;

  return (
    <Panel
      title="DNSSEC"
      icon={<Lock size={14} />}
      badge={
        <div className="flex items-center gap-1.5">
          <CliButton commands={dnssecCliCommands(data.domain)} domain={data.domain} />
          <Tooltip text="DNSSEC adds cryptographic signatures to DNS records, preventing spoofing and cache poisoning attacks">
            <span style={{ cursor: "help" }}>
              <StatusBadge
                status={dnssec.enabled ? "pass" : "warn"}
                label={dnssec.enabled ? "Enabled" : "Not Enabled"}
              />
            </span>
          </Tooltip>
        </div>
      }
    >
      <DataRow
        label={
          <span className="flex items-center gap-1">
            DNSKEY Records{" "}
            <Tooltip
              text="Public keys used to verify DNSSEC signatures. Must be present for DNSSEC to function."
              help
            />
          </span>
        }
        value={
          <StatusBadge
            status={dnssec.has_dnskey ? "pass" : "neutral"}
            label={dnssec.has_dnskey ? "Present" : "Not found"}
          />
        }
      />
      <DataRow
        label={
          <span className="flex items-center gap-1">
            DS Records{" "}
            <Tooltip
              text="Delegation Signer records link the parent zone's DNSSEC to this domain's keys, establishing the chain of trust."
              help
            />
          </span>
        }
        value={
          <StatusBadge status={dnssec.has_ds ? "pass" : "neutral"} label={dnssec.has_ds ? "Present" : "Not found"} />
        }
      />
      <DataRow
        label={
          <span className="flex items-center gap-1">
            AD Validation{" "}
            <Tooltip
              text="Authenticated Data flag — confirms the DNS resolver successfully validated the DNSSEC signatures."
              help
            />
          </span>
        }
        value={
          <StatusBadge
            status={dnssec.validated ? "pass" : "neutral"}
            label={dnssec.validated ? "Validated" : "Not validated"}
          />
        }
      />
      {!dnssec.enabled && (
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border-muted)" }}>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--dim)", lineHeight: "16px" }}>
            DNSSEC adds a layer of authentication to DNS, preventing cache poisoning attacks. Consider enabling it with
            your registrar.
          </p>
        </div>
      )}
    </Panel>
  );
}

// ─── Cookie Security Panel ──────────────────────────────────────────

export function CookieSecurityPanel({ data }: { data: AnalysisResult }) {
  const cs = data.cookie_security;
  if (!cs || cs.cookies.length === 0) return null;

  const issueCount = cs.issues.length;

  return (
    <Panel
      title="Cookie Security"
      icon={<Cookie size={14} />}
      badge={
        <div className="flex items-center gap-1.5">
          <StatusBadge
            status={issueCount === 0 ? "pass" : issueCount <= 3 ? "warn" : "fail"}
            label={issueCount === 0 ? "Secure" : `${issueCount} issue${issueCount > 1 ? "s" : ""}`}
          />
          <StatusBadge status="info" label={`${cs.cookies.length} cookie${cs.cookies.length > 1 ? "s" : ""}`} />
        </div>
      }
    >
      {cs.cookies.map((cookie, _i) => (
        <div key={cookie.name} className="data-row" style={{ alignItems: "flex-start" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text)" }}>
            {cookie.name.length > 30 ? `${cookie.name.slice(0, 30)}…` : cookie.name}
          </span>
          <div className="flex flex-wrap gap-1 justify-end">
            <Tooltip text="Secure flag: cookie is only sent over HTTPS connections">
              <span
                className={`badge badge-${cookie.secure ? "pass" : "fail"}`}
                style={{ fontSize: "9px", cursor: "help" }}
              >
                {cookie.secure ? "Secure ✓" : "Secure ✗"}
              </span>
            </Tooltip>
            <Tooltip text="HttpOnly flag: cookie cannot be accessed by JavaScript, preventing XSS theft">
              <span
                className={`badge badge-${cookie.httponly ? "pass" : "warn"}`}
                style={{ fontSize: "9px", cursor: "help" }}
              >
                {cookie.httponly ? "HttpOnly ✓" : "HttpOnly ✗"}
              </span>
            </Tooltip>
            <Tooltip text="SameSite attribute: controls whether the cookie is sent with cross-site requests, mitigating CSRF attacks">
              <span
                className={`badge badge-${cookie.samesite ? "pass" : "warn"}`}
                style={{ fontSize: "9px", cursor: "help" }}
              >
                {cookie.samesite ? `SS=${cookie.samesite}` : "SameSite ✗"}
              </span>
            </Tooltip>
          </div>
        </div>
      ))}

      {cs.issues.length > 0 && (
        <>
          <div className="sub-section" style={{ color: "var(--warning)" }}>
            Issues
          </div>
          <div className="px-4 py-2 space-y-1">
            {cs.issues.slice(0, 8).map((issue, i) => (
              <div
                key={`issue-${i}`}
                style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--warning)", lineHeight: "16px" }}
              >
                ⚠ {issue}
              </div>
            ))}
            {cs.issues.length > 8 && (
              <div style={{ fontFamily: "var(--font-ui)", fontSize: "10px", color: "var(--dim)" }}>
                +{cs.issues.length - 8} more issues
              </div>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

// ─── Compression Panel ──────────────────────────────────────────────

export function CompressionPanel({ data }: { data: AnalysisResult }) {
  const comp = data.compression;
  if (!comp) return null;

  return (
    <Panel
      title="Compression"
      icon={<Zap size={14} />}
      badge={
        <div className="flex items-center gap-1.5">
          <CliButton commands={compressionCliCommands(data.domain)} domain={data.domain} />
          <StatusBadge
            status={comp.encoding ? "pass" : "warn"}
            label={comp.encoding ? comp.encoding.toUpperCase() : "None"}
          />
        </div>
      }
    >
      <DataRow label="Content-Encoding" value={comp.encoding ?? "Not compressed"} />
      <DataRow
        label="Vary: Accept-Encoding"
        value={
          <StatusBadge
            status={comp.vary_accept_encoding ? "pass" : "neutral"}
            label={comp.vary_accept_encoding ? "Yes" : "No"}
          />
        }
      />
      {!comp.encoding && (
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border-muted)" }}>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--dim)", lineHeight: "16px" }}>
            Enable gzip or Brotli compression to reduce transfer sizes and improve load times.
          </p>
        </div>
      )}
    </Panel>
  );
}

// ─── Hosting Provider Panel ─────────────────────────────────────────

export function HostingPanel({ data }: { data: AnalysisResult }) {
  const hosting = data.hosting;
  if (!hosting || (!hosting.provider && !hosting.cdn && !hosting.waf)) return null;

  return (
    <Panel
      title="Hosting & Infrastructure"
      icon={<Cloud size={14} />}
      badge={hosting.cdn ? <StatusBadge status="info" label={hosting.cdn} /> : undefined}
    >
      {hosting.provider && (
        <DataRow
          label={
            <span className="flex items-center gap-1">
              Hosting Provider{" "}
              <Tooltip text="The company or platform hosting this website's server infrastructure" help />
            </span>
          }
          value={
            <div className="flex items-center gap-1.5">
              <Server size={11} style={{ color: "var(--accent)" }} />
              <span>{hosting.provider}</span>
            </div>
          }
          copyValue={hosting.provider}
        />
      )}
      {hosting.cdn && (
        <DataRow
          label={
            <span className="flex items-center gap-1">
              CDN{" "}
              <Tooltip
                text="Content Delivery Network — caches and serves content from servers close to users worldwide for faster load times"
                help
              />
            </span>
          }
          value={
            <div className="flex items-center gap-1.5">
              <Cloud size={11} style={{ color: "var(--success)" }} />
              <span>{hosting.cdn}</span>
            </div>
          }
          copyValue={hosting.cdn}
        />
      )}
      {hosting.waf && (
        <DataRow
          label={
            <span className="flex items-center gap-1">
              WAF{" "}
              <Tooltip
                text="Web Application Firewall — filters and blocks malicious web traffic like SQL injection and XSS attacks"
                help
              />
            </span>
          }
          value={
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={11} style={{ color: "var(--success)" }} />
              <span>{hosting.waf}</span>
            </div>
          }
          copyValue={hosting.waf}
        />
      )}
    </Panel>
  );
}

// ─── Email Auth Extras (BIMI / MTA-STS / TLS-RPT) ──────────────────

export function EmailExtrasPanel({ data }: { data: AnalysisResult }) {
  const auth = data.email_auth;
  if (!auth) return null;

  const hasBimi = auth.bimi?.found;
  const hasMtaSts = auth.mta_sts?.dns_found || auth.mta_sts?.policy_found;
  const hasTlsRpt = auth.tls_rpt?.found;

  if (!hasBimi && !hasMtaSts && !hasTlsRpt && !auth.bimi && !auth.mta_sts && !auth.tls_rpt) return null;

  return (
    <Panel
      title="Advanced Email"
      icon={<ShieldCheck size={14} />}
      badge={
        <div className="flex gap-1.5">
          {auth.bimi && (
            <Tooltip text="BIMI (Brand Indicators for Message Identification) — displays your brand logo in supported email clients next to authenticated messages">
              <span style={{ cursor: "help" }}>
                <StatusBadge status={hasBimi ? "pass" : "neutral"} label="BIMI" />
              </span>
            </Tooltip>
          )}
          {auth.mta_sts && (
            <Tooltip text="MTA-STS (Mail Transfer Agent Strict Transport Security) — forces encrypted TLS connections for incoming email, preventing downgrade attacks">
              <span style={{ cursor: "help" }}>
                <StatusBadge status={hasMtaSts ? "pass" : "neutral"} label="MTA-STS" />
              </span>
            </Tooltip>
          )}
          {auth.tls_rpt && (
            <Tooltip text="TLS-RPT (TLS Reporting) — receives reports about email delivery failures due to TLS issues, helping monitor email security">
              <span style={{ cursor: "help" }}>
                <StatusBadge status={hasTlsRpt ? "pass" : "neutral"} label="TLS-RPT" />
              </span>
            </Tooltip>
          )}
        </div>
      }
    >
      {/* BIMI */}
      {auth.bimi && (
        <>
          <div className="sub-section">BIMI (Brand Indicators)</div>
          {auth.bimi.found ? (
            <>
              {auth.bimi.logo_url && (
                <DataRow
                  label="Logo URL"
                  value={
                    <a
                      href={auth.bimi.logo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "10px",
                        color: "var(--accent)",
                        textDecoration: "none",
                        wordBreak: "break-all",
                      }}
                    >
                      {auth.bimi.logo_url.length > 50 ? `${auth.bimi.logo_url.slice(0, 50)}…` : auth.bimi.logo_url}
                    </a>
                  }
                />
              )}
              {auth.bimi.authority_url && (
                <DataRow label="VMC Certificate" value={<StatusBadge status="pass" label="Present" />} />
              )}
            </>
          ) : (
            <div className="px-4 py-2">
              <StatusBadge status="neutral" label="No BIMI record found" />
            </div>
          )}
        </>
      )}

      {/* MTA-STS */}
      {auth.mta_sts && (
        <>
          <div className="sub-section">MTA-STS</div>
          <DataRow
            label="DNS Record"
            value={
              <StatusBadge
                status={auth.mta_sts.dns_found ? "pass" : "neutral"}
                label={auth.mta_sts.dns_found ? "Found" : "Not found"}
              />
            }
          />
          <DataRow
            label="Policy File"
            value={
              <StatusBadge
                status={auth.mta_sts.policy_found ? "pass" : "neutral"}
                label={auth.mta_sts.policy_found ? "Found" : "Not found"}
              />
            }
          />
          {auth.mta_sts.mode && (
            <DataRow
              label="Mode"
              value={
                <StatusBadge
                  status={
                    auth.mta_sts.mode === "enforce" ? "pass" : auth.mta_sts.mode === "testing" ? "warn" : "neutral"
                  }
                  label={auth.mta_sts.mode}
                />
              }
            />
          )}
        </>
      )}

      {/* TLS-RPT */}
      {auth.tls_rpt && (
        <>
          <div className="sub-section">TLS-RPT</div>
          {auth.tls_rpt.found ? (
            auth.tls_rpt.rua && (
              <DataRow
                label="Report URI"
                value={<span style={{ fontSize: "10px", wordBreak: "break-all" }}>{auth.tls_rpt.rua}</span>}
                copyValue={auth.tls_rpt.rua}
              />
            )
          ) : (
            <div className="px-4 py-2">
              <StatusBadge status="neutral" label="No TLS-RPT record found" />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
