import { Archive, Camera, Hash, Mail } from "lucide-react";
import { useState } from "react";
import type { AnalysisResult } from "../utils/types";
import { CliButton, emailAuthCliCommands } from "./CliModal";
import { DataRow, Panel, StatusBadge } from "./Panel";
import { Tooltip } from "./Tooltip";

export function WaybackPanel({ data }: { data: AnalysisResult }) {
  const wb = data.wayback;
  if (!wb) return null;

  const hasData = wb.first_snapshot || wb.total_snapshots;

  return (
    <Panel
      title="Wayback Machine"
      icon={<Archive size={14} />}
      badge={
        wb.total_snapshots != null ? (
          <StatusBadge status="info" label={`${wb.total_snapshots.toLocaleString()} snapshots`} />
        ) : undefined
      }
    >
      {hasData ? (
        <div>
          {wb.first_snapshot && <DataRow label="First Archive" value={wb.first_snapshot} />}
          {wb.last_snapshot && <DataRow label="Last Archive" value={wb.last_snapshot} />}
          {wb.total_snapshots != null && (
            <DataRow label="Total Snapshots" value={wb.total_snapshots.toLocaleString()} />
          )}
          <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border-muted)" }}>
            <a
              href={wb.archive_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--accent)", textDecoration: "none" }}
            >
              View on archive.org →
            </a>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <StatusBadge status="neutral" label="No archives found" />
          <p style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--dim)", marginTop: "8px" }}>
            This domain has not been archived by the Wayback Machine.
          </p>
        </div>
      )}
    </Panel>
  );
}

export function TrancoPanel({ data }: { data: AnalysisResult }) {
  const rank = data.tranco_rank;

  return (
    <Panel
      title="Tranco Ranking"
      icon={<Hash size={14} />}
      badge={
        <Tooltip
          text="Tranco is a research-grade ranking of the top 1 million websites by traffic volume, combining data from Umbrella, Majestic, and other sources"
          help
        />
      }
    >
      <div className="flex items-center gap-4 p-4">
        {rank != null ? (
          <>
            <div
              className="flex flex-col items-center justify-center rounded-lg p-3"
              style={{ background: "var(--accent-subtle)", minWidth: "80px" }}
            >
              <span
                style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--dim)", marginBottom: "2px" }}
              >
                #
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "22px",
                  fontWeight: 700,
                  color: "var(--accent)",
                  lineHeight: 1,
                }}
              >
                {rank.toLocaleString()}
              </span>
            </div>
            <div>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: "13px", color: "var(--text)", fontWeight: 500 }}>
                Top {rank <= 1000 ? "1K" : rank <= 10000 ? "10K" : rank <= 100000 ? "100K" : "1M"} website
              </p>
              <p style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--dim)", marginTop: "4px" }}>
                Tranco top-1M research list
              </p>
            </div>
          </>
        ) : (
          <div>
            <StatusBadge status="neutral" label="Not ranked" />
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--dim)", marginTop: "8px" }}>
              This domain is not in the Tranco top 1 million list.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function EmailAuthPanel({ data }: { data: AnalysisResult }) {
  const auth = data.email_auth;
  if (!auth) return null;

  const dmarcColor =
    auth.dmarc.policy === "reject"
      ? ("pass" as const)
      : auth.dmarc.policy === "quarantine"
        ? ("warn" as const)
        : auth.dmarc.found && auth.dmarc.policy === "none"
          ? ("warn" as const)
          : ("fail" as const);

  const spfColor = auth.spf.found
    ? auth.spf.all_qualifier === "-all"
      ? ("pass" as const)
      : auth.spf.all_qualifier === "~all"
        ? ("warn" as const)
        : ("warn" as const)
    : ("fail" as const);

  return (
    <Panel
      title="Email Authentication"
      icon={<Mail size={14} />}
      badge={
        <div className="flex gap-1.5">
          <CliButton commands={emailAuthCliCommands(data.domain)} domain={data.domain} />
          <Tooltip text="SPF (Sender Policy Framework) — specifies which servers are allowed to send email on behalf of this domain, preventing spoofing">
            <span style={{ cursor: "help" }}>
              <StatusBadge status={spfColor} label="SPF" />
            </span>
          </Tooltip>
          <Tooltip text="DMARC (Domain-based Message Authentication, Reporting & Conformance) — tells receiving servers what to do with emails that fail authentication checks">
            <span style={{ cursor: "help" }}>
              <StatusBadge status={auth.dmarc.found ? dmarcColor : "fail"} label="DMARC" />
            </span>
          </Tooltip>
          {auth.dkim_selectors_found.length > 0 && (
            <Tooltip text="DKIM (DomainKeys Identified Mail) — adds a cryptographic signature to emails proving they haven't been tampered with in transit">
              <span style={{ cursor: "help" }}>
                <StatusBadge status="pass" label="DKIM" />
              </span>
            </Tooltip>
          )}
        </div>
      }
    >
      {/* SPF */}
      <div className="sub-section">SPF Record</div>
      {auth.spf.found ? (
        <div>
          <div
            className="px-4 py-2"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--text-secondary)",
              wordBreak: "break-all",
              lineHeight: "18px",
            }}
          >
            {auth.spf.record}
          </div>
          {auth.spf.all_qualifier && (
            <DataRow
              label="All Qualifier"
              value={
                <StatusBadge
                  status={
                    auth.spf.all_qualifier === "-all" ? "pass" : auth.spf.all_qualifier === "~all" ? "warn" : "warn"
                  }
                  label={auth.spf.all_qualifier}
                />
              }
              copyValue={auth.spf.all_qualifier}
            />
          )}
        </div>
      ) : (
        <div className="p-4">
          <StatusBadge status="fail" label="No SPF record found" />
        </div>
      )}

      {/* DMARC */}
      <div className="sub-section">DMARC Policy</div>
      {auth.dmarc.found ? (
        <div>
          {auth.dmarc.policy && (
            <DataRow
              label="Policy"
              value={
                <StatusBadge
                  status={
                    auth.dmarc.policy === "reject" ? "pass" : auth.dmarc.policy === "quarantine" ? "warn" : "warn"
                  }
                  label={`p=${auth.dmarc.policy}`}
                />
              }
              copyValue={`p=${auth.dmarc.policy}`}
            />
          )}
          {auth.dmarc.subdomain_policy && (
            <DataRow label="Subdomain Policy" value={`sp=${auth.dmarc.subdomain_policy}`} />
          )}
          {auth.dmarc.rua && (
            <DataRow
              label="Aggregate Reports"
              value={<span style={{ fontSize: "10px", wordBreak: "break-all" }}>{auth.dmarc.rua}</span>}
              copyValue={auth.dmarc.rua}
            />
          )}
          {auth.dmarc.ruf && (
            <DataRow
              label="Forensic Reports"
              value={<span style={{ fontSize: "10px", wordBreak: "break-all" }}>{auth.dmarc.ruf}</span>}
              copyValue={auth.dmarc.ruf}
            />
          )}
        </div>
      ) : (
        <div className="p-4">
          <StatusBadge status="fail" label="No DMARC record found" />
        </div>
      )}

      {/* DKIM */}
      <div className="sub-section">DKIM Selectors</div>
      {auth.dkim_selectors_found.length > 0 ? (
        <div className="px-4 py-3 flex flex-wrap gap-1.5">
          {auth.dkim_selectors_found.map((sel, _i) => (
            <StatusBadge key={sel} status="pass" label={sel} />
          ))}
        </div>
      ) : (
        <div className="p-4">
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--dim)" }}>
            No common DKIM selectors detected
          </span>
        </div>
      )}

      {/* Extended: BIMI / MTA-STS / TLS-RPT */}
      {(auth.bimi || auth.mta_sts || auth.tls_rpt) && (
        <>
          <div className="sub-section">Advanced Email</div>
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {auth.bimi && (
              <Tooltip text="BIMI (Brand Indicators for Message Identification) — displays your brand logo in supported email clients next to authenticated messages">
                <span style={{ cursor: "help" }}>
                  <StatusBadge
                    status={auth.bimi.found ? "pass" : "neutral"}
                    label={`BIMI ${auth.bimi.found ? "✓" : "✗"}`}
                  />
                </span>
              </Tooltip>
            )}
            {auth.mta_sts && (
              <Tooltip text="MTA-STS (Mail Transfer Agent Strict Transport Security) — forces encrypted TLS connections for incoming email, preventing downgrade attacks">
                <span style={{ cursor: "help" }}>
                  <StatusBadge
                    status={auth.mta_sts.dns_found || auth.mta_sts.policy_found ? "pass" : "neutral"}
                    label={`MTA-STS ${auth.mta_sts.dns_found || auth.mta_sts.policy_found ? "✓" : "✗"}`}
                  />
                </span>
              </Tooltip>
            )}
            {auth.tls_rpt && (
              <Tooltip text="TLS-RPT (TLS Reporting) — receives reports about email delivery failures due to TLS issues">
                <span style={{ cursor: "help" }}>
                  <StatusBadge
                    status={auth.tls_rpt.found ? "pass" : "neutral"}
                    label={`TLS-RPT ${auth.tls_rpt.found ? "✓" : "✗"}`}
                  />
                </span>
              </Tooltip>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

export function ScreenshotPanel({ data, streaming }: { data: AnalysisResult; streaming?: boolean }) {
  const lighthouseScreenshot = data.performance?.screenshot;
  // Only use microlink fallback when not streaming — during streaming,
  // domain is set before real data arrives and microlink would screenshot
  // error pages on slow/down sites.
  const microlink =
    !streaming && data.domain
      ? `https://api.microlink.io?url=https://${encodeURIComponent(data.domain)}&screenshot=true&meta=false&embed=screenshot.url`
      : null;
  const [imgError, setImgError] = useState(false);

  const src = lighthouseScreenshot || microlink;
  if (!src) return null;

  return (
    <Panel title="Site Preview" icon={<Camera size={14} />}>
      <div className="p-3">
        <div className="screenshot-container aspect-[16/9]">
          {!imgError ? (
            <img
              src={src}
              alt={`Screenshot of ${data.domain}`}
              className="w-full h-full object-cover object-top"
              onError={() => setImgError(true)}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ background: "var(--surface-raised)" }}
            >
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--dim)" }}>
                Preview unavailable
              </span>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
