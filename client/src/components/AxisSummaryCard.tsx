import { severityColor, severityIcon, tierColor } from "../utils/severity";
import type { AnalysisResult, Axis, AxisScoreData, ScoreFinding } from "../utils/types";
import { Tooltip } from "./Tooltip";

const AXIS_LABELS: Record<Axis, string> = {
  security: "Security",
  speed: "Speed",
  foundations: "Foundations",
  reputation: "Reputation",
  discoverability: "Discoverability",
  email: "Email",
};

function tierLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 78) return "Strong";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Weak";
  return "Critical";
}

/**
 * Compact axis summary card shown at the top of each axis-aligned tab.
 * Shows axis score, tier, and top findings (issues + missing signals).
 */
export function AxisSummaryCard({ data, axis }: { data: AnalysisResult; axis: Axis }) {
  const ds = data.domain_score;
  if (!ds) return null;

  const axisData: AxisScoreData = ds.axes[axis];
  if (!axisData || axisData.not_measured || axisData.score == null) return null;

  const score = axisData.score;
  const tier = tierLabel(score);
  const color = tierColor(tier);

  // Top deductions — sorted by severity
  const severityOrder = ["critical", "high", "medium", "low", "info", "good"];
  const issues = axisData.findings
    .filter((f: ScoreFinding) => f.severity !== "good" && f.severity !== "info")
    .sort((a: ScoreFinding, b: ScoreFinding) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity))
    .slice(0, 4);

  const goodCount = axisData.findings.filter((f: ScoreFinding) => f.severity === "good").length;

  return (
    <div
      className="panel"
      style={{
        borderLeft: `3px solid ${color}`,
        marginBottom: "0.75rem",
      }}
    >
      <div className="p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Score + Tier */}
          <div className="flex items-center gap-3">
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "28px",
                fontWeight: 700,
                lineHeight: 1,
                color,
              }}
            >
              {score}
            </div>
            <div>
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                {AXIS_LABELS[axis]}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  fontWeight: 600,
                  color,
                }}
              >
                {tier}
              </div>
            </div>
          </div>

          {/* Stats badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {issues.length > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "var(--danger, #e53e3e)",
                  background: "color-mix(in srgb, var(--danger, #e53e3e) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--danger, #e53e3e) 15%, transparent)",
                  borderRadius: "10px",
                  padding: "2px 8px",
                }}
              >
                {issues.length} issue{issues.length !== 1 ? "s" : ""}
              </span>
            )}
            {goodCount > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "var(--success, #38a169)",
                  background: "color-mix(in srgb, var(--success, #38a169) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--success, #38a169) 15%, transparent)",
                  borderRadius: "10px",
                  padding: "2px 8px",
                }}
              >
                {goodCount} passing
              </span>
            )}
          </div>
        </div>

        {/* Top findings list */}
        {issues.length > 0 && (
          <div className="mt-2 pt-2 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
            {issues.map((f: ScoreFinding, i: number) => (
              <div
                key={`${f.signal}-${i}`}
                className="flex items-start gap-2"
                style={{ fontSize: "11px", lineHeight: "16px" }}
              >
                <span style={{ fontSize: "10px", flexShrink: 0, marginTop: 1 }}>{severityIcon(f.severity)}</span>
                <span style={{ fontFamily: "var(--font-ui)", color: severityColor(f.severity) }}>
                  {f.label}
                  {f.source && <Tooltip text={f.source} help />}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
