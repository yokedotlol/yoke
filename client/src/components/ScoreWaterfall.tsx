// ─── Score Waterfall Component ──────────────────────────────────────
// Replaces the old "Score Factors" flat list with an axis-grouped
// deduction waterfall showing exactly where every point went.

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { AXIS_WEIGHTS, SIGNAL_REGISTRY } from "../../../worker/src/config/signal-registry";
import type { AnalysisResult, Axis } from "../api";
import { severityBg, severityColor } from "../utils/severity";

const AXIS_LABELS: Record<string, string> = {
  security: "Security",
  speed: "Speed",
  foundations: "Foundations",
  reputation: "Reputation",
  discoverability: "Discoverability",
  email: "Email",
};

const AXIS_COLORS: Record<string, string> = {
  security: "#f85149",
  speed: "#58a6ff",
  foundations: "#7ee787",
  reputation: "#d2a221",
  discoverability: "#bc8cff",
  email: "#f778ba",
};

interface WaterfallSignal {
  signal: string;
  label: string;
  severity: string;
  deduction: number;
  weight: number;
  share: number;
  tier: "issue" | "opportunity" | "not_detected";
  effort?: string;
  actionable: boolean;
}

interface WaterfallAxis {
  axis: Axis;
  score: number;
  totalDeduction: number;
  compositeImpact: number;
  signals: WaterfallSignal[];
}

function buildWaterfallData(data: AnalysisResult): WaterfallAxis[] {
  const score = data.domain_score;
  if (!score) return [];

  const axes: WaterfallAxis[] = [];
  const assessedAxes = (Object.keys(AXIS_WEIGHTS) as Axis[]).filter((a) => {
    const ad = score.axes[a];
    return ad && !ad.not_measured && ad.score != null;
  });

  const totalWeight = assessedAxes.reduce((s, a) => s + (AXIS_WEIGHTS[a] ?? 0), 0);

  for (const axisName of assessedAxes) {
    const axisData = score.axes[axisName];
    if (!axisData || axisData.score == null) continue;

    const axisGap = 100 - axisData.score;
    if (axisGap <= 0) continue; // Perfect axis, skip

    const signals: WaterfallSignal[] = [];
    const deds = axisData.deductions || [];

    for (const ded of deds) {
      if (ded.signal === "_absent") {
        // Expand individual absent signals
        if (ded.absentSignals) {
          for (const abs of ded.absentSignals) {
            const reg = SIGNAL_REGISTRY[abs.signal];
            const displayLabel = abs.absentLabel || reg?.absentLabel || `${abs.label} not detected`;
            signals.push({
              signal: abs.signal,
              label: displayLabel,
              severity: "absent",
              deduction: abs.deduction ?? 0,
              weight: abs.weight,
              share: ded.share > 0 ? (abs.weight / ded.weight) * ded.share : 0,
              tier: abs.actionable ? "opportunity" : "not_detected",
              effort: abs.effort,
              actionable: abs.actionable,
            });
          }
        }
      } else {
        // Fired finding
        const isGood = ded.severity === "good" || ded.severity === "info";
        if (isGood && ded.deduction === 0) continue; // Skip positive signals with no deduction

        signals.push({
          signal: ded.signal,
          label: ded.label,
          severity: ded.severity,
          deduction: ded.deduction,
          weight: ded.weight,
          share: ded.share,
          tier: "issue",
          actionable: true,
        });
      }
    }

    // Sort: issues first (by deduction desc), then opportunities (by deduction desc), then not_detected
    const tierOrder = { issue: 0, opportunity: 1, not_detected: 2 };
    signals.sort((a, b) => {
      const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
      if (tierDiff !== 0) return tierDiff;
      return b.deduction - a.deduction;
    });

    const axisWeight = AXIS_WEIGHTS[axisName] ?? 0;
    const compositeImpact = totalWeight > 0 ? axisGap * (axisWeight / totalWeight) : 0;

    axes.push({
      axis: axisName,
      score: axisData.score,
      totalDeduction: axisGap,
      compositeImpact,
      signals,
    });
  }

  // Sort by composite impact (highest first)
  axes.sort((a, b) => b.compositeImpact - a.compositeImpact);
  return axes;
}

function SeverityMarker({ severity, tier }: { severity: string; tier: string }) {
  if (tier === "issue") {
    const color = severityColor(severity) || "var(--warning)";
    return (
      <span
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
    );
  }
  if (tier === "opportunity") {
    return (
      <span
        style={{
          width: "7px",
          height: "7px",
          borderRadius: "50%",
          border: "1.5px solid var(--muted)",
          background: "transparent",
          flexShrink: 0,
        }}
      />
    );
  }
  // not_detected
  return (
    <span
      style={{
        width: "7px",
        height: "7px",
        borderRadius: "50%",
        background: "var(--border)",
        opacity: 0.5,
        flexShrink: 0,
      }}
    />
  );
}

function DeductionBar({ deduction, maxDeduction }: { deduction: number; maxDeduction: number }) {
  const pct = maxDeduction > 0 ? Math.min((deduction / maxDeduction) * 100, 100) : 0;
  if (pct < 1) return null;
  return (
    <div
      style={{
        width: "40px",
        height: "3px",
        borderRadius: "1.5px",
        background: "var(--border)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          height: "100%",
          borderRadius: "1.5px",
          background: "var(--muted)",
          width: `${pct}%`,
          opacity: 0.6,
        }}
      />
    </div>
  );
}

export function ScoreWaterfall({ data }: { data: AnalysisResult }) {
  const waterfallAxes = buildWaterfallData(data);
  const [expandedAxes, setExpandedAxes] = useState<Set<string>>(() => {
    // Auto-expand the most impactful axis
    if (waterfallAxes.length > 0) return new Set([waterfallAxes[0].axis]);
    return new Set<string>();
  });

  if (waterfallAxes.length === 0) return null;

  const toggleAxis = (axis: string) => {
    setExpandedAxes((prev) => {
      const next = new Set(prev);
      if (next.has(axis)) next.delete(axis);
      else next.add(axis);
      return next;
    });
  };

  // Perfect axes (score = 100)
  const score = data.domain_score;
  const perfectAxes = score
    ? (Object.keys(AXIS_WEIGHTS) as Axis[]).filter((a) => {
        const ad = score.axes[a];
        return ad && !ad.not_measured && ad.score === 100;
      })
    : [];

  return (
    <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "10px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Score Breakdown
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {waterfallAxes.map((wa) => {
          const isExpanded = expandedAxes.has(wa.axis);
          const issueCount = wa.signals.filter((s) => s.tier === "issue").length;
          const oppCount = wa.signals.filter((s) => s.tier === "opportunity").length;
          const ndCount = wa.signals.filter((s) => s.tier === "not_detected").length;
          const maxDeduction = Math.max(...wa.signals.map((s) => s.deduction), 1);

          return (
            <div key={wa.axis}>
              {/* Axis header — clickable */}
              <button
                type="button"
                onClick={() => toggleAxis(wa.axis)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  gap: "8px",
                  padding: "8px 8px",
                  borderRadius: "6px",
                  background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isExpanded) e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                }}
                onMouseLeave={(e) => {
                  if (!isExpanded) e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: AXIS_COLORS[wa.axis] || "var(--muted)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text)",
                    minWidth: "90px",
                    textAlign: "left",
                  }}
                >
                  {AXIS_LABELS[wa.axis] || wa.axis}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: wa.score >= 90 ? "var(--success)" : wa.score >= 75 ? "var(--text)" : "var(--warning)",
                    minWidth: "32px",
                  }}
                >
                  {wa.score}
                </span>

                {/* Mini bar showing gap */}
                <div
                  style={{
                    flex: 1,
                    height: "4px",
                    borderRadius: "2px",
                    background: "var(--border)",
                    overflow: "hidden",
                    maxWidth: "120px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: "2px",
                      background: AXIS_COLORS[wa.axis] || "var(--muted)",
                      width: `${wa.score}%`,
                      opacity: 0.5,
                    }}
                  />
                </div>

                <span style={{ fontSize: "10px", color: "var(--dim)", minWidth: "45px", textAlign: "right" }}>
                  −{wa.totalDeduction} pts
                </span>
                <span style={{ fontSize: "10px", color: "var(--dim)", opacity: 0.5, marginLeft: "2px" }}>
                  {wa.signals.length} signal{wa.signals.length !== 1 ? "s" : ""}
                </span>
                {isExpanded ? (
                  <ChevronUp size={12} style={{ color: "var(--dim)", flexShrink: 0 }} />
                ) : (
                  <ChevronDown size={12} style={{ color: "var(--dim)", flexShrink: 0 }} />
                )}
              </button>

              {/* Expanded signal list */}
              {isExpanded && (
                <div
                  style={{
                    padding: "2px 8px 8px 24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "1px",
                  }}
                >
                  {/* Issues section */}
                  {issueCount > 0 && (
                    <>
                      <div
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          color: "var(--warning)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          padding: "4px 0 2px",
                          marginTop: "2px",
                        }}
                      >
                        Issues
                      </div>
                      {wa.signals
                        .filter((s) => s.tier === "issue")
                        .map((sig) => (
                          <SignalRow key={sig.signal} sig={sig} maxDeduction={maxDeduction} />
                        ))}
                    </>
                  )}

                  {/* Opportunities section */}
                  {oppCount > 0 && (
                    <>
                      <div
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          padding: "4px 0 2px",
                          marginTop: issueCount > 0 ? "6px" : "2px",
                        }}
                      >
                        Opportunities
                      </div>
                      {wa.signals
                        .filter((s) => s.tier === "opportunity")
                        .map((sig) => (
                          <SignalRow key={sig.signal} sig={sig} maxDeduction={maxDeduction} />
                        ))}
                    </>
                  )}

                  {/* Not detected section */}
                  {ndCount > 0 && (
                    <>
                      <div
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          color: "var(--dim)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          padding: "4px 0 2px",
                          marginTop: issueCount > 0 || oppCount > 0 ? "6px" : "2px",
                        }}
                      >
                        Not detected
                      </div>
                      {wa.signals
                        .filter((s) => s.tier === "not_detected")
                        .map((sig) => (
                          <SignalRow key={sig.signal} sig={sig} maxDeduction={maxDeduction} />
                        ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Perfect axes summary */}
      {perfectAxes.length > 0 && (
        <div style={{ fontSize: "10px", color: "var(--dim)", marginTop: "8px", paddingLeft: "8px" }}>
          {perfectAxes.map((a) => AXIS_LABELS[a] || a).join(", ")} — no deductions
        </div>
      )}
    </div>
  );
}

function SignalRow({ sig, maxDeduction }: { sig: WaterfallSignal; maxDeduction: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 4px",
        borderRadius: "3px",
        minHeight: "22px",
      }}
    >
      <SeverityMarker severity={sig.severity} tier={sig.tier} />
      <span
        style={{
          fontSize: "11px",
          color: sig.tier === "not_detected" ? "var(--dim)" : "var(--text-secondary)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={sig.label}
      >
        {sig.label}
      </span>
      {sig.effort && <span style={{ fontSize: "9px", color: "var(--dim)", flexShrink: 0 }}>{sig.effort}</span>}
      {sig.tier === "issue" && sig.severity !== "good" && sig.severity !== "info" && (
        <span
          style={{
            fontSize: "9px",
            padding: "0px 4px",
            borderRadius: "3px",
            background: severityBg(sig.severity),
            color: severityColor(sig.severity),
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {sig.severity}
        </span>
      )}
      <DeductionBar deduction={sig.deduction} maxDeduction={maxDeduction} />
      <span
        style={{
          fontSize: "10px",
          color: sig.deduction > 0 ? "var(--muted)" : "var(--dim)",
          fontVariantNumeric: "tabular-nums",
          minWidth: "32px",
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {sig.deduction > 0 ? `−${sig.deduction.toFixed(1)}` : "—"}
      </span>
    </div>
  );
}
