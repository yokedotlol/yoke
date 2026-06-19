import type { AnalysisResult } from "../../utils/types";
import { AxisSummaryCard } from "../AxisSummaryCard";
import { CookieSecurityPanel } from "../NewPanels";
import { SectionHeader } from "../Panel";
import { type PanelDef, PanelGrid } from "../PanelLayout";
import { ProtectionTrustPanel } from "../ProtectionTrustPanel";
import { SecurityHeadersPanel, SslPanel } from "../SecurityPanel";
import { CaaPanel, CertTransparencyPanel, SecurityTxtPanel } from "../Tier1Panels";

export default function SecurityTab({ data }: { data: AnalysisResult }) {
  const domain = data.domain;

  const transportPanels: PanelDef[] = [
    { id: "ssl", node: <SslPanel data={data} /> },
    { id: "caa", node: <CaaPanel data={data} /> },
    { id: "cert-transparency", node: <CertTransparencyPanel data={data} /> },
  ];

  const headersPanels: PanelDef[] = [
    { id: "security-headers", node: <SecurityHeadersPanel data={data} /> },
    { id: "protection-trust", node: <ProtectionTrustPanel data={data} /> },
    { id: "cookie-security", node: <CookieSecurityPanel data={data} /> },
  ];

  const disclosurePanels: PanelDef[] = [{ id: "security-txt", node: <SecurityTxtPanel data={data} /> }];

  return (
    <div className="space-y-3">
      <AxisSummaryCard data={data} axis="security" />
      <SectionHeader title="Transport & Encryption" />
      <PanelGrid tabId="security-transport" panels={transportPanels} />
      <SectionHeader title="Headers & Protection" />
      <PanelGrid tabId="security-headers" panels={headersPanels} />
      <SectionHeader title="Disclosure" />
      <PanelGrid tabId="security-disclosure" panels={disclosurePanels} />
      <div className="flex flex-wrap gap-2 px-1">
        <a
          href={`https://securityheaders.com/?q=${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          SecurityHeaders.com ↗
        </a>
      </div>
    </div>
  );
}
