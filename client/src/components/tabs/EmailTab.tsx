import type { AnalysisResult } from "../../utils/types";
import { AxisSummaryCard } from "../AxisSummaryCard";
import { EmailExtrasPanel } from "../NewPanels";
import { type PanelDef, PanelGrid } from "../PanelLayout";
import { EmailAuthPanel } from "../ReputationPanels";

export default function EmailTab({ data }: { data: AnalysisResult }) {
  const domain = data.domain;

  const panels: PanelDef[] = [
    { id: "email-auth", node: <EmailAuthPanel data={data} /> },
    { id: "email-extras", node: <EmailExtrasPanel data={data} /> },
  ];

  return (
    <div className="space-y-3">
      <AxisSummaryCard data={data} axis="email" />
      <PanelGrid tabId="email" panels={panels} />
      <div className="flex flex-wrap gap-2 px-1">
        <a
          href={`https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${domain}&run=toolpage`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          MXToolbox ↗
        </a>
        <a
          href={`https://dmarcian.com/dmarc-inspector/?domain=${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          DMARC Inspector ↗
        </a>
      </div>
    </div>
  );
}
