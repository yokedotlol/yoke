import type { AnalysisResult } from "../../utils/types";
import { BreachPanel } from "../BreachPanel";
import { BusinessTab } from "../BusinessTab";
import { CookieConsentPanel } from "../CookieConsentPanel";
import { LegalPanel } from "../LegalPanel";
import { BlocklistPanel } from "../NetworkPanel";
import { SectionHeader } from "../Panel";
import { type PanelDef, PanelGrid } from "../PanelLayout";
import { WaybackPanel } from "../ReputationPanels";
import { GreynoisePanel } from "../Tier1Panels";
import { DomainExpiryPanel, WhoisPanel } from "../WhoisPanel";

export default function ReputationTab({ data }: { data: AnalysisResult }) {
  const domain = data.domain;

  const trustPanels: PanelDef[] = [
    { id: "breaches", node: <BreachPanel data={data} />, fullWidth: true },
    { id: "blocklist", node: <BlocklistPanel data={data} /> },
    { id: "greynoise", node: <GreynoisePanel data={data} /> },
  ];

  const compliancePanels: PanelDef[] = [
    { id: "cookie-consent", node: <CookieConsentPanel data={data} /> },
    { id: "legal", node: <LegalPanel data={data} /> },
  ];

  const identityPanels: PanelDef[] = [{ id: "business-info", node: <BusinessTab domain={domain} />, fullWidth: true }];

  const registrationPanels: PanelDef[] = [
    { id: "whois", node: <WhoisPanel data={data} /> },
    { id: "domain-expiry", node: <DomainExpiryPanel data={data} /> },
  ];

  const historyPanels: PanelDef[] = [{ id: "wayback", node: <WaybackPanel data={data} /> }];

  return (
    <div className="space-y-3">
      <SectionHeader title="Trust & Threat Intelligence" />
      <PanelGrid tabId="reputation-trust" panels={trustPanels} />
      <SectionHeader title="Compliance" />
      <PanelGrid tabId="reputation-compliance" panels={compliancePanels} />
      <SectionHeader title="Organization" />
      <PanelGrid tabId="reputation-identity" panels={identityPanels} grid={false} />
      <SectionHeader title="Registration" />
      <PanelGrid tabId="reputation-registration" panels={registrationPanels} />
      <SectionHeader title="History" />
      <PanelGrid tabId="reputation-history" panels={historyPanels} />
      <div className="flex flex-wrap gap-2 px-1">
        <a
          href={`https://haveibeenpwned.com/DomainSearch/${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          HIBP ↗
        </a>
        <a
          href={`https://ahrefs.com/backlink-checker/?input=${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          Ahrefs Backlinks ↗
        </a>
        <a
          href={`https://www.similarweb.com/website/${domain}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          SimilarWeb ↗
        </a>
      </div>
    </div>
  );
}
