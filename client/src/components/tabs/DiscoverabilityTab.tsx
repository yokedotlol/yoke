import type { AnalysisResult } from "../../utils/types";
import { AccessibilityPanel } from "../AccessibilityPanel";
import { AiReadinessPanel } from "../AiReadinessPanel";
import { AxisSummaryCard } from "../AxisSummaryCard";
import { LlmsTxtPanel, MetaPanel, RobotsDeepPanel } from "../MetaPanel";
import { OgPreviewPanel } from "../OgPreviewPanel";
import { SectionHeader } from "../Panel";
import { type PanelDef, PanelGrid } from "../PanelLayout";
import { StructuredDataPanel } from "../StructuredDataPanel";

export default function DiscoverabilityTab({ data }: { data: AnalysisResult }) {
  const domain = data.domain;

  const seoPanels: PanelDef[] = [
    { id: "meta", node: <MetaPanel data={data} /> },
    { id: "og-preview", node: <OgPreviewPanel data={data} /> },
  ];

  const structuredPanels: PanelDef[] = [{ id: "structured-data", node: <StructuredDataPanel data={data} /> }];

  const crawlabilityPanels: PanelDef[] = [
    { id: "robots", node: <RobotsDeepPanel data={data} /> },
    { id: "llms-txt", node: <LlmsTxtPanel data={data} /> },
    { id: "ai-readiness", node: <AiReadinessPanel data={data} /> },
  ];

  const accessibilityPanels: PanelDef[] = [{ id: "accessibility", node: <AccessibilityPanel data={data} /> }];

  return (
    <div className="space-y-3">
      <AxisSummaryCard data={data} axis="discoverability" />
      <SectionHeader title="SEO & Social Meta" />
      <PanelGrid tabId="discoverability-seo" panels={seoPanels} />
      <SectionHeader title="Structured Data" />
      <PanelGrid tabId="discoverability-structured" panels={structuredPanels} />
      <SectionHeader title="Crawlability & AI Readiness" />
      <PanelGrid tabId="discoverability-crawl" panels={crawlabilityPanels} />
      <SectionHeader title="Accessibility" />
      <PanelGrid tabId="discoverability-a11y" panels={accessibilityPanels} />
      <div className="flex flex-wrap gap-2 px-1">
        <a
          href={`https://search.google.com/test/rich-results?url=https://${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          Rich Results Test ↗
        </a>
        <a
          href={`https://www.wappalyzer.com/lookup/${domain}`}
          target="_blank"
          rel="noopener noreferrer"
          className="badge badge-info"
          style={{ fontSize: "10px", textDecoration: "none", cursor: "pointer" }}
        >
          Wappalyzer ↗
        </a>
      </div>
    </div>
  );
}
