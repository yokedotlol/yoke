import { ArrowRight, FileCode } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { CliButton, httpProtocolCliCommands } from "./CliModal";
import { DataRow, ErrorState, Panel, StatusBadge } from "./Panel";

export function RedirectPanel({ data }: { data: AnalysisResult }) {
  const redirects = data.redirects;
  if (!redirects || redirects.length === 0)
    return (
      <Panel title="Redirect Chain" icon={<ArrowRight size={14} />}>
        <ErrorState message="No redirect data available" />
      </Panel>
    );

  const httpToHttps = redirects.some((r, i) => {
    const next = redirects[i + 1];
    return i < redirects.length - 1 && r.url.startsWith("http://") && next?.url.startsWith("https://");
  });

  return (
    <Panel
      title="Redirect Chain"
      icon={<ArrowRight size={14} />}
      badge={
        <div className="flex gap-1.5">
          <StatusBadge status="info" label={`${redirects.length} hop${redirects.length === 1 ? "" : "s"}`} />
          {httpToHttps && <StatusBadge status="pass" label="HTTPS↑" />}
        </div>
      }
    >
      {redirects.map((hop, i) => (
        <div key={hop.url} className="data-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "4px" }}>
          <div className="flex items-center gap-2">
            <span
              className={`badge ${hop.status_code >= 300 && hop.status_code < 400 ? "badge-warn" : hop.status_code >= 200 && hop.status_code < 300 ? "badge-pass" : "badge-fail"}`}
              style={{ fontSize: "10px", flexShrink: 0 }}
            >
              {hop.status_code}
            </span>
            <span
              style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text)", wordBreak: "break-all" }}
            >
              {hop.url}
            </span>
          </div>
          <div className="flex items-center gap-3 pl-7" style={{ fontSize: "10px", color: "var(--dim)" }}>
            {hop.server && <span style={{ fontFamily: "var(--font-mono)" }}>{hop.server}</span>}
            <span style={{ fontFamily: "var(--font-mono)" }}>{hop.response_time_ms}ms</span>
          </div>
          {i < redirects.length - 1 && (
            <div className="pl-7 py-0.5">
              <ArrowRight size={10} style={{ color: "var(--dim)", opacity: 0.5 }} />
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

export function HeadersPanel({ data }: { data: AnalysisResult }) {
  const headers = data.headers;
  if (!headers)
    return (
      <Panel
        title="HTTP Headers"
        icon={<FileCode size={14} />}
        badge={<CliButton commands={httpProtocolCliCommands(data.domain)} domain={data.domain} />}
      >
        <ErrorState message="HTTP headers unavailable" />
      </Panel>
    );

  const entries = Object.entries(headers.raw);

  return (
    <Panel
      title="Response Headers"
      icon={<FileCode size={14} />}
      badge={<StatusBadge status="info" label={`${entries.length} headers`} />}
    >
      <div style={{ maxHeight: "280px", overflowY: "auto", overflowX: "auto" }}>
        {entries.map(([key, value], _i) => (
          <DataRow
            key={key}
            label={
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--accent)" }}>{key}</span>
            }
            value={
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--text)",
                  wordBreak: "break-all",
                  overflowWrap: "anywhere",
                }}
              >
                {value.length > 100 ? `${value.slice(0, 100)}…` : value}
              </span>
            }
            copyValue={value}
          />
        ))}
      </div>
    </Panel>
  );
}
