import { Link2 } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { DataRow, Panel, StatusBadge } from "./Panel";

export function ResourceHintsPanel({ data }: { data: AnalysisResult }) {
  const hints = data.resource_hints;
  if (!hints || hints.total === 0) return null;

  return (
    <Panel
      title="Resource Hints"
      icon={<Link2 size={14} />}
      badge={<StatusBadge status="pass" label={`${hints.total} hints`} />}
    >
      {hints.preconnect.length > 0 && <DataRow label="Preconnect" value={`${hints.preconnect.length} origins`} />}
      {hints.preload.length > 0 && <DataRow label="Preload" value={`${hints.preload.length} resources`} />}
      {hints.prefetch.length > 0 && <DataRow label="Prefetch" value={`${hints.prefetch.length} resources`} />}
      {hints.dns_prefetch.length > 0 && <DataRow label="DNS Prefetch" value={`${hints.dns_prefetch.length} domains`} />}
      {hints.modulepreload.length > 0 && (
        <DataRow label="Module Preload" value={`${hints.modulepreload.length} modules`} />
      )}
    </Panel>
  );
}
