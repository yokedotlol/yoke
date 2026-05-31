import { Clock } from "lucide-react";
import type { RecentLookupsResult } from "../utils/types";

type Lookup = RecentLookupsResult["lookups"][number];

interface RecentLookupsProps {
  lookups: Lookup[];
  onSelect: (domain: string) => void;
}

function tierColor(tier: string | null | undefined): string {
  if (!tier) return "var(--dim)";
  switch (tier) {
    case "Excellent":
      return "var(--success)";
    case "Strong":
      return "#58a6ff";
    case "Moderate":
      return "var(--warning, #eab308)";
    case "Weak":
      return "#ffa198";
    case "Critical":
      return "var(--danger)";
    default:
      return "var(--dim)";
  }
}

export function RecentLookups({ lookups, onSelect }: RecentLookupsProps) {
  if (lookups.length === 0) return null;

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <Clock size={13} style={{ color: "var(--dim)", flexShrink: 0 }} />
      {lookups.map((l) => (
        <button
          type="button"
          key={l.id}
          onClick={() => onSelect(l.domain)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent-dim)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = "var(--accent-dim)";
            e.currentTarget.style.color = "var(--text)";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: tierColor(l.tier) }} />
          <span>{l.domain}</span>
        </button>
      ))}
    </div>
  );
}
