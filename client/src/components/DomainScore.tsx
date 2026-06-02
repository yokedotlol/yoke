import { useCallback, useEffect, useRef, useState } from "react";
import { severityColor, severityIcon, tierColor } from "../utils/severity";
import type { AnalysisResult, ArchetypeName, Axis, AxisScoreData, PercentileData } from "../utils/types";
import { Tooltip } from "./Tooltip";

// ─── Constants ───────────────────────────────────────────────────────

const AXES: Axis[] = ["security", "speed", "foundations", "reputation", "discoverability", "email"];
const AXIS_LABELS: Record<Axis, string> = {
  security: "Security",
  speed: "Speed",
  foundations: "Foundations",
  reputation: "Reputation",
  discoverability: "Discoverability",
  email: "Email",
};

const ARCHETYPE_ICONS: Record<ArchetypeName, string> = {
  commerce: "🛒",
  content: "📝",
  application: "⚙️",
  corporate: "🏢",
  infrastructure: "🔧",
  institutional: "🏛️",
  general: "🌐",
};

const ARCHETYPE_LABELS: Record<ArchetypeName, string> = {
  commerce: "Commerce",
  content: "Content",
  application: "Application",
  corporate: "Corporate",
  infrastructure: "Infrastructure",
  institutional: "Institutional",
  general: "General",
};

// Dynamic weight summary — generated from current weights.
function weightSummary(weightsTable: Record<Axis, number>): string {
  const sorted = [...AXES].sort((a, b) => weightsTable[b] - weightsTable[a]);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const weight = weightsTable[sorted[i]];
    const group = [sorted[i]];
    while (i + 1 < sorted.length && weightsTable[sorted[i + 1]] === weight) {
      i++;
      group.push(sorted[i]);
    }
    const pct = Math.round(weight * 100);
    const names = group.map((a) => AXIS_LABELS[a]).join(" & ");
    parts.push(group.length > 1 ? `${names} (${pct}% each)` : `${names} (${pct}%)`);
    i++;
  }
  return `${parts[0]} weighted highest, then ${parts.slice(1).join(", ")}`;
}

// Fixed axis weights — all archetypes use the same weights now.
// SYNC: must match server AXIS_WEIGHTS in contextual-scoring.ts
const FIXED_WEIGHTS: Record<Axis, number> = {
  security: 0.24,
  speed: 0.18,
  foundations: 0.18,
  reputation: 0.15,
  discoverability: 0.13,
  email: 0.12,
};

// ─── Tier Color for Axis Bars ────────────────────────────────────────
// Uses the same thresholds as the scoring engine for visual consistency

function axisTierColor(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#3b82f6";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#ef4444";
}

const NULL_BAR_BG =
  "repeating-linear-gradient(-45deg, var(--border) 0px, var(--border) 3px, transparent 3px, transparent 6px)";

// ─── Percentile Helpers ──────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function percentileLabel(pctile: number): string {
  if (pctile >= 90) return `Top ${100 - pctile}%`;
  return `${ordinal(pctile)} percentile`;
}

function axisPctileColor(pctile: number): string {
  if (pctile >= 80) return "#818cf8"; // indigo
  if (pctile >= 60) return "#a5b4fc"; // lighter indigo
  if (pctile <= 20) return "#f97316"; // orange
  if (pctile <= 40) return "#f59e0b"; // amber
  return "#94a3b8"; // neutral
}

// ─── Animated Axis Bars ──────────────────────────────────────────────

function AnimatedAxisBars({
  axes,
  animKey,
  percentiles,
}: {
  axes: Record<Axis, AxisScoreData>;
  animKey: number;
  percentiles?: PercentileData | null;
}) {
  const [progress, setProgress] = useState<number[]>(AXES.map(() => 0));
  const [showScores, setShowScores] = useState<boolean[]>(AXES.map(() => false));
  const rafRef = useRef<number>(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: animKey is intentionally used to trigger animation replay
  useEffect(() => {
    setProgress(AXES.map(() => 0));
    setShowScores(AXES.map(() => false));

    const startTime = performance.now() + 200; // slight delay after radar starts
    const duration = 700;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      if (elapsed < 0) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const newProgress = AXES.map((_, i) => {
        const stagger = i * 80;
        const axisElapsed = elapsed - stagger;
        if (axisElapsed <= 0) return 0;
        const t = Math.min(axisElapsed / duration, 1);
        return 1 - (1 - t) ** 3; // ease-out cubic
      });

      setProgress(newProgress);

      // Show score labels after bar finishes
      const newShowScores = AXES.map((_, i) => {
        const stagger = i * 80;
        return elapsed - stagger > duration * 0.6;
      });
      setShowScores(newShowScores);

      if (elapsed < duration + AXES.length * 80) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setProgress(AXES.map(() => 1));
        setShowScores(AXES.map(() => true));
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animKey]);

  return (
    <div className="space-y-1.5">
      {AXES.map((axis, i) => {
        const a = axes[axis];
        const nm = a.not_measured || a.score == null;
        const barProgress = progress[i] ?? 0;
        const scoreVisible = showScores[i] ?? false;
        const fillWidth = nm ? barProgress * 100 : barProgress * (a.score ?? 0);

        return (
          // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role conditionally set via nm flag
          <div
            key={axis}
            className="flex items-center gap-2"
            style={{ fontSize: "11px", opacity: nm ? 0.5 : 1 }}
            role={nm ? undefined : "meter"}
            aria-valuenow={nm ? undefined : (a.score ?? 0)}
            aria-valuemin={nm ? undefined : 0}
            aria-valuemax={nm ? undefined : 100}
            aria-label={nm ? `${AXIS_LABELS[axis]}: Not Assessed` : `${AXIS_LABELS[axis]}: ${a.score} out of 100`}
          >
            <span
              style={{
                fontFamily: "var(--font-ui)",
                color: "var(--dim)",
                width: 90,
                flexShrink: 0,
                fontWeight: 500,
                textAlign: "right",
                textTransform: "uppercase",
                fontSize: "10px",
                letterSpacing: "0.04em",
              }}
            >
              {AXIS_LABELS[axis]}
            </span>
            <div
              className="flex-1 rounded"
              style={{
                height: 14,
                background: "var(--bg)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                className="rounded"
                style={{
                  height: "100%",
                  width: `${fillWidth}%`,
                  background: nm ? NULL_BAR_BG : axisTierColor(a.score ?? 0),
                }}
              />
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                color: "var(--text)",
                minWidth: 28,
                textAlign: "right",
                fontSize: "11px",
                opacity: scoreVisible ? 1 : 0,
                transition: "opacity 0.3s ease-out",
              }}
            >
              {nm ? "N/A" : a.score}
            </span>
            {/* Per-axis percentile pip */}
            {percentiles && !nm && percentiles.axes[axis] != null && (
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "9px",
                  fontWeight: 500,
                  color: axisPctileColor(percentiles.axes[axis] as number),
                  minWidth: 44,
                  textAlign: "right",
                  opacity: scoreVisible ? 1 : 0,
                  transition: "opacity 0.3s ease-out",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {(percentiles.axes[axis] as number) >= 50 ? "▲" : "▼"} {ordinal(percentiles.axes[axis] as number)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Radar Plot SVG ──────────────────────────────────────────────────

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 75;
const ANGLE_OFFSET = -Math.PI / 2; // start from top

function polarToCartesian(angle: number, r: number): [number, number] {
  return [CENTER + r * Math.cos(angle + ANGLE_OFFSET), CENTER + r * Math.sin(angle + ANGLE_OFFSET)];
}

function polygonPoints(values: number[], maxVal = 100): string {
  return values
    .map((v, i) => {
      const angle = (2 * Math.PI * i) / values.length;
      const r = (v / maxVal) * RADIUS;
      const [x, y] = polarToCartesian(angle, r);
      return `${x},${y}`;
    })
    .join(" ");
}

function gridPolygon(level: number): string {
  const r = (level / 100) * RADIUS;
  return AXES.map((_, i) => {
    const angle = (2 * Math.PI * i) / AXES.length;
    const [x, y] = polarToCartesian(angle, r);
    return `${x},${y}`;
  }).join(" ");
}

/** Compute edge stroke opacity from raw axis score (0–100) */
function radarEdgeOpacity(score: number): number {
  return 0.15 + (Math.max(score - 25, 0) / 75) * 0.55;
}

interface RadarPlotProps {
  axes: Record<Axis, AxisScoreData>;
  archetype: ArchetypeName;
  weightsTable?: Record<Axis, number>;
}

export function RadarPlot({ axes, archetype, weightsTable }: RadarPlotProps) {
  const weights = weightsTable ?? FIXED_WEIGHTS;
  const [animProgress, setAnimProgress] = useState(0);
  const [hoveredAxis, setHoveredAxis] = useState<Axis | null>(null);
  const [isLight, setIsLight] = useState(() => {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "light" || theme === "newsprint" || theme === "botanical" || theme === "rose";
  });
  const rafRef = useRef<number>(0);
  const uidRef = useRef(`rp-${Math.random().toString(36).slice(2, 8)}`);
  const uid = uidRef.current;

  // React to theme changes
  useEffect(() => {
    const check = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      setIsLight(theme === "light" || theme === "newsprint" || theme === "botanical" || theme === "rose");
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const start = performance.now();
    const duration = 600;
    const animate = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - (1 - t) ** 3;
      setAnimProgress(eased);
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // biome-ignore lint/style/noNonNullAssertion: null-checked via ternary guard
  const values = AXES.map((a) => (axes[a].not_measured || axes[a].score == null ? 0 : axes[a].score! * animProgress));
  // biome-ignore lint/style/noNonNullAssertion: null-checked via ternary guard
  const rawScores = AXES.map((a) => (axes[a].not_measured || axes[a].score == null ? 0 : axes[a].score!));
  const dataPoints = polygonPoints(values);

  // Animated vertex positions for edge gradients
  const vertices = AXES.map((_, i) => {
    const angle = (2 * Math.PI * i) / AXES.length;
    const r = (values[i] / 100) * RADIUS;
    return polarToCartesian(angle, r);
  });

  // Gradient parameters — theme-aware
  const coreColor = isLight ? "var(--bg)" : "#ffffff";
  const coreOpacity = isLight ? 0.6 : 0.1;
  const edgeSaturation = isLight ? 0.7 : 0.85;

  return (
    <div className="relative" style={{ width: "100%", maxWidth: SIZE, aspectRatio: "1/1" }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ overflow: "visible" }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Radar chart showing domain scores: ${AXES.map((a) => `${AXIS_LABELS[a]} ${axes[a].not_measured || axes[a].score == null ? "not assessed" : axes[a].score}`).join(", ")}`}
      >
        <defs>
          {/* Radial gradient: white/bg center → saturated accent edge */}
          <radialGradient id={`${uid}-rg`} gradientUnits="userSpaceOnUse" cx={CENTER} cy={CENTER} r={RADIUS}>
            <stop offset="0%" stopColor={coreColor} stopOpacity={coreOpacity} />
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.04} />
            <stop offset="12%" stopColor="var(--accent)" stopOpacity={0.08} />
            <stop offset="25%" stopColor="var(--accent)" stopOpacity={0.15} />
            <stop offset="40%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="55%" stopColor="var(--accent)" stopOpacity={0.38} />
            <stop offset="70%" stopColor="var(--accent)" stopOpacity={0.52} />
            <stop offset="85%" stopColor="var(--accent)" stopOpacity={0.68} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={edgeSaturation} />
          </radialGradient>

          {/* Clip path to data polygon */}
          <clipPath id={`${uid}-clip`}>
            <polygon points={dataPoints} />
          </clipPath>

          {/* Subtle glow filter for grid lines */}
          <filter id={`${uid}-gg`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="0.8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Edge glow filter */}
          <filter id={`${uid}-egl`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>

          {/* Per-edge linear gradients (stroke + glow) */}
          {AXES.map((_, i) => {
            const j = (i + 1) % AXES.length;
            const [x0, y0] = vertices[i];
            const [x1, y1] = vertices[j];
            const op0 = radarEdgeOpacity(rawScores[i]);
            const op1 = radarEdgeOpacity(rawScores[j]);
            return (
              <g key={`eg-defs-${i}`}>
                <linearGradient id={`${uid}-eg-${i}`} gradientUnits="userSpaceOnUse" x1={x0} y1={y0} x2={x1} y2={y1}>
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={op0} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={op1} />
                </linearGradient>
                <linearGradient id={`${uid}-eglg-${i}`} gradientUnits="userSpaceOnUse" x1={x0} y1={y0} x2={x1} y2={y1}>
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={op0 * 0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={op1 * 0.35} />
                </linearGradient>
              </g>
            );
          })}
        </defs>

        {/* Grid lines — accent-tinted with subtle glow */}
        {[25, 50, 75, 100].map((level) => {
          const op = level === 100 ? 0.22 : level === 75 ? 0.14 : level === 50 ? 0.09 : 0.05;
          return (
            <polygon
              key={level}
              points={gridPolygon(level)}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={level === 100 ? 0.7 : 0.4}
              opacity={op}
              filter={`url(#${uid}-gg)`}
            />
          );
        })}

        {/* Spoke lines — accent-tinted */}
        {AXES.map((_, i) => {
          const angle = (2 * Math.PI * i) / AXES.length;
          const [x, y] = polarToCartesian(angle, RADIUS);
          return (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER}
              x2={x}
              y2={y}
              stroke="var(--accent)"
              strokeWidth={0.4}
              opacity={0.12}
            />
          );
        })}

        {/* Data fill — radial gradient circle clipped to data polygon */}
        <g clipPath={`url(#${uid}-clip)`}>
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${uid}-rg)`} />
        </g>

        {/* Edge glow — blurred wider strokes behind the crisp edges */}
        {AXES.map((_, i) => {
          const j = (i + 1) % AXES.length;
          const [x0, y0] = vertices[i];
          const [x1, y1] = vertices[j];
          return (
            <line
              key={`glow-${i}`}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={`url(#${uid}-eglg-${i})`}
              strokeWidth={5}
              strokeLinecap="round"
              filter={`url(#${uid}-egl)`}
            />
          );
        })}

        {/* Edge strokes — per-segment gradient */}
        {AXES.map((_, i) => {
          const j = (i + 1) % AXES.length;
          const [x0, y0] = vertices[i];
          const [x1, y1] = vertices[j];
          return (
            <line
              key={`edge-${i}`}
              x1={x0}
              y1={y0}
              x2={x1}
              y2={y1}
              stroke={`url(#${uid}-eg-${i})`}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}

        {/* Center dot */}
        <circle cx={CENTER} cy={CENTER} r={1.5} fill={coreColor} opacity={coreOpacity * 0.8} />

        {/* Axis labels */}
        {AXES.map((axis, i) => {
          const angle = (2 * Math.PI * i) / AXES.length;
          const labelR = RADIUS + 20;
          const [x, y] = polarToCartesian(angle, labelR);
          const score = axes[axis].score;
          const notMeasured = axes[axis].not_measured || score == null;
          const isHovered = hoveredAxis === axis;

          // Position-aware text anchoring and offsets
          // 0=top, 1=top-right, 2=bottom-right, 3=bottom, 4=bottom-left, 5=top-left
          const anchor = i === 0 || i === 3 ? "middle" : i === 1 || i === 2 ? "start" : "end";
          const labelDy = i === 0 ? -5 : i === 3 ? 1 : -5;
          const scoreDy = i === 0 ? 7 : i === 3 ? 13 : 7;

          return (
            <g key={axis}>
              {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG text labels with hover behavior */}
              <text
                x={x}
                y={y + labelDy}
                textAnchor={anchor}
                dominantBaseline="central"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "9px",
                  fontWeight: isHovered ? 600 : 500,
                  fill: notMeasured ? "var(--dim)" : isHovered ? "var(--accent)" : "var(--dim)",
                  cursor: "default",
                  transition: "fill 0.15s",
                  opacity: notMeasured ? 0.5 : 0.8,
                }}
                onMouseEnter={() => setHoveredAxis(axis)}
                onMouseLeave={() => setHoveredAxis(null)}
              >
                {AXIS_LABELS[axis]}
              </text>
              {/* Score under label — opacity scales with axis score */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: SVG text labels with hover behavior */}
              <text
                x={x}
                y={y + scoreDy}
                textAnchor={anchor}
                dominantBaseline="central"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "9px",
                  fontWeight: 600,
                  fill: notMeasured ? "var(--dim)" : "var(--accent)",
                  opacity: notMeasured ? 0.4 : isHovered ? 1 : radarEdgeOpacity(rawScores[i]),
                  fontStyle: notMeasured ? "italic" : "normal",
                }}
                onMouseEnter={() => setHoveredAxis(axis)}
                onMouseLeave={() => setHoveredAxis(null)}
              >
                {notMeasured ? "N/A" : score}
              </text>
            </g>
          );
        })}

        {/* Invisible hover zones for each spoke */}
        {AXES.map((axis, i) => {
          const angle = (2 * Math.PI * i) / AXES.length;
          const [x, y] = polarToCartesian(angle, RADIUS * 0.6);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG hover zone
            <circle
              key={`zone-${axis}`}
              cx={x}
              cy={y}
              r={22}
              fill="transparent"
              onMouseEnter={() => setHoveredAxis(axis)}
              onMouseLeave={() => setHoveredAxis(null)}
              style={{ cursor: "default" }}
            />
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hoveredAxis && (
        <div
          className="absolute z-10 p-2 rounded-md"
          style={{
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            fontSize: "11px",
            fontFamily: "var(--font-ui)",
            left: "50%",
            bottom: -8,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          <span style={{ fontWeight: 600, color: "var(--text)" }}>
            {AXIS_LABELS[hoveredAxis]}:{" "}
            {axes[hoveredAxis].not_measured ? "Not Assessed" : `${axes[hoveredAxis].score}/100`}
          </span>
          {!axes[hoveredAxis].not_measured && (
            <span style={{ color: "var(--dim)", marginLeft: 6 }}>
              ({Math.round(weights[hoveredAxis] * 100)}% weight)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composite Score Display ─────────────────────────────────────────
// tierColor, severityColor, severityIcon imported from ../utils/severity

function scoreColor(score: number): string {
  if (score >= 90) return "var(--success)";
  if (score >= 80) return "#7ee787";
  if (score >= 70) return "var(--warning)";
  if (score >= 60) return "#ffa198";
  return "var(--danger)";
}

// ─── Main DomainScore Component ──────────────────────────────────────

export function DomainScore({ data }: { data: AnalysisResult }) {
  const ds = data.domain_score;
  const [animKey, setAnimKey] = useState(0);
  const replay = useCallback(() => setAnimKey((k) => k + 1), []);
  if (!ds) return null;

  // Always use the detected archetype — manual override removed after calibration
  const activeArchetype = ds.archetype.detected;

  // Resolve weights: prefer API response, fall back to hardcoded
  const weightsTable = ds.archetype.weights ?? FIXED_WEIGHTS;
  const { composite, tier } = { composite: ds.composite, tier: ds.tier };

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="opacity-60" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </span>
          <h3
            style={{
              fontSize: "inherit",
              fontWeight: "inherit",
              textTransform: "inherit",
              letterSpacing: "inherit",
              color: "inherit",
              margin: 0,
            }}
          >
            Domain Score
          </h3>
        </div>
        {/* Archetype chip */}
        <div className="flex items-center gap-2">
          <Tooltip text={ds.archetype.signals.join(", ")}>
            <span
              className="badge badge-info"
              style={{
                fontSize: "10px",
                cursor: "help",
              }}
            >
              {ARCHETYPE_ICONS[activeArchetype]} {ARCHETYPE_LABELS[activeArchetype]}
            </span>
          </Tooltip>
        </div>
      </div>

      <div className="p-4">
        <div className="flex flex-col lg:flex-row items-center gap-6">
          {/* Radar Plot */}
          <div className="flex-shrink-0 w-full max-w-[200px]">
            <RadarPlot axes={ds.axes} archetype={activeArchetype} weightsTable={weightsTable} />
          </div>

          {/* Score + Details */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* Big score */}
            <div className="flex items-center gap-4">
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "42px",
                    fontWeight: 700,
                    lineHeight: "1",
                    color: scoreColor(composite),
                  }}
                >
                  {composite}
                </div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--dim)", marginTop: 2 }}>
                  out of 100
                </div>
              </div>
              <div
                style={{
                  minWidth: 48,
                  height: 48,
                  padding: "0 12px",
                  borderRadius: "var(--radius)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: tier.length > 6 ? "14px" : "18px",
                  fontWeight: 700,
                  color: tierColor(tier),
                  background: `color-mix(in srgb, ${tierColor(tier)} 10%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${tierColor(tier)} 20%, transparent)`,
                }}
              >
                {tier}
              </div>
            </div>

            {/* Composite percentile badge */}
            {data.percentiles && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 12px",
                  borderRadius: "16px",
                  fontFamily: "var(--font-ui)",
                  fontSize: "11px",
                  fontWeight: 600,
                  background: "color-mix(in srgb, var(--accent) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--accent) 18%, transparent)",
                  color: "var(--accent)",
                }}
              >
                📊 {percentileLabel(data.percentiles.composite)} of scanned domains
              </div>
            )}

            {/* Weight summary */}
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--dim)", lineHeight: "18px" }}>
              {weightSummary(weightsTable)}
            </p>

            {/* Animated axis breakdown bars */}
            <AnimatedAxisBars axes={ds.axes} animKey={animKey} percentiles={data.percentiles} />

            {/* Replay button */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: "0.75rem" }}>
              <button
                type="button"
                onClick={replay}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  background: "var(--surface)",
                  color: "var(--dim)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "0.3rem 0.75rem",
                  fontFamily: "var(--font-ui)",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.borderColor = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--dim)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.6 2.2A7 7 0 0 1 15 8a7 7 0 0 1-14 0h2a5 5 0 1 0 1.73-3.79L7 6.5H1V.5l2.6 1.7z" />
                </svg>
                Replay
              </button>
            </div>

            {/* Secondary archetype note */}
            {ds.archetype.secondary && (
              <p style={{ fontFamily: "var(--font-ui)", fontSize: "10px", color: "var(--dim)" }}>
                Also shows {ARCHETYPE_LABELS[ds.archetype.secondary]} traits
              </p>
            )}
          </div>
        </div>

        {/* Percentile context */}
        {data.percentiles && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "8px 12px",
              borderRadius: "8px",
              background: "color-mix(in srgb, var(--accent) 4%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent) 10%, transparent)",
              fontFamily: "var(--font-ui)",
              fontSize: "11px",
              color: "var(--dim)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: "13px" }}>📊</span>
            <span>
              Percentiles based on{" "}
              <strong style={{ color: "var(--text)" }}>{data.percentiles.sample_size.toLocaleString()}</strong> unique
              domains scanned
            </span>
          </div>
        )}

        {/* Top findings */}
        <TopFindings axes={ds.axes} />
      </div>
    </div>
  );
}

// ─── Top Findings Summary ────────────────────────────────────────────
// severityColor and severityIcon imported from ../utils/severity

function TopFindings({ axes }: { axes: Record<Axis, AxisScoreData> }) {
  // Collect non-good findings across all axes, sorted by severity
  const severityOrder = ["critical", "high", "medium", "low", "info", "good"];
  const allFindings = AXES.flatMap((a) => axes[a].findings)
    .filter((f) => f.severity !== "good")
    .sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity))
    .slice(0, 6);

  if (allFindings.length === 0) return null;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        <h3
          style={{
            fontSize: "inherit",
            fontWeight: "inherit",
            textTransform: "inherit",
            letterSpacing: "inherit",
            color: "inherit",
            margin: 0,
          }}
        >
          Key Findings
        </h3>
      </div>
      <div className="space-y-1">
        {allFindings.map((f, i) => (
          <div
            key={`${f.signal}-${i}`}
            className="flex items-start gap-2"
            style={{ fontSize: "11px", lineHeight: "16px" }}
          >
            <span style={{ fontSize: "10px", flexShrink: 0, marginTop: 1 }}>{severityIcon(f.severity)}</span>
            <span style={{ fontFamily: "var(--font-ui)", color: severityColor(f.severity) }}>
              {f.label}
              {f.source && <Tooltip text={f.source} help />}
              {f.tradeoff && (
                <span style={{ color: "var(--dim)", fontSize: "10px", marginLeft: 4 }}>— {f.tradeoff}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab Axis Score Badge ────────────────────────────────────────────
// Shows the relevant axis score at the top of each tab

export function AxisScoreBadge({ data, axis }: { data: AnalysisResult; axis: Axis }) {
  const ds = data.domain_score;
  if (!ds) return null;

  const axisData = ds.axes[axis];
  if (axisData.not_measured || axisData.score == null) {
    return (
      <div className="flex items-center gap-2 px-1 mb-2">
        <div className="vital-pill" style={{ padding: "4px 10px", opacity: 0.5 }}>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--dim)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {AXIS_LABELS[axis]}
          </span>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "11px", fontStyle: "italic", color: "var(--dim)" }}>
            Not Assessed
          </span>
        </div>
      </div>
    );
  }

  const score = axisData.score;
  const color = score >= 80 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--danger)";

  return (
    <div className="flex items-center gap-2 px-1 mb-2">
      <div className="vital-pill" style={{ padding: "4px 10px" }}>
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "10px",
            fontWeight: 600,
            color: "var(--dim)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {AXIS_LABELS[axis]}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color }}>{score}</span>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "10px", color: "var(--dim)" }}>/100</span>
      </div>
    </div>
  );
}
