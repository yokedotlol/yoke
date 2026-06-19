import type { AnalysisResult } from "../../utils/types";
import { AvailabilityPanel } from "../AvailabilityPanel";
import { AxisSummaryCard } from "../AxisSummaryCard";
import { DnsPanel } from "../DnsPanel";
import { HeadersPanel, RedirectPanel } from "../HttpPanel";
import { IpMap } from "../IpMap";
import { NetworkHealthPanel } from "../NetworkHealthPanel";
import { HttpProtocolsPanel, IpInfoPanel } from "../NetworkPanel";
import { DnssecPanel, HostingPanel } from "../NewPanels";
import { SectionHeader } from "../Panel";
import { type PanelDef, PanelGrid } from "../PanelLayout";
import { ReverseIPPanel } from "../ReverseIPPanel";
import { ShodanPanel } from "../ShodanPanel";
import { SubdomainScanPanel } from "../SubdomainScanPanel";
import { TechStackPanel } from "../TechStackPanel";
import { GreenHostingPanel, WellKnownPanel } from "../Tier1Panels";
import { WordPressPanel } from "../WordPressPanel";

export default function InfrastructureTab({ data }: { data: AnalysisResult }) {
  const domain = data.domain;
  const ip = data.ip_info?.ip;

  const networkPanels: PanelDef[] = [
    { id: "ip-map", node: <IpMap data={data} />, fullWidth: true },
    { id: "dns", node: <DnsPanel data={data} /> },
    { id: "ip-info", node: <IpInfoPanel data={data} /> },
    { id: "hosting", node: <HostingPanel data={data} /> },
    { id: "green-hosting", node: <GreenHostingPanel data={data} /> },
    { id: "dnssec", node: <DnssecPanel data={data} /> },
    { id: "http-protocols", node: <HttpProtocolsPanel data={data} /> },
    { id: "network-health", node: <NetworkHealthPanel data={data} /> },
    { id: "availability", node: <AvailabilityPanel domain={domain} /> },
    { id: "shodan", node: <ShodanPanel data={data} /> },
    { id: "subdomain-scan", node: <SubdomainScanPanel domain={domain} /> },
    { id: "reverse-ip", node: <ReverseIPPanel ip={ip ?? ""} />, visible: !!ip },
    { id: "redirects", node: <RedirectPanel data={data} /> },
  ];

  const techStackPanels: PanelDef[] = [
    { id: "tech-stack", node: <TechStackPanel data={data} /> },
    { id: "wordpress", node: <WordPressPanel data={data} />, visible: !!data.wordpress },
    { id: "well-known", node: <WellKnownPanel data={data} /> },
  ];

  return (
    <div className="space-y-3">
      <AxisSummaryCard data={data} axis="foundations" />
      <SectionHeader title="Network & DNS" />
      <PanelGrid tabId="foundations" panels={networkPanels} />
      <SectionHeader title="Tech Stack" />
      <PanelGrid tabId="foundations-tech" panels={techStackPanels} />
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
      <SectionHeader title="Raw Headers" />
      <PanelGrid
        tabId="foundations-headers"
        panels={[{ id: "headers", node: <HeadersPanel data={data} /> }]}
        grid={false}
      />
    </div>
  );
}
