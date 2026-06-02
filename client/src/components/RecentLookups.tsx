import { useEffect, useState } from "react";
import { ordinal } from "../utils/format";

// ─── Types ───────────────────────────────────────────────────────────

interface RecentEntry {
  domain: string;
  analyzed_at: string;
  score: number | null;
  tier: string | null;
  archetype: string | null;
  axes?: Record<string, number | null>;
  composite_percentile?: number | null;
}

interface RecentResponse {
  lookups: RecentEntry[];
  percentile_sample_size?: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const AXIS_KEYS = ["security", "speed", "foundations", "reputation", "discoverability", "email"] as const;
const AXIS_ABBR: Record<string, string> = {
  security: "SEC",
  speed: "SPD",
  foundations: "FND",
  reputation: "REP",
  discoverability: "DSC",
  email: "EML",
};
const AXIS_LABELS: Record<string, string> = {
  security: "Security",
  speed: "Speed",
  foundations: "Foundations",
  reputation: "Reputation",
  discoverability: "Discoverability",
  email: "Email",
};

const TIER_THRESHOLDS: Array<{ min: number; label: string; color: string }> = [
  { min: 90, label: "Excellent", color: "var(--tier-excellent)" },
  { min: 75, label: "Strong", color: "var(--tier-strong)" },
  { min: 60, label: "Moderate", color: "var(--tier-moderate)" },
  { min: 40, label: "Weak", color: "var(--tier-weak)" },
  { min: 0, label: "Critical", color: "var(--tier-critical)" },
];

function tierFor(score: number | null | undefined): { label: string; color: string } {
  if (score == null) return { label: "N/A", color: "#6b7280" };
  for (const t of TIER_THRESHOLDS) {
    if (score >= t.min) return t;
  }
  return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
}

// ─── Percentile helpers ──────────────────────────────────────────────

function pctilePipStyle(pctile: number): { bg: string; color: string } {
  if (pctile >= 90) return { bg: "rgba(34, 197, 94, 0.12)", color: "#4ade80" }; // green — top 10
  if (pctile >= 75) return { bg: "rgba(99, 102, 241, 0.12)", color: "#a5b4fc" }; // indigo — top 25
  return { bg: "rgba(148, 163, 184, 0.1)", color: "#94a3b8" }; // neutral
}

function pctilePipText(pctile: number): string {
  if (pctile >= 90) return `Top ${Math.max(1, 100 - pctile)}%`;
  return ordinal(pctile);
}

// ─── Styles ──────────────────────────────────────────────────────────

const NULL_PATTERN =
  "repeating-linear-gradient(-45deg, var(--border) 0px, var(--border) 3px, var(--surface) 3px, var(--surface) 6px)";

// ─── Component ───────────────────────────────────────────────────────

export function RecentLookups({ onSelect }: { onSelect: (domain: string) => void }) {
  const [entries, setEntries] = useState<RecentEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/_/recent")
      .then((r) => (r.ok ? r.json() : { lookups: [] }))
      .then((data: RecentResponse) => {
        if (!cancelled && data.lookups?.length) setEntries(data.lookups);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) return null;

  // If no entries have axis data, fall back to simple chip display
  const hasAxisData = entries.some((e) => e.axes && Object.keys(e.axes).length > 0);

  if (!hasAxisData) {
    return <RecentChips entries={entries} onSelect={onSelect} />;
  }

  return (
    <div style={{ width: "100%", maxWidth: "820px", marginTop: "1.5rem" }}>
      {/* Responsive styles for feed */}
      <style>{`
        .recent-feed-header, .recent-feed-row {
          gap: 0.6rem;
        }
        .recent-domain-col { flex: 0 0 140px; }
        .recent-tier-col { /* auto-sized */ }
        @media (max-width: 640px) {
          .recent-domain-col { flex: 0 0 100px !important; font-size: 10px !important; }
          .recent-feed-header, .recent-feed-row { padding-left: 0.5rem !important; padding-right: 0.5rem !important; gap: 0.4rem !important; }
          .recent-axis-header span { font-size: 8px !important; }
          .recent-axis-cell span { font-size: 9px !important; }
        }
        @media (max-width: 440px) {
          .recent-domain-col { flex: 0 0 72px !important; font-size: 9px !important; }
          .recent-feed-header, .recent-feed-row { padding-left: 0.35rem !important; padding-right: 0.35rem !important; gap: 0.25rem !important; }
          .recent-axis-header span { font-size: 7px !important; letter-spacing: 0 !important; }
          .recent-axis-cell span { font-size: 8px !important; }
          .recent-tier-label { display: none !important; }
        }
      `}</style>
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

      {/* Axis header row */}
      <div
        className="recent-feed-header"
        style={{
          display: "flex",
          padding: "0 0.75rem",
          marginBottom: "0.2rem",
          alignItems: "center",
        }}
      >
        <div className="recent-domain-col" />
        <div className="recent-axis-header" style={{ flex: 1, display: "flex", gap: "1px", minWidth: 0 }}>
          {AXIS_KEYS.map((key) => (
            <span
              key={key}
              title={AXIS_LABELS[key]}
              style={{
                flex: 1,
                textAlign: "center",
                fontFamily: "var(--font-ui)",
                fontSize: "9px",
                fontWeight: 700,
                color: "var(--dim)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                opacity: 0.7,
              }}
            >
              {AXIS_ABBR[key]}
            </span>
          ))}
        </div>
        <div style={{ flex: "0 0 auto", minWidth: 112 }} />
      </div>

      {/* Feed rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        {entries.map((entry) => (
          <button
            key={entry.domain}
            type="button"
            onClick={() => onSelect(entry.domain)}
            className="recent-feed-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              padding: "0.35rem 0.75rem",
              background: "var(--surface)",
              borderRadius: "6px",
              border: "1px solid transparent",
              cursor: "pointer",
              transition: "all 0.15s",
              width: "100%",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.background = "var(--bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.background = "var(--surface)";
            }}
          >
            {/* Domain name */}
            <span
              className="recent-domain-col"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                fontWeight: 500,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {entry.domain}
            </span>

            {/* Heatmap stripe */}
            <div
              style={{
                flex: 1,
                display: "flex",
                borderRadius: "4px",
                overflow: "hidden",
                height: "22px",
                gap: "1px",
                background: "rgba(0,0,0,0.3)",
                minWidth: 0,
              }}
            >
              {AXIS_KEYS.map((key) => {
                const val = entry.axes?.[key] ?? null;
                const t = tierFor(val);
                const isNull = val == null;
                return (
                  <div
                    key={key}
                    className="recent-axis-cell"
                    title={`${AXIS_LABELS[key]}: ${isNull ? "N/A" : `${val} (${t.label})`}`}
                    style={{
                      flex: 1,
                      position: "relative",
                      minWidth: 0,
                      background: isNull ? NULL_PATTERN : t.color,
                      transition: "filter 0.15s",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "var(--font-mono)",
                        fontSize: "10px",
                        fontWeight: 700,
                        color: isNull ? "rgba(255,255,255,0.5)" : "var(--tier-text)",
                        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                        pointerEvents: "none",
                      }}
                    >
                      {isNull ? "—" : val}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Percentile — fixed-width cell */}
            <span
              style={{
                flex: "0 0 48px",
                textAlign: "right",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              {entry.composite_percentile != null && (
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "9px",
                    fontWeight: 500,
                    color: pctilePipStyle(entry.composite_percentile).color,
                    background: pctilePipStyle(entry.composite_percentile).bg,
                    padding: "1px 5px",
                    borderRadius: "10px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {pctilePipText(entry.composite_percentile)}
                </span>
              )}
            </span>
            {/* Tier label — fixed-width cell */}
            <span
              className="recent-tier-label"
              style={{
                flex: "0 0 64px",
                textAlign: "right",
                fontFamily: "var(--font-ui)",
                fontSize: "10px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: tierFor(entry.score).color,
                whiteSpace: "nowrap",
              }}
            >
              {entry.tier ?? ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Fallback chip display (no axis data) ────────────────────────────

function RecentChips({ entries, onSelect }: { entries: RecentEntry[]; onSelect: (domain: string) => void }) {
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
          >
            <span style={{ opacity: 0.85 }}>{entry.domain}</span>
            {entry.score != null && entry.tier && (
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: tierFor(entry.score).color,
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
