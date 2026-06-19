import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe, Server } from "lucide-react";
import { api } from "../api";
import { ErrorState, Panel, StatusBadge } from "./Panel";

function DomainChip({ domain }: { domain: string }) {
  return (
    <a
      href={`/${domain}`}
      target="_blank"
      rel="noopener noreferrer"
      className="domain-pill"
      title={`Analyze ${domain} in new tab`}
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <Globe size={10} />
      {domain}
      <ExternalLink size={8} style={{ opacity: 0.5, marginLeft: "2px" }} />
    </a>
  );
}

export function ReverseIPPanel({ ip }: { ip: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["reverseIP", ip],
    queryFn: () => api.getReverseIP({ ip }),
    enabled: !!ip,
  });

  if (isPending)
    return (
      <Panel title="Same-IP Domains" icon={<Server size={14} />}>
        <div className="p-4">
          <span style={{ color: "var(--dim)", fontSize: "12px" }}>Querying reverse IP lookup...</span>
        </div>
      </Panel>
    );
  if (error) return <ErrorState message={`Reverse IP failed: ${String(error)}`} />;

  const domains = data?.domains ?? [];
  return (
    <Panel
      title={`Same-IP Domains (${ip})`}
      icon={<Server size={14} />}
      badge={domains.length > 0 ? <StatusBadge status="info" label={`${domains.length} domains`} /> : undefined}
    >
      {domains.length === 0 ? (
        <div className="p-4">
          <StatusBadge status="neutral" label="No other domains found on this IP" />
        </div>
      ) : (
        <div className="p-3 flex flex-wrap gap-1.5" style={{ maxHeight: "400px", overflowY: "auto" }}>
          {domains.map((d) => (
            <DomainChip key={d} domain={d} />
          ))}
        </div>
      )}
    </Panel>
  );
}
