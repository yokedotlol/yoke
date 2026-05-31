import type { AnalysisResult } from "../../utils/types";
import { AvailabilityPanel } from "../AvailabilityPanel";
import { DnsPanel } from "../DnsPanel";
import { HeadersPanel, RedirectPanel } from "../HttpPanel";
import { IpMap } from "../IpMap";
import { NetworkHealthPanel } from "../NetworkHealthPanel";
import { HttpProtocolsPanel, IpInfoPanel } from "../NetworkPanel";
import { DnssecPanel, HostingPanel } from "../NewPanels";
import { SectionHeader } from "../Panel";
import { type PanelDef, PanelGrid } from "../PanelLayout";
import { ShodanPanel } from "../ShodanPanel";
import { SubdomainScanPanel } from "../SubdomainScanPanel";
import { GreenHostingPanel } from "../Tier1Panels";

export default function InfrastructureTab({ data }: { data: AnalysisResult }) {
  const domain = data.domain;
  const ip = data.ip_info?.ip;

  const panels: PanelDef[] = [
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
    { id: "redirects", node: <RedirectPanel data={data} /> },
  ];

  return (
    <div className="space-y-3">
      <PanelGrid tabId="foundations" panels={panels} />
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
        tabId="infrastructure-headers"
        panels={[{ id: "headers", node: <HeadersPanel data={data} /> }]}
        grid={false}
      />
    </div>
  );
}
