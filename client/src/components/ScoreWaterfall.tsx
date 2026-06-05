// ─── Unified Score Breakdown Component (v2) ────────────────────────
// Shows axis-grouped deductions with:
// - Live composite formula display
// - Tier progress bar
// - "What if?" simulate mode with ghost bars
// - Weighted composite impact (not raw axis points)
// - Expandable signals with fix descriptions + reference links

import { ChevronDown, ChevronUp, ExternalLink, HelpCircle, MessageSquare } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  AXIS_WEIGHTS,
  FIX_DESC_MAP,
  NON_ACTIONABLE_SIGNALS,
  SCORE_DRAG_SIGNALS,
  SIGNAL_REGISTRY,
} from "../../../worker/src/config/signal-registry";
import type { AnalysisResult, Axis } from "../api";
import { severityBg, severityColor } from "../utils/severity";
import { Tooltip } from "./Tooltip";

// ─── Constants ──────────────────────────────────────────────────────

const AXIS_LABELS: Record<string, string> = {
  security: "Security",
  speed: "Speed",
  foundations: "Foundations",
  reputation: "Reputation",
  discoverability: "Discoverability",
  email: "Email",
};

const AXIS_ABBR: Record<string, string> = {
  security: "SEC",
  speed: "SPD",
  foundations: "FND",
  reputation: "REP",
  discoverability: "DIS",
  email: "EML",
};

const AXIS_COLORS: Record<string, string> = {
  security: "#f85149",
  speed: "#58a6ff",
  foundations: "#7ee787",
  reputation: "#d2a221",
  discoverability: "#bc8cff",
  email: "#f778ba",
};

const EFFORT_LABELS: Record<string, { icon: string; label: string }> = {
  quick: { icon: "⚡", label: "Quick" },
  moderate: { icon: "🔧", label: "Moderate" },
  major: { icon: "🏗️", label: "Major" },
};

import { getConfig } from "../config";

const GITHUB_ISSUES_URL = getConfig().feedbackUrl;

const TIER_DEFS = [
  { tier: "Critical", min: 0, max: 40, color: "var(--tier-critical)" },
  { tier: "Weak", min: 40, max: 60, color: "var(--tier-weak)" },
  { tier: "Moderate", min: 60, max: 78, color: "var(--tier-moderate)" },
  { tier: "Strong", min: 78, max: 90, color: "var(--tier-strong)" },
  { tier: "Excellent", min: 90, max: 100, color: "var(--tier-excellent)" },
];

// ─── Types ──────────────────────────────────────────────────────────

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
  fixDescription?: string;
  fixLink?: { url: string; label: string } | null;
  tooltipText?: string;
  isDrag?: boolean;
}

interface WaterfallAxis {
  axis: Axis;
  score: number;
  totalDeduction: number;
  compositeImpact: number;
  signals: WaterfallSignal[];
}

// ─── Helpers ────────────────────────────────────────────────────────

// Null axes imputed at 35 to match backend contextual-scoring.ts NULL_AXIS_IMPUTE
const NULL_AXIS_IMPUTE = 35;

function clientComposite(axisScores: Record<string, number>): number {
  let sum = 0;
  for (const axis of Object.keys(AXIS_WEIGHTS) as Axis[]) {
    sum += (AXIS_WEIGHTS[axis] ?? 0) * (axisScores[axis] ?? 0);
  }
  const score = Math.max(0, Math.min(100, Math.round(sum)));
  const hasLowOutlier = (Object.keys(AXIS_WEIGHTS) as Axis[]).some((a) => (axisScores[a] ?? 0) < 40);
  return hasLowOutlier && score > 74 ? 74 : score;
}

function getTierName(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 78) return "Strong";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Weak";
  return "Critical";
}

// ─── Tooltip text generation ────────────────────────────────────────

function getTooltipText(signal: string, tier: string): string | undefined {
  const reg = SIGNAL_REGISTRY[signal];
  if (!reg) return undefined;
  if (tier === "opportunity" || tier === "not_detected") {
    if (reg.promptGuidance) return reg.promptGuidance;
    if (reg.fixDescription) return reg.fixDescription;
  }
  if (tier === "issue" && reg.promptGuidance) return reg.promptGuidance;
  return undefined;
}

// ─── Fix link generation ────────────────────────────────────────────

function detectTechStack(data: AnalysisResult): {
  isWordPress: boolean;
  isCloudflare: boolean;
} {
  const isWordPress = !!data.wordpress?.detected;
  const isCloudflare = !!(
    (data.hosting?.cdn ?? "").toLowerCase().includes("cloudflare") ||
    (data.hosting?.provider ?? "").toLowerCase().includes("cloudflare")
  );
  return { isWordPress, isCloudflare };
}

function getFixLink(signalId: string, data: AnalysisResult): { url: string; label: string } | null {
  const { isWordPress, isCloudflare } = detectTechStack(data);
  const sig = signalId.toLowerCase();

  if (sig.includes("hsts") || sig === "strict-transport-security") {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/",
        label: "Cloudflare HSTS docs",
      };
    if (isWordPress)
      return {
        url: "https://developer.wordpress.org/advanced-administration/security/hsts/",
        label: "WordPress HSTS guide",
      };
    return {
      url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security",
      label: "MDN HSTS reference",
    };
  }
  if (sig.includes("csp") || sig.includes("content_security")) {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/workers/examples/security-headers/",
        label: "Cloudflare security headers",
      };
    return { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP", label: "MDN CSP guide" };
  }
  if (sig.includes("dmarc")) return { url: "https://dmarc.org/overview/", label: "DMARC setup guide" };
  if (sig.includes("spf"))
    return { url: "https://www.cloudflare.com/learning/dns/dns-records/dns-spf-record/", label: "SPF record guide" };
  if (sig.includes("dkim"))
    return { url: "https://www.cloudflare.com/learning/dns/dns-records/dns-dkim-record/", label: "DKIM setup guide" };
  if (sig.includes("structured") || sig.includes("json_ld")) {
    if (isWordPress)
      return { url: "https://yoast.com/structured-data-schema-ultimate-guide/", label: "Yoast structured data guide" };
    return {
      url: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
      label: "Google structured data guide",
    };
  }
  if (sig.includes("compression")) {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/speed/optimization/content/brotli/",
        label: "Cloudflare Brotli compression",
      };
    return { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Compression", label: "MDN compression guide" };
  }
  if (sig.includes("http2")) {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/speed/optimization/protocol/http2/",
        label: "Cloudflare HTTP/2 docs",
      };
    return { url: "https://developer.mozilla.org/en-US/docs/Glossary/HTTP_2", label: "MDN HTTP/2 reference" };
  }
  if (sig.includes("dnssec")) {
    if (isCloudflare) return { url: "https://developers.cloudflare.com/dns/dnssec/", label: "Cloudflare DNSSEC docs" };
    return {
      url: "https://www.icann.org/resources/pages/dnssec-what-is-it-why-is-it-important-2019-03-05-en",
      label: "DNSSEC overview",
    };
  }
  if (sig.includes("caa"))
    return {
      url: "https://blog.qualys.com/product-tech/2017/03/13/caa-mandated-by-cabrowser-forum",
      label: "CAA records guide",
    };
  if (sig.includes("security_txt")) return { url: "https://securitytxt.org/", label: "security.txt generator" };
  if (sig.includes("social_meta") || sig.includes("og_") || sig.includes("twitter_"))
    return { url: "https://ogp.me/", label: "Open Graph protocol docs" };
  if (sig.includes("social_verified") || sig.includes("social_not_verified"))
    return { url: "https://indieweb.org/rel-me", label: 'rel="me" verification guide' };
  if (sig.includes("sitemap"))
    return {
      url: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview",
      label: "Google sitemap guide",
    };
  if (sig.includes("ssl") || sig.includes("tls")) {
    if (isCloudflare)
      return { url: "https://developers.cloudflare.com/ssl/edge-certificates/", label: "Cloudflare SSL docs" };
    return {
      url: "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",
      label: "MDN TLS reference",
    };
  }
  return null;
}

// ─── Data builder ───────────────────────────────────────────────────

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
    if (axisGap <= 0) continue;

    const signals: WaterfallSignal[] = [];
    const deds = axisData.deductions || [];

    for (const ded of deds) {
      if (ded.signal === "_absent") {
        if (ded.absentSignals) {
          for (const abs of ded.absentSignals) {
            const reg = SIGNAL_REGISTRY[abs.signal];
            const displayLabel = abs.absentLabel || reg?.absentLabel || `${abs.label} not detected`;
            const fixDesc = abs.fixDescription || reg?.fixDescription || undefined;
            const tooltip = getTooltipText(abs.signal, abs.actionable ? "opportunity" : "not_detected");

            signals.push({
              signal: abs.signal,
              label: displayLabel,
              severity: "absent",
              deduction: abs.deduction ?? 0,
              weight: abs.weight,
              share: ded.share > 0 ? (abs.weight / ded.weight) * ded.share : 0,
              tier: abs.actionable ? "opportunity" : "not_detected",
              effort: abs.effort || reg?.effort,
              actionable: abs.actionable,
              fixDescription: fixDesc,
              fixLink: abs.actionable ? getFixLink(abs.signal, data) : null,
              tooltipText: tooltip,
              isDrag: false,
            });
          }
        }
      } else {
        const isGood = ded.severity === "good" || ded.severity === "info";
        if (isGood && ded.deduction === 0) continue;

        const isDrag = SCORE_DRAG_SIGNALS.includes(ded.signal);
        const isNonActionable = NON_ACTIONABLE_SIGNALS.includes(ded.signal);
        const reg = SIGNAL_REGISTRY[ded.signal];
        const fixDesc = FIX_DESC_MAP[ded.signal.toLowerCase().replace(/[^a-z0-9_]/g, "_")] || undefined;
        const tooltip = getTooltipText(ded.signal, "issue");

        signals.push({
          signal: ded.signal,
          label: ded.label,
          severity: ded.severity,
          deduction: ded.deduction,
          weight: ded.weight,
          share: ded.share,
          tier: "issue",
          effort: reg?.effort,
          actionable: !isDrag && !isNonActionable,
          fixDescription: fixDesc,
          fixLink: !isDrag && !isNonActionable ? getFixLink(ded.signal, data) : null,
          tooltipText: tooltip,
          isDrag,
        });
      }
    }

    // Sort: issues first (by deduction desc), then opportunities, then not_detected
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

  axes.sort((a, b) => b.compositeImpact - a.compositeImpact);
  return axes;
}

// ─── Sub-components ─────────────────────────────────────────────────

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

function EffortBadge({ effort }: { effort?: string }) {
  if (!effort) return null;
  const key = effort.toLowerCase();
  const config = key.includes("quick")
    ? EFFORT_LABELS.quick
    : key.includes("major") || key.includes("🏗")
      ? EFFORT_LABELS.major
      : EFFORT_LABELS.moderate;
  return (
    <span
      style={{
        fontSize: "9px",
        color: "var(--dim)",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {config.icon}
    </span>
  );
}

// ─── Simulate checkbox ──────────────────────────────────────────────

function SimCheckbox({
  checked,
  onChange,
  actionable = true,
}: {
  checked: boolean;
  onChange: () => void;
  actionable?: boolean;
}) {
  // Non-actionable signals get a clock-style circular checkbox to hint "may resolve over time"
  const isTimeBased = !actionable;
  return (
    <Tooltip text={isTimeBased ? "May resolve over time" : "Simulate fixing this"}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onChange();
        }}
        aria-label={checked ? "Uncheck fix simulation" : "Simulate fixing this signal"}
        style={{
          width: "14px",
          height: "14px",
          borderRadius: isTimeBased ? "50%" : "3px",
          border: `1.5px solid ${checked ? "var(--success)" : isTimeBased ? "var(--dim)" : "var(--border)"}`,
          background: checked ? "var(--success)" : "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
          transition: "all 0.15s",
          borderStyle: isTimeBased && !checked ? "dashed" : "solid",
        }}
      >
        {checked && <span style={{ fontSize: "9px", color: "var(--bg)", fontWeight: 700, lineHeight: 1 }}>✓</span>}
        {!checked && isTimeBased && <span style={{ fontSize: "8px", color: "var(--dim)", lineHeight: 1 }}>⏳</span>}
      </button>
    </Tooltip>
  );
}

// ─── Signal row ─────────────────────────────────────────────────────

function SignalRow({
  sig,
  maxDeduction,
  expanded,
  onToggle,
  simulateMode,
  isChecked,
  onSimToggle,
}: {
  sig: WaterfallSignal;
  maxDeduction: number;
  expanded: boolean;
  onToggle: () => void;
  simulateMode: boolean;
  isChecked: boolean;
  onSimToggle: () => void;
}) {
  const hasDetail = sig.fixDescription || sig.fixLink || sig.tooltipText;
  const canSimulate = simulateMode && sig.deduction > 0;

  return (
    <div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: role conditionally set via hasDetail flag */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-expanded is paired with role=button when hasDetail */}
      <div
        role={hasDetail ? "button" : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        onClick={hasDetail ? onToggle : undefined}
        onKeyDown={
          hasDetail
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle();
                }
              }
            : undefined
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "3px 4px",
          borderRadius: "3px",
          minHeight: "22px",
          cursor: hasDetail ? "pointer" : "default",
          background: expanded ? "rgba(255,255,255,0.03)" : "transparent",
          transition: "background 0.1s",
        }}
      >
        {canSimulate && <SimCheckbox checked={isChecked} onChange={onSimToggle} actionable={sig.actionable} />}

        <SeverityMarker severity={sig.severity} tier={sig.tier} />
        <span
          style={{
            fontSize: "11px",
            color: sig.isDrag ? "var(--dim)" : sig.tier === "not_detected" ? "var(--dim)" : "var(--text-secondary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textDecoration: isChecked ? "line-through" : "none",
            opacity: isChecked ? 0.5 : 1,
          }}
          title={sig.label}
        >
          {sig.label}
          {sig.isDrag && (
            <span style={{ fontSize: "9px", color: "var(--dim)", marginLeft: "4px", opacity: 0.7 }}>
              (non-actionable)
            </span>
          )}
        </span>

        {sig.tooltipText && (
          <Tooltip text={sig.tooltipText}>
            <HelpCircle size={10} style={{ color: "var(--dim)", opacity: 0.4, flexShrink: 0 }} />
          </Tooltip>
        )}

        <EffortBadge effort={sig.effort} />

        {sig.tier === "issue" && sig.severity !== "good" && sig.severity !== "info" && !sig.isDrag && (
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

      {/* Expanded detail row */}
      {expanded && hasDetail && (
        <div
          style={{
            padding: "4px 4px 6px 20px",
            fontSize: "11px",
            color: "var(--muted)",
            lineHeight: 1.5,
            borderLeft: "2px solid var(--border)",
            marginLeft: "3px",
            marginBottom: "2px",
          }}
        >
          {sig.fixDescription && <div style={{ marginBottom: sig.fixLink ? "4px" : 0 }}>{sig.fixDescription}</div>}
          {sig.fixLink && (
            <a
              href={sig.fixLink.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "10px",
                color: "var(--accent)",
                textDecoration: "none",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {sig.fixLink.label} <ExternalLink size={9} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composite Formula Display ──────────────────────────────────────

function CompositeFormula({
  axisScores,
  simulatedScores,
  simulateActive,
  imputedAxes,
}: {
  axisScores: Record<string, number>;
  simulatedScores: Record<string, number> | null;
  simulateActive: boolean;
  imputedAxes?: Set<string>;
}) {
  const orderedAxes = Object.keys(AXIS_WEIGHTS) as Axis[];
  const currentComposite = clientComposite(axisScores);
  const simComposite = simulatedScores ? clientComposite(simulatedScores) : currentComposite;
  const compositeChanged = simulateActive && simulatedScores && simComposite !== currentComposite;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "3px",
        flexWrap: "wrap",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        lineHeight: 2,
        padding: "6px 0",
        justifyContent: "center",
      }}
    >
      {orderedAxes.map((axis, i) => {
        const currentScore = axisScores[axis] ?? 0;
        const simScore = simulatedScores?.[axis] ?? currentScore;
        const displayScore = simulateActive && simulatedScores ? simScore : currentScore;
        const changed = simulateActive && simulatedScores && simScore !== currentScore;
        const isImputed = imputedAxes?.has(axis) ?? false;
        const axisColor = AXIS_COLORS[axis] || "var(--muted)";
        const weightPct = Math.round((AXIS_WEIGHTS[axis] ?? 0) * 100);

        return (
          <span key={axis} style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
            {i > 0 && <span style={{ color: "var(--dim)", margin: "0 1px", fontSize: "10px" }}>+</span>}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "2px",
                padding: "1px 5px",
                borderRadius: "4px",
                border: `1px ${isImputed ? "dashed" : "solid"} ${changed ? "rgba(126,231,135,0.3)" : `${axisColor}${isImputed ? "20" : "30"}`}`,
                background: changed ? "rgba(126,231,135,0.08)" : "transparent",
                opacity: isImputed ? 0.55 : 1,
                transition: "all 0.2s",
              }}
              title={isImputed ? "Not assessed — imputed at 35 for composite calculation" : undefined}
            >
              <span style={{ fontWeight: 700, color: axisColor, fontSize: "11px" }}>{displayScore}</span>
              <span style={{ color: "var(--dim)", fontSize: "10px" }}>×.{weightPct.toString().padStart(2, "0")}</span>
            </span>
          </span>
        );
      })}
      <span style={{ color: "var(--dim)", margin: "0 2px", fontSize: "11px" }}>=</span>
      <span
        style={{
          fontWeight: 800,
          fontSize: "14px",
          color: compositeChanged ? "var(--success)" : "var(--text)",
          transition: "color 0.2s",
        }}
      >
        {compositeChanged ? simComposite : currentComposite}
      </span>
      {compositeChanged && (
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--success)", marginLeft: "4px" }}>
          (+{simComposite - currentComposite})
        </span>
      )}
    </div>
  );
}

// ─── Axis abbreviation labels ───────────────────────────────────────

function FormulaAxisLabels() {
  const orderedAxes = Object.keys(AXIS_WEIGHTS) as Axis[];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "3px",
        flexWrap: "wrap",
        fontSize: "8px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        padding: "0 0 4px",
        justifyContent: "center",
        marginTop: "-6px",
      }}
    >
      {orderedAxes.map((axis, i) => {
        const axisColor = AXIS_COLORS[axis] || "var(--dim)";
        return (
          <span key={axis} style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
            {i > 0 && <span style={{ visibility: "hidden", margin: "0 1px" }}>+</span>}
            <span
              style={{
                padding: "1px 5px",
                border: "1px solid transparent",
                color: axisColor,
                textAlign: "center",
                minWidth: "44px",
              }}
            >
              {AXIS_ABBR[axis] || axis.substring(0, 3).toUpperCase()}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ─── Tier Progress Bar ──────────────────────────────────────────────

function TierProgressBar({
  currentScore,
  simulatedScore,
  showSimulated,
}: {
  currentScore: number;
  simulatedScore: number;
  showSimulated: boolean;
}) {
  const compositeChanged = showSimulated && simulatedScore !== currentScore;

  return (
    <div style={{ position: "relative", margin: "4px 8px 10px" }}>
      <div
        style={{
          display: "flex",
          height: "5px",
          borderRadius: "3px",
          overflow: "hidden",
          background: "var(--border)",
        }}
      >
        {TIER_DEFS.map((t) => (
          <div
            key={t.tier}
            style={{
              width: `${t.max - t.min}%`,
              height: "100%",
              background: t.color,
              opacity: 0.25,
            }}
          />
        ))}
      </div>
      {/* Current marker */}
      <div
        style={{
          position: "absolute",
          top: "-4px",
          left: `${currentScore}%`,
          width: "2px",
          height: "13px",
          borderRadius: "1px",
          background: "var(--text)",
          transition: "left 0.3s ease",
          zIndex: 2,
        }}
      />
      {/* Simulated marker */}
      {compositeChanged && (
        <div
          style={{
            position: "absolute",
            top: "-4px",
            left: `${simulatedScore}%`,
            width: "2px",
            height: "13px",
            borderRadius: "1px",
            background: "var(--success)",
            boxShadow: "0 0 6px var(--success)",
            transition: "left 0.3s ease",
            zIndex: 3,
          }}
        />
      )}
      {/* Tier labels */}
      <div
        style={{
          display: "flex",
          position: "relative",
          height: "14px",
          marginTop: "2px",
          fontSize: "8px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--dim)",
        }}
      >
        <span style={{ position: "absolute", left: 0 }}>Critical</span>
        <span style={{ position: "absolute", left: "40%", transform: "translateX(-50%)" }}>Weak</span>
        <span style={{ position: "absolute", left: "60%", transform: "translateX(-50%)" }}>Moderate</span>
        <span style={{ position: "absolute", left: "78%", transform: "translateX(-50%)" }}>Strong</span>
        <span style={{ position: "absolute", right: 0 }}>Excellent</span>
      </div>
    </div>
  );
}

// ─── Simulate Mode Toggle ───────────────────────────────────────────

function SimulateToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "5px 12px",
        borderRadius: "16px",
        border: `1.5px solid ${active ? "var(--success)" : "var(--accent)"}`,
        background: active ? "rgba(126,231,135,0.10)" : "rgba(88,166,255,0.06)",
        cursor: "pointer",
        fontSize: "11px",
        color: active ? "var(--success)" : "var(--accent)",
        fontFamily: "var(--font-ui)",
        fontWeight: 600,
        transition: "all 0.2s",
        whiteSpace: "nowrap",
        boxShadow: active ? "0 0 8px rgba(126,231,135,0.15)" : "0 0 6px rgba(88,166,255,0.1)",
        letterSpacing: "0.01em",
      }}
    >
      <span style={{ fontSize: "13px", lineHeight: 1 }}>{active ? "✓" : "✦"}</span>
      <span>{active ? "Simulating" : "What if?"}</span>
    </button>
  );
}

// ─── Simulate Summary Banner ────────────────────────────────────────

function SimulateSummary({
  count,
  currentComposite,
  simComposite,
  currentTier,
  simTier,
}: {
  count: number;
  currentComposite: number;
  simComposite: number;
  currentTier: string;
  simTier: string;
}) {
  if (count === 0) return null;
  return (
    <div
      style={{
        marginTop: "10px",
        padding: "10px 12px",
        background: "rgba(126,231,135,0.06)",
        border: "1px solid rgba(126,231,135,0.2)",
        borderRadius: "8px",
        fontSize: "11px",
        color: "var(--success)",
        fontWeight: 600,
      }}
    >
      Simulating {count} fix{count !== 1 ? "es" : ""}: {currentComposite} → {simComposite} (+
      {simComposite - currentComposite} pts)
      {simTier !== currentTier && (
        <span>
          {" "}
          · Would reach <strong>{simTier}</strong>
        </span>
      )}
    </div>
  );
}

// ─── Report Issue Widget ────────────────────────────────────────────

const ISSUE_CATEGORIES = [
  {
    id: "false_detection",
    label: "Detection is incorrect",
    description: "A signal was reported that doesn't match my site's actual configuration",
    ghLabel: "bug",
    ghTitle: "False detection",
  },
  {
    id: "deprecated_signal",
    label: "Signal is outdated or irrelevant",
    description: "This check no longer applies or the standard has changed",
    ghLabel: "signal-review",
    ghTitle: "Signal review request",
  },
  {
    id: "other",
    label: "Something else",
    description: "General feedback, question, or suggestion about the scoring",
    ghLabel: "feedback",
    ghTitle: "Scoring feedback",
  },
];

function ProbeBlockedBanner({ siteUnreachable }: { siteUnreachable: boolean }) {
  // Count how many signals require HTTP access
  const suppressed = Object.values(SIGNAL_REGISTRY).filter((s) => s.requiresHttpAccess && s.canBeGood).length;

  const title = siteUnreachable ? "Site unreachable — limited analysis" : "HTTP probe blocked — limited analysis";
  const description = siteUnreachable
    ? `DNS resolves but the site didn't respond to HTTP requests. ${suppressed} signals that require page access were excluded from scoring to avoid unfair penalties.`
    : `This site's bot protection blocked our automated probe. ${suppressed} signals that require page access were excluded from scoring to avoid unfair penalties.`;

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        padding: "10px 12px",
        margin: "8px 0 4px",
        borderRadius: "8px",
        background: "var(--warning-bg, rgba(234, 179, 8, 0.06))",
        border: "1px solid var(--warning-border, rgba(234, 179, 8, 0.2))",
        fontSize: "11px",
        lineHeight: 1.5,
        color: "var(--muted)",
      }}
    >
      <span style={{ flexShrink: 0, fontSize: "13px" }} aria-hidden="true">
        ⚠
      </span>
      <div>
        <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: "2px" }}>{title}</div>
        <div>
          {description} Scores reflect only DNS, SSL, WHOIS, and email authentication data.{" "}
          <a
            href="/docs#faq"
            style={{ color: "var(--accent)", textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            Learn more →
          </a>
        </div>
      </div>
    </div>
  );
}

function ReportIssueWidget({ domain }: { domain: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const handleReport = useCallback(() => {
    const category = ISSUE_CATEGORIES.find((c) => c.id === selected);
    if (!category) return;

    const params = new URLSearchParams({
      title: `[${category.ghTitle}] ${domain}`,
      labels: category.ghLabel,
      body: `**Domain:** ${domain}\n**Category:** ${category.label}\n**URL:** https://yoke.lol/?d=${domain}\n\n**Description:**\n<!-- Describe the issue. If reporting a false detection, please specify which signal and provide evidence. -->\n\n`,
    });

    window.open(`${GITHUB_ISSUES_URL}?${params.toString()}`, "_blank");
  }, [domain, selected]);

  return (
    <div
      style={{
        marginTop: "16px",
        paddingTop: "12px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 0",
          color: "var(--dim)",
          fontSize: "10px",
          fontFamily: "var(--font-ui)",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--muted)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
      >
        <MessageSquare size={11} />
        <span>See something wrong? Report an issue</span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div
          style={{
            marginTop: "8px",
            padding: "12px",
            background: "rgba(255,255,255,0.02)",
            borderRadius: "8px",
            border: "1px solid var(--border)",
          }}
        >
          <p
            style={{
              fontSize: "11px",
              color: "var(--muted)",
              margin: "0 0 10px 0",
              lineHeight: 1.5,
            }}
          >
            If our detection doesn't match your site's actual configuration, let us know. Reports are filed as GitHub
            issues on our{" "}
            <a
              href="https://github.com/yokedotlol/yoke"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", textDecoration: "none" }}
            >
              open-source repo
            </a>
            .
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
            {ISSUE_CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat.id}
                onClick={() => setSelected(selected === cat.id ? null : cat.id)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: `1px solid ${selected === cat.id ? "var(--accent)" : "var(--border)"}`,
                  background: selected === cat.id ? "rgba(88,166,255,0.06)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-ui)",
                  transition: "all 0.15s",
                }}
              >
                <span
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    border: `2px solid ${selected === cat.id ? "var(--accent)" : "var(--border)"}`,
                    background: selected === cat.id ? "var(--accent)" : "transparent",
                    flexShrink: 0,
                    marginTop: "1px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                >
                  {selected === cat.id && (
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--bg)" }} />
                  )}
                </span>
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)" }}>{cat.label}</div>
                  <div style={{ fontSize: "10px", color: "var(--dim)", marginTop: "1px" }}>{cat.description}</div>
                </div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleReport}
            disabled={!selected}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              width: "100%",
              padding: "8px",
              borderRadius: "6px",
              border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
              background: selected ? "rgba(88,166,255,0.1)" : "transparent",
              color: selected ? "var(--accent)" : "var(--dim)",
              cursor: selected ? "pointer" : "default",
              fontSize: "11px",
              fontWeight: 600,
              fontFamily: "var(--font-ui)",
              transition: "all 0.15s",
              opacity: selected ? 1 : 0.5,
            }}
          >
            <ExternalLink size={11} />
            Open issue on GitHub
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function ScoreWaterfall({ data }: { data: AnalysisResult }) {
  const waterfallAxes = useMemo(() => buildWaterfallData(data), [data]);
  const [expandedAxes, setExpandedAxes] = useState<Set<string>>(() => {
    if (waterfallAxes.length > 0) return new Set([waterfallAxes[0].axis]);
    return new Set<string>();
  });
  const [expandedSignals, setExpandedSignals] = useState<Set<string>>(new Set());
  const [expandedNotAssessed, setExpandedNotAssessed] = useState<Set<string>>(new Set());
  const [simulateMode, setSimulateMode] = useState(false);
  const [checkedSignals, setCheckedSignals] = useState<Set<string>>(new Set());

  const score = data.domain_score;
  if (!score) return null;

  const currentComposite = score.composite;
  const currentTier = score.tier;

  // Build axis scores map for formula
  const axisScores = useMemo(() => {
    const scores: Record<string, number> = {};
    for (const axis of Object.keys(AXIS_WEIGHTS) as Axis[]) {
      const ad = score.axes[axis];
      // Mirror backend NULL_AXIS_IMPUTE: null/not_measured axes use 35
      scores[axis] = ad?.score ?? (ad?.not_measured ? NULL_AXIS_IMPUTE : 0);
    }
    return scores;
  }, [score.axes]);

  // Track which axes are imputed (null/not_measured) for visual distinction
  const imputedAxes = useMemo(() => {
    const set = new Set<string>();
    for (const axis of Object.keys(AXIS_WEIGHTS) as Axis[]) {
      const ad = score.axes[axis];
      if (ad?.not_measured || ad?.score == null) set.add(axis);
    }
    return set;
  }, [score.axes]);

  // Simulated scores — add back deductions for checked signals
  const simulatedAxisScores = useMemo(() => {
    if (!simulateMode || checkedSignals.size === 0) return null;
    const simScores: Record<string, number> = { ...axisScores };
    for (const wa of waterfallAxes) {
      let recovered = 0;
      for (const sig of wa.signals) {
        if (checkedSignals.has(`${wa.axis}-${sig.signal}`) && sig.deduction > 0) {
          recovered += sig.deduction;
        }
      }
      if (recovered > 0) {
        simScores[wa.axis] = Math.min(100, (simScores[wa.axis] ?? 0) + recovered);
      }
    }
    return simScores;
  }, [simulateMode, checkedSignals, waterfallAxes, axisScores]);

  const simComposite = simulatedAxisScores ? clientComposite(simulatedAxisScores) : currentComposite;
  const simTier = getTierName(simComposite);
  const simulateActive = simulateMode && checkedSignals.size > 0;

  const toggleAxis = (axis: string) => {
    setExpandedAxes((prev) => {
      const next = new Set(prev);
      if (next.has(axis)) next.delete(axis);
      else next.add(axis);
      return next;
    });
  };

  const toggleSignal = (signalKey: string) => {
    setExpandedSignals((prev) => {
      const next = new Set(prev);
      if (next.has(signalKey)) next.delete(signalKey);
      else next.add(signalKey);
      return next;
    });
  };

  const toggleNotAssessed = (axis: string) => {
    setExpandedNotAssessed((prev) => {
      const next = new Set(prev);
      if (next.has(axis)) next.delete(axis);
      else next.add(axis);
      return next;
    });
  };

  const toggleSimSignal = (signalKey: string) => {
    setCheckedSignals((prev) => {
      const next = new Set(prev);
      if (next.has(signalKey)) next.delete(signalKey);
      else next.add(signalKey);
      return next;
    });
  };

  const toggleSimMode = () => {
    setSimulateMode((prev) => {
      if (prev) setCheckedSignals(new Set()); // clear selections when turning off
      return !prev;
    });
  };

  // Perfect axes
  const perfectAxes = (Object.keys(AXIS_WEIGHTS) as Axis[]).filter((a) => {
    const ad = score.axes[a];
    return ad && !ad.not_measured && ad.score === 100;
  });

  // Empty state
  if (waterfallAxes.length === 0 && perfectAxes.length > 0) {
    return (
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>Score Breakdown</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "12px 0",
            fontSize: "13px",
            color: "var(--success)",
          }}
        >
          ✓ Perfect score — no deductions across any axis.
        </div>
      </div>
    );
  }

  if (waterfallAxes.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "16px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "4px",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text)",
          }}
        >
          Score Breakdown
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "10px", color: "var(--dim)" }}>
            {currentComposite}/100 · {currentTier}
            {simulateActive && simComposite !== currentComposite && (
              <span style={{ color: "var(--success)", fontWeight: 600 }}>
                {" "}
                → {simComposite} · {simTier}
              </span>
            )}
          </span>
          <SimulateToggle active={simulateMode} onToggle={toggleSimMode} />
        </div>
      </div>

      <div
        style={{
          fontSize: "10px",
          color: "var(--dim)",
          marginBottom: "4px",
          lineHeight: 1.4,
        }}
      >
        Deductions from 100 for each axis, weighted into the composite score.
      </div>

      {/* Composite formula */}
      <CompositeFormula
        axisScores={axisScores}
        simulatedScores={simulatedAxisScores}
        simulateActive={simulateActive}
        imputedAxes={imputedAxes}
      />
      <FormulaAxisLabels />

      {/* Tier progress bar */}
      <TierProgressBar currentScore={currentComposite} simulatedScore={simComposite} showSimulated={simulateActive} />

      {/* Probe failure banner */}
      {data.http_probe_blocked && <ProbeBlockedBanner siteUnreachable={data.status?.is_up === false} />}

      {/* Axis sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {waterfallAxes.map((wa) => {
          const isExpanded = expandedAxes.has(wa.axis);
          const issueCount = wa.signals.filter((s) => s.tier === "issue").length;
          const oppCount = wa.signals.filter((s) => s.tier === "opportunity").length;
          const ndCount = wa.signals.filter((s) => s.tier === "not_detected").length;
          const maxDeduction = Math.max(...wa.signals.map((s) => s.deduction), 1);

          // Compute simulated axis score
          const simAxisScore = simulatedAxisScores?.[wa.axis] ?? wa.score;
          const axisScoreChanged = simulateActive && simAxisScore !== wa.score;

          return (
            <div key={wa.axis}>
              {/* Axis header */}
              <button
                type="button"
                onClick={() => toggleAxis(wa.axis)}
                aria-expanded={isExpanded}
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
                  fontFamily: "var(--font-ui)",
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
                    minWidth: "52px",
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {wa.score}
                  {axisScoreChanged && (
                    <span
                      style={{
                        color: "var(--success)",
                        fontSize: "10px",
                        fontWeight: 600,
                        marginLeft: "4px",
                      }}
                    >
                      → {Math.round(simAxisScore)}
                    </span>
                  )}
                </span>

                {/* Progress bar with ghost */}
                <div
                  style={{
                    flex: 1,
                    height: "4px",
                    borderRadius: "2px",
                    background: "var(--border)",
                    overflow: "visible",
                    maxWidth: "120px",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: "2px",
                      background: AXIS_COLORS[wa.axis] || "var(--muted)",
                      width: `${wa.score}%`,
                      opacity: 0.5,
                      position: "absolute",
                      top: 0,
                      left: 0,
                    }}
                  />
                  {axisScoreChanged && (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "2px",
                        background: AXIS_COLORS[wa.axis] || "var(--muted)",
                        opacity: 0.2,
                        position: "absolute",
                        top: 0,
                        left: `${wa.score}%`,
                        width: `${Math.round(simAxisScore) - wa.score}%`,
                        borderRight: `2px dashed ${AXIS_COLORS[wa.axis] || "var(--muted)"}`,
                        transition: "width 0.3s ease",
                      }}
                    />
                  )}
                </div>

                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--dim)",
                    minWidth: "60px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  −{wa.compositeImpact.toFixed(1)} composite
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: "var(--dim)",
                    opacity: 0.5,
                    marginLeft: "2px",
                  }}
                >
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
                        .map((sig) => {
                          const key = `${wa.axis}-${sig.signal}`;
                          return (
                            <SignalRow
                              key={key}
                              sig={sig}
                              maxDeduction={maxDeduction}
                              expanded={expandedSignals.has(key)}
                              onToggle={() => toggleSignal(key)}
                              simulateMode={simulateMode}
                              isChecked={checkedSignals.has(key)}
                              onSimToggle={() => toggleSimSignal(key)}
                            />
                          );
                        })}
                    </>
                  )}

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
                        Improvements
                      </div>
                      {wa.signals
                        .filter((s) => s.tier === "opportunity")
                        .map((sig) => {
                          const key = `${wa.axis}-${sig.signal}`;
                          return (
                            <SignalRow
                              key={key}
                              sig={sig}
                              maxDeduction={maxDeduction}
                              expanded={expandedSignals.has(key)}
                              onToggle={() => toggleSignal(key)}
                              simulateMode={simulateMode}
                              isChecked={checkedSignals.has(key)}
                              onSimToggle={() => toggleSimSignal(key)}
                            />
                          );
                        })}
                    </>
                  )}

                  {ndCount > 0 &&
                    (() => {
                      const ndSignals = wa.signals.filter((s) => s.tier === "not_detected");
                      const ndTotal = ndSignals.reduce((sum, s) => sum + s.deduction, 0);
                      const naExpanded = expandedNotAssessed.has(wa.axis);
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleNotAssessed(wa.axis)}
                            aria-expanded={naExpanded}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              fontSize: "9px",
                              fontWeight: 600,
                              color: "var(--dim)",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              padding: "4px 0 2px",
                              marginTop: issueCount > 0 || oppCount > 0 ? "6px" : "2px",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            <span style={{ fontSize: "8px", opacity: 0.6 }}>{naExpanded ? "▾" : "▸"}</span>
                            Not assessed
                            {!naExpanded && (
                              <span style={{ fontWeight: 400, opacity: 0.7 }}>
                                — {ndCount} signal{ndCount !== 1 ? "s" : ""} (−{ndTotal.toFixed(1)})
                              </span>
                            )}
                          </button>
                          {naExpanded &&
                            ndSignals.map((sig) => {
                              const key = `${wa.axis}-${sig.signal}`;
                              return (
                                <SignalRow
                                  key={key}
                                  sig={sig}
                                  maxDeduction={maxDeduction}
                                  expanded={expandedSignals.has(key)}
                                  onToggle={() => toggleSignal(key)}
                                  simulateMode={simulateMode}
                                  isChecked={checkedSignals.has(key)}
                                  onSimToggle={() => toggleSimSignal(key)}
                                />
                              );
                            })}
                        </>
                      );
                    })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Perfect axes summary */}
      {perfectAxes.length > 0 && (
        <div
          style={{
            fontSize: "10px",
            color: "var(--dim)",
            marginTop: "8px",
            paddingLeft: "8px",
          }}
        >
          {perfectAxes.map((a) => AXIS_LABELS[a] || a).join(", ")} — no deductions
        </div>
      )}

      {/* Simulate summary */}
      {simulateActive && (
        <SimulateSummary
          count={checkedSignals.size}
          currentComposite={currentComposite}
          simComposite={simComposite}
          currentTier={currentTier}
          simTier={simTier}
        />
      )}

      {/* Report an issue */}
      <ReportIssueWidget domain={data.domain} />
    </div>
  );
}
