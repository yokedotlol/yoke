import { useQuery } from "@tanstack/react-query";
import { Check, Compass, ExternalLink, Globe, HelpCircle, Link2, Server, Sparkles, X } from "lucide-react";
import type { DomainSuggestion } from "../api";
import { api } from "../api";
import type { AnalysisResult } from "../utils/types";
import { ErrorState, Panel, StatusBadge } from "./Panel";
import { RegisterLinks } from "./RegisterLinks";

interface ExploreTabProps {
  domain: string;
  data: AnalysisResult;
}

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

function SubdomainsPanel({ domain }: { domain: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["subdomains", domain],
    queryFn: () => api.getSubdomains({ domain }),
    enabled: !!domain,
  });

  if (isPending)
    return (
      <Panel title="Subdomains (crt.sh)" icon={<Compass size={14} />}>
        <div className="p-4">
          <span style={{ color: "var(--dim)", fontSize: "12px" }}>Scanning certificate transparency logs...</span>
        </div>
      </Panel>
    );
  if (error) return <ErrorState message={`Subdomain scan failed: ${String(error)}`} />;

  const subs = data?.subdomains ?? [];
  return (
    <Panel
      title="Subdomains (crt.sh)"
      icon={<Compass size={14} />}
      badge={subs.length > 0 ? <StatusBadge status="info" label={`${subs.length} found`} /> : undefined}
    >
      {subs.length === 0 ? (
        <div className="p-4">
          <StatusBadge status="neutral" label="No subdomains found in CT logs" />
        </div>
      ) : (
        <div className="p-3 flex flex-wrap gap-1.5" style={{ maxHeight: "400px", overflowY: "auto" }}>
          {subs.map((sub, _i) => (
            <DomainChip key={sub} domain={sub} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function ReverseIPPanel({ ip }: { ip: string }) {
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
          {domains.map((d, _i) => (
            <DomainChip key={d} domain={d} />
          ))}
        </div>
      )}
    </Panel>
  );
}

// Infrastructure domains to filter out — these appear in NS/MX/CNAME but aren't "related" in a meaningful way
const infraDomains = new Set([
  "cloudflare.com",
  "cloudflare.net",
  "awsdns.com",
  "awsdns.org",
  "awsdns.net",
  "awsdns.co.uk",
  "amazonaws.com",
  "google.com",
  "googledomains.com",
  "akam.net",
  "akamai.com",
  "akamai.net",
  "verisign-grs.com",
  "nstld.com",
  "ultradns.com",
  "ultradns.net",
  "dnsmadeeasy.com",
  "domaincontrol.com",
  "registrar-servers.com",
  "hichina.com",
  "azure-dns.com",
  "azure-dns.net",
  "azure-dns.org",
  "azure-dns.info",
  "fastly.net",
  "dnsv.jp",
  "ovh.net",
  "livedns.co",
  "googlemail.com",
  "google-analytics.com",
  "protection.outlook.com",
  "secureserver.net",
  "nic.fr",
  "nic.uk",
  "nic.io",
  "nic.de",
  "denic.de",
  "nsone.net",
  "dynect.net",
  "dnsimple.com",
  "route53.com",
  "ns.cloudflare.com",
  "outlook.com",
  "outlook.net",
  "microsoft.com",
  "office365.us",
  "onmicrosoft.com",
  "googleusercontent.com",
  "1e100.net",
  "google.co.uk",
  "google.co.jp",
  "co.uk", // common false positive from MX/NS records
]);

// Also filter domains that match infra patterns dynamically
const infraPatterns = [/^awsdns/i, /awsdns/i, /^ns\d*\./, /^dns\d*\./, /\.akadns\./, /\.ultradns\./];

const isInfraDomain = (d: string): boolean => {
  if (infraDomains.has(d)) return true;
  // Catch awsdns-XX.com/org/net patterns and other DNS infra
  if (/^awsdns/i.test(d)) return true;
  return infraPatterns.some((p) => p.test(d));
};

function RelatedDomainsPanel({ data }: { data: AnalysisResult }) {
  // Extract related domains from DNS records
  const related = new Set<string>();
  if (data.dns?.records) {
    for (const rec of data.dns.records) {
      if (rec.type === "CNAME") {
        const cnameTarget = rec.data.replace(/\.$/, "");
        const parts = cnameTarget.split(".");
        if (parts.length >= 2) {
          const baseDomain = parts.slice(-2).join(".");
          if (baseDomain !== data.domain && !isInfraDomain(baseDomain)) related.add(baseDomain);
        }
      }
      if (rec.type === "MX") {
        const mxHost = rec.data.replace(/^\d+\s+/, "").replace(/\.$/, "");
        const parts = mxHost.split(".");
        if (parts.length >= 2) {
          const baseDomain = parts.slice(-2).join(".");
          if (baseDomain !== data.domain && !isInfraDomain(baseDomain)) related.add(baseDomain);
        }
      }
      if (rec.type === "NS") {
        const nsHost = rec.data.replace(/\.$/, "");
        const parts = nsHost.split(".");
        if (parts.length >= 2) {
          const baseDomain = parts.slice(-2).join(".");
          if (baseDomain !== data.domain && !isInfraDomain(baseDomain)) related.add(baseDomain);
        }
      }
    }
  }

  const domains = [...related].sort();
  if (domains.length === 0) return null;

  return (
    <Panel
      title="Related Domains (DNS)"
      icon={<Link2 size={14} />}
      badge={<StatusBadge status="info" label={`${domains.length} found`} />}
    >
      <div className="p-3 flex flex-wrap gap-1.5">
        {domains.map((d, _i) => (
          <DomainChip key={d} domain={d} />
        ))}
      </div>
    </Panel>
  );
}

function AvailabilityIcon({ available }: { available: boolean | null }) {
  if (available === true) return <Check size={12} style={{ color: "var(--green, #22c55e)" }} />;
  if (available === false) return <X size={12} style={{ color: "var(--red, #ef4444)" }} />;
  return <HelpCircle size={12} style={{ color: "var(--dim)" }} />;
}

function AvailabilityLabel({ available }: { available: boolean | null }) {
  if (available === true) return <StatusBadge status="pass" label="Available" />;
  if (available === false) return <StatusBadge status="fail" label="Taken" />;
  return <StatusBadge status="neutral" label="Unknown" />;
}

function SuggestionRow({ suggestion }: { suggestion: DomainSuggestion }) {
  const { domain, available, pricing } = suggestion;
  const tld = domain.split(".").slice(1).join(".");
  const name = domain.split(".")[0];

  // Available domains: show domain name as text (not clickable into Yoke) + register links
  // Taken domains: clickable to analyze in Yoke (opens in new tab)
  return (
    <div className="suggestion-row">
      <div className="flex items-center gap-2 min-w-0" style={{ flexShrink: 0 }}>
        <AvailabilityIcon available={available} />
        {available === true ? (
          <span className="domain-pill" style={{ cursor: "default", opacity: 0.9 }}>
            <Globe size={10} />
            <span style={{ fontWeight: 600 }}>{name}</span>
            <span style={{ color: "var(--dim)", fontWeight: 400 }}>.{tld}</span>
          </span>
        ) : (
          <a
            href={`/${domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="domain-pill"
            title={`Analyze ${domain} in new tab`}
            style={{ flexShrink: 0, textDecoration: "none", color: "inherit" }}
          >
            <Globe size={10} />
            <span style={{ fontWeight: 600 }}>{name}</span>
            <span style={{ color: "var(--dim)", fontWeight: 400 }}>.{tld}</span>
          </a>
        )}
        <AvailabilityLabel available={available} />
        {pricing && (
          <span style={{ fontSize: "11px", color: "var(--dim)", whiteSpace: "nowrap" }}>
            ${pricing.registration}/yr
          </span>
        )}
      </div>
      <div className="flex-shrink-0" style={{ marginLeft: "auto" }}>
        {available === true ? (
          <RegisterLinks domain={domain} />
        ) : available === false ? (
          <a
            href={`/${domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="domain-pill"
            title={`Analyze ${domain} in new tab`}
            style={{ fontSize: "11px", textDecoration: "none", color: "inherit" }}
          >
            Analyze → <ExternalLink size={8} style={{ display: "inline", verticalAlign: "-1px", opacity: 0.5 }} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionsPanel({ domain }: { domain: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["suggestions", domain],
    queryFn: () => api.getDomainSuggestions({ domain }),
    enabled: !!domain,
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  if (isPending)
    return (
      <Panel title="Similar Domains" icon={<Sparkles size={14} />}>
        <div className="p-4">
          <span style={{ color: "var(--dim)", fontSize: "12px" }}>
            Finding similar domains and checking availability...
          </span>
        </div>
      </Panel>
    );
  if (error)
    return (
      <Panel title="Similar Domains" icon={<Sparkles size={14} />}>
        <div className="p-4">
          <StatusBadge status="fail" label={`Suggestion lookup failed: ${String(error)}`} />
        </div>
      </Panel>
    );

  const suggestions = data?.suggestions ?? [];
  const availableCount = suggestions.filter((s) => s.available === true).length;
  const takenCount = suggestions.filter((s) => s.available === false).length;

  return (
    <Panel
      title="Similar Domains"
      icon={<Sparkles size={14} />}
      badge={
        availableCount > 0 ? (
          <StatusBadge status="pass" label={`${availableCount} available`} />
        ) : (
          <StatusBadge status="info" label={`${suggestions.length} checked`} />
        )
      }
    >
      {suggestions.length === 0 ? (
        <div className="p-4">
          <StatusBadge status="neutral" label="No suggestions found" />
        </div>
      ) : (
        <div className="suggestions-list">
          {availableCount > 0 && (
            <div className="suggestions-section-header">
              <Check size={11} /> Available ({availableCount})
            </div>
          )}
          {suggestions
            .filter((s) => s.available === true)
            .map((s, i) => (
              <SuggestionRow key={`a-${i}`} suggestion={s} />
            ))}

          {takenCount > 0 && (
            <div className="suggestions-section-header" style={{ marginTop: availableCount > 0 ? "8px" : "0" }}>
              <X size={11} /> Taken ({takenCount})
            </div>
          )}
          {suggestions
            .filter((s) => s.available === false)
            .map((s, i) => (
              <SuggestionRow key={`t-${i}`} suggestion={s} />
            ))}

          {suggestions.filter((s) => s.available === null).length > 0 && (
            <>
              <div className="suggestions-section-header" style={{ marginTop: "8px" }}>
                <HelpCircle size={11} /> Unknown
              </div>
              {suggestions
                .filter((s) => s.available === null)
                .map((s, i) => (
                  <SuggestionRow key={`u-${i}`} suggestion={s} />
                ))}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

export function ExploreTab({ domain, data }: ExploreTabProps) {
  const ip = data.ip_info?.ip;

  return (
    <div className="space-y-3">
      <div className="panel p-4">
        <p
          style={{ fontFamily: "var(--font-ui)", fontSize: "13px", color: "var(--text-secondary)", lineHeight: "20px" }}
        >
          <Compass
            size={14}
            style={{ display: "inline", marginRight: "6px", verticalAlign: "-2px", color: "var(--accent)" }}
          />
          Discover subdomains, find domains sharing the same IP, and explore related infrastructure. Domains open in a
          new tab so you keep your current analysis.
        </p>
      </div>
      <SuggestionsPanel domain={domain} />
      <SubdomainsPanel domain={domain} />
      {ip && <ReverseIPPanel ip={ip} />}
      <RelatedDomainsPanel data={data} />
    </div>
  );
}
