import { useEffect, useState } from "react";

interface RecentEntry {
  domain: string;
  analyzed_at: string;
  score: number | null;
  tier: string | null;
  archetype: string | null;
}

const TIER_COLORS: Record<string, string> = {
  Excellent: "#3fb950",
  Strong: "#58a6ff",
  Moderate: "#d29922",
  Weak: "#f85149",
  Critical: "#da3633",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function RecentLookups({ onSelect }: { onSelect: (domain: string) => void }) {
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/_/recent")
      .then((r) => (r.ok ? r.json() : { lookups: [] }))
      .then((data: { lookups: RecentEntry[] }) => {
        if (!cancelled && data.lookups?.length) setEntries(data.lookups);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div style={{ width: "100%", maxWidth: "700px", marginTop: "1.5rem" }}>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--dim)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "0.5rem",
          textAlign: "center",
        }}
      >
        Recently Analyzed
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.375rem",
        }}
      >
        {entries.map((entry) => (
          <button
            key={entry.domain}
            type="button"
            onClick={() => onSelect(entry.domain)}
            className="recent-chip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.25rem 0.625rem",
              borderRadius: "999px",
              border: "1px solid var(--border-muted)",
              background: "var(--surface)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text)",
              transition: "all 0.15s",
              lineHeight: "20px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.background = "var(--bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-muted)";
              e.currentTarget.style.background = "var(--surface)";
            }}
            title={`${entry.domain} — ${entry.tier ?? "?"} (${entry.score ?? "?"})\n${timeAgo(entry.analyzed_at)}`}
          >
            <span style={{ opacity: 0.85 }}>{entry.domain}</span>
            {entry.score != null && entry.tier && (
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: TIER_COLORS[entry.tier] ?? "var(--dim)",
                  opacity: 0.9,
                }}
              >
                {entry.score}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
