import { useState } from "react";
import type { AnalysisResult } from "../../utils/types";
import { AvailabilityPanel } from "../AvailabilityPanel";
import { AxisSummaryCard } from "../AxisSummaryCard";
import { DnsPanel } from "../DnsPanel";
import { HeadersPanel, RedirectPanel } from "../HttpPanel";
import { IpMap } from "../IpMap";
import { NetworkHealthPanel } from "../NetworkHealthPanel";
import { HttpProtocolsPanel, IpInfoPanel } from "../NetworkPanel";
import { DnssecPanel, HostingPanel } from "../NewPanels";
import { type PanelDef, PanelGrid } from "../PanelLayout";
import { ReverseIPPanel } from "../ReverseIPPanel";
import { ShodanPanel } from "../ShodanPanel";
import { SubdomainScanPanel } from "../SubdomainScanPanel";
import { TechStackPanel } from "../TechStackPanel";
import { GreenHostingPanel, WellKnownPanel } from "../Tier1Panels";
import { WordPressPanel } from "../WordPressPanel";

type SubTab = "dns" | "infra" | "tech";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "dns", label: "DNS & Routing" },
  { id: "infra", label: "Infrastructure" },
  { id: "tech", label: "Technology" },
];

export default function InfrastructureTab({ data }: { data: AnalysisResult }) {
  const [subTab, setSubTab] = useState<SubTab>("dns");
  const domain = data.domain;
  const ip = data.ip_info?.ip;

  const dnsPanels: PanelDef[] = [
    { id: "dns", node: <DnsPanel data={data} /> },
    { id: "dnssec", node: <DnssecPanel data={data} /> },
    { id: "network-health", node: <NetworkHealthPanel data={data} /> },
    { id: "redirects", node: <RedirectPanel data={data} /> },
  ];

  const infraPanels: PanelDef[] = [
    { id: "ip-map", node: <IpMap data={data} />, fullWidth: true },
    { id: "ip-info", node: <IpInfoPanel data={data} /> },
    { id: "hosting", node: <HostingPanel data={data} /> },
    { id: "green-hosting", node: <GreenHostingPanel data={data} /> },
    { id: "http-protocols", node: <HttpProtocolsPanel data={data} /> },
    { id: "availability", node: <AvailabilityPanel domain={domain} /> },
    { id: "shodan", node: <ShodanPanel data={data} /> },
    { id: "reverse-ip", node: <ReverseIPPanel ip={ip ?? ""} />, visible: !!ip },
    { id: "subdomain-scan", node: <SubdomainScanPanel domain={domain} /> },
  ];

  const techPanels: PanelDef[] = [
    { id: "tech-stack", node: <TechStackPanel data={data} /> },
    { id: "wordpress", node: <WordPressPanel data={data} />, visible: !!data.wordpress },
    { id: "well-known", node: <WellKnownPanel data={data} /> },
    { id: "headers", node: <HeadersPanel data={data} /> },
  ];

  const panelMap: Record<SubTab, { tabId: string; panels: PanelDef[] }> = {
    dns: { tabId: "foundations-dns", panels: dnsPanels },
    infra: { tabId: "foundations-infra", panels: infraPanels },
    tech: { tabId: "foundations-tech", panels: techPanels },
  };

  const current = panelMap[subTab];

  return (
    <div className="space-y-3">
      <AxisSummaryCard data={data} axis="foundations" />

      {/* Sub-tab navigation */}
      <div className="yoke-subtab-bar" role="tablist" aria-label="Foundations sections">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className={`yoke-subtab${subTab === t.id ? " active" : ""}`}
            onClick={() => setSubTab(t.id)}
            aria-selected={subTab === t.id}
            aria-controls={`subtab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id={`subtab-${subTab}`} role="tabpanel">
        <PanelGrid tabId={current.tabId} panels={current.panels} />
      </div>

      {/* Contextual external links */}
      <div className="flex flex-wrap gap-2 px-1">
        {ip && (
          <a
            href={`https://www.shodan.io/host/${ip}`}
            target="_blank"
            rel="noopener noreferrer"
            className="badge badge-info"
            style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
          >
            Shodan ↗
          </a>
        )}
        {ip && (
          <a
            href={`https://search.censys.io/hosts/${ip}`}
            target="_blank"
            rel="noopener noreferrer"
            className="badge badge-info"
            style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
          >
            Censys ↗
          </a>
        )}
        <a
          href={`https://dnsviz.net/d/${domain}/dnssec/`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          DNSViz ↗
        </a>
        <a
          href={`https://lookup.icann.org/en/lookup?name=${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          ICANN ↗
        </a>
        <a
          href={`https://who.is/whois/${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          who.is ↗
        </a>
        <a
          href={`https://builtwith.com/${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          BuiltWith ↗
        </a>
        {data.network_health?.ripe_routing?.asn && (
          <a
            href={`https://bgp.tools/as/${data.network_health.ripe_routing.asn}`}
            target="_blank"
            rel="noopener noreferrer"
            className="badge badge-info"
            style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
          >
            bgp.tools ↗
          </a>
        )}
        {data.network_health?.ripe_routing?.asn && (
          <a
            href={`https://bgp.he.net/AS${data.network_health.ripe_routing.asn}`}
            target="_blank"
            rel="noopener noreferrer"
            className="badge badge-info"
            style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
          >
            HE BGP ↗
          </a>
        )}
        {ip && (
          <a
            href={`https://bgp.he.net/ip/${ip}`}
            target="_blank"
            rel="noopener noreferrer"
            className="badge badge-info"
            style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
          >
            HE BGP (IP) ↗
          </a>
        )}
        <a
          href={`https://downdetector.com/status/${domain.replace(/^www\./i, "")}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          Downdetector ↗
        </a>
      </div>
    </div>
  );
}
