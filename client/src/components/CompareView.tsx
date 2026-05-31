import { ArrowLeftRight, CheckCircle2, Circle, Link2, Loader2, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeStream, type StreamEvent } from "../api";
import type {
  AnalysisResult,
  ArchetypeName,
  Axis,
  AxisScoreData,
  CompareResult,
  DomainScoreData,
} from "../utils/types";

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

const ARCHETYPE_ICONS: Record<string, string> = {
  commerce: "🛒",
  content: "📝",
  application: "⚙️",
  corporate: "🏢",
  infrastructure: "🔧",
  institutional: "🏛️",
  general: "🌐",
};

const ARCHETYPE_LABELS: Record<string, string> = {
  commerce: "Commerce",
  content: "Content",
  application: "Application",
  corporate: "Corporate",
  infrastructure: "Infrastructure",
  institutional: "Institutional",
  general: "General",
};

// ─── Streaming Compare Hook ──────────────────────────────────────────

interface DomainProgress {
  completed: number;
  total: number;
  label: string;
  checks: Map<string, { label: string; done: boolean }>;
  done: boolean;
}

function emptyProgress(): DomainProgress {
  return { completed: 0, total: 0, label: "Waiting…", checks: new Map(), done: false };
}

function buildCompareResult(d1: AnalysisResult, d2: AnalysisResult): CompareResult {
  const score1 = d1.domain_score as DomainScoreData | undefined;
  const score2 = d2.domain_score as DomainScoreData | undefined;

  const axes: CompareResult["comparison"]["axes"] = AXES.map((axis) => {
    const s1 = score1?.axes?.[axis]?.score ?? null;
    const s2 = score2?.axes?.[axis]?.score ?? null;
    const delta = (s1 ?? 0) - (s2 ?? 0);
    return { axis, score1: s1, score2: s2, delta, absDelta: Math.abs(delta) };
  });

  return {
    domain1: d1,
    domain2: d2,
    comparison: {
      composite: {
        score1: score1?.composite ?? null,
        score2: score2?.composite ?? null,
        tier1: score1?.tier ?? null,
        tier2: score2?.tier ?? null,
        delta: (score1?.composite ?? 0) - (score2?.composite ?? 0),
      },
      archetype1: (score1?.archetype?.detected as ArchetypeName) ?? null,
      archetype2: (score2?.archetype?.detected as ArchetypeName) ?? null,
      axes,
      biggest_differences: [...axes].sort((a, b) => b.absDelta - a.absDelta).slice(0, 3),
    },
  };
}

function useStreamingCompare() {
  const [data, setData] = useState<CompareResult | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress1, setProgress1] = useState<DomainProgress>(emptyProgress());
  const [progress2, setProgress2] = useState<DomainProgress>(emptyProgress());
  const [dom1, setDom1] = useState("");
  const [dom2, setDom2] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Abort in-flight SSE streams on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const mutate = useCallback(({ domain1, domain2 }: { domain1: string; domain2: string }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const d1 = domain1
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");
    const d2 = domain2
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");
    setDom1(d1);
    setDom2(d2);
    setIsPending(true);
    setError(null);
    setData(null);
    setProgress1({ ...emptyProgress(), label: "Connecting…" });
    setProgress2({ ...emptyProgress(), label: "Connecting…" });

    let result1: AnalysisResult | null = null;
    let result2: AnalysisResult | null = null;

    const checkBothDone = () => {
      if (result1 && result2) {
        setData(buildCompareResult(result1, result2));
        setIsPending(false);
      }
    };

    const makeHandler =
      (setProgress: typeof setProgress1, setResult: (r: AnalysisResult) => void) => (evt: StreamEvent) => {
        if (controller.signal.aborted) return;
        switch (evt.type) {
          case "phase": {
            const d = evt.data as {
              phase: string;
              label: string;
              total?: number;
              checks?: Array<{ key: string; label: string }>;
            };
            setProgress((prev) => {
              const checks = new Map(prev.checks);
              if (d.phase === "phase2" && d.checks) {
                for (const c of d.checks) {
                  if (!checks.has(c.key)) {
                    checks.set(c.key, { label: c.label, done: false });
                  }
                }
              }
              return { ...prev, label: d.label, total: d.total ?? prev.total, checks };
            });
            break;
          }
          case "result": {
            const d = evt.data as { key: string; label?: string; completed?: number; total?: number };
            setProgress((prev) => {
              const checks = new Map(prev.checks);
              if (d.label && d.key) checks.set(d.key, { label: d.label, done: true });
              const completed = d.completed ?? prev.completed;
              const total = d.total ?? prev.total;
              return { ...prev, completed, total, checks, label: `${completed} of ${total} checks` };
            });
            break;
          }
          case "done": {
            const result = evt.data as AnalysisResult;
            setResult(result);
            setProgress((prev) => ({ ...prev, done: true, label: "Done" }));
            break;
          }
          case "error": {
            const d = evt.data as { message: string };
            setError(new Error(d.message));
            setIsPending(false);
            break;
          }
        }
      };

    const handler1 = makeHandler(setProgress1, (r) => {
      result1 = r;
      checkBothDone();
    });
    const handler2 = makeHandler(setProgress2, (r) => {
      result2 = r;
      checkBothDone();
    });

    Promise.all([analyzeStream(d1, handler1, controller.signal), analyzeStream(d2, handler2, controller.signal)]).catch(
      (err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsPending(false);
      },
    );
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setData(null);
    setIsPending(false);
    setError(null);
    setProgress1(emptyProgress());
    setProgress2(emptyProgress());
  }, []);

  return { data, isPending, error, progress1, progress2, dom1, dom2, mutate, reset };
}

// ─── Compare Progress UI ─────────────────────────────────────────────

function CompareProgress({ domain, progress }: { domain: string; progress: DomainProgress }) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const sortedChecks = Array.from(progress.checks.entries());

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {progress.done ? (
            <CheckCircle2 size={13} style={{ color: "var(--success)", flexShrink: 0 }} />
          ) : (
            <Loader2 size={13} className="animate-spin" style={{ color: "var(--accent)", flexShrink: 0 }} />
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              fontWeight: 600,
              color: progress.done ? "var(--success)" : "var(--text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {domain}
          </span>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--dim)", flexShrink: 0 }}>
          {progress.done ? "✓" : progress.total > 0 ? `${progress.completed}/${progress.total}` : "…"}
        </span>
      </div>
      <div className="w-full h-1 rounded-full" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: progress.done ? "100%" : `${pct}%`,
            background: progress.done ? "var(--success)" : "var(--accent)",
            transition: "width 0.3s ease, background 0.3s ease",
          }}
        />
      </div>
      {sortedChecks.length > 0 && (
        <div
          className="mt-2"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "2px 8px" }}
        >
          {sortedChecks.map(([key, { label, done }]) => (
            <div key={key} className="flex items-center gap-1" style={{ opacity: done ? 1 : 0.4 }}>
              {done ? (
                <CheckCircle2 size={9} style={{ color: "var(--success)", flexShrink: 0 }} />
              ) : (
                <Circle size={9} style={{ color: "var(--dim)", flexShrink: 0 }} />
              )}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "9px",
                  color: done ? "var(--text)" : "var(--dim)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Comparison Radar Plot ───────────────────────────────────────────

const SIZE = 260;
const CENTER = SIZE / 2;
const RADIUS = 90;
const ANGLE_OFFSET = -Math.PI / 2;

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

interface CompareRadarProps {
  axes1: Record<Axis, AxisScoreData>;
  axes2: Record<Axis, AxisScoreData>;
  domain1: string;
  domain2: string;
}

function CompareRadar({ axes1, axes2, domain1, domain2 }: CompareRadarProps) {
  const [animProgress, setAnimProgress] = useState(0);
  const [hoveredAxis, setHoveredAxis] = useState<Axis | null>(null);
  const [isLight, setIsLight] = useState(() => {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "light" || theme === "newsprint" || theme === "botanical" || theme === "rose";
  });
  const rafRef = useRef<number>(0);
  const uidRef = useRef(`cr-${Math.random().toString(36).slice(2, 8)}`);
  const crUid = uidRef.current;

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
    const duration = 700;
    const animate = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - t) ** 3;
      setAnimProgress(eased);
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const vals1 = AXES.map((a) => (axes1[a].score ?? 0) * animProgress);
  const vals2 = AXES.map((a) => (axes2[a].score ?? 0) * animProgress);
  const rawScores1 = AXES.map((a) => axes1[a].score ?? 0);
  const rawScores2 = AXES.map((a) => axes2[a].score ?? 0);

  // Animated vertex positions for edge gradients
  const vertices1 = AXES.map((_, i) => {
    const angle = (2 * Math.PI * i) / AXES.length;
    const r = (vals1[i] / 100) * RADIUS;
    return polarToCartesian(angle, r);
  });
  const vertices2 = AXES.map((_, i) => {
    const angle = (2 * Math.PI * i) / AXES.length;
    const r = (vals2[i] / 100) * RADIUS;
    return polarToCartesian(angle, r);
  });

  // Gradient parameters — theme-aware
  const coreColor = isLight ? "var(--bg)" : "#ffffff";
  const coreOpacity = isLight ? 0.6 : 0.1;
  const edgeSaturation = isLight ? 0.7 : 0.85;
  const d2Color = "#f97316";

  return (
    <div className="compare-radar-container">
      {/* Legend */}
      <div
        className="flex items-center justify-center gap-4 mb-2"
        style={{ fontSize: "11px", fontFamily: "var(--font-ui)" }}
      >
        <span className="flex items-center gap-1.5">
          <span
            style={{ width: 12, height: 3, background: "var(--accent)", display: "inline-block", borderRadius: 2 }}
          />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{domain1}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            style={{
              width: 12,
              height: 3,
              background: d2Color,
              display: "inline-block",
              borderRadius: 2,
              backgroundImage:
                "repeating-linear-gradient(90deg, transparent, transparent 4px, var(--bg) 4px, var(--bg) 6px)",
            }}
          />
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{domain2}</span>
        </span>
      </div>

      <div className="relative mx-auto" style={{ width: "100%", maxWidth: SIZE, aspectRatio: "1/1" }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ overflow: "visible" }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Grid glow filter */}
            <filter id={`${crUid}-gg`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="0.8" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* ── Domain 1 (accent) gradient defs ── */}
            <radialGradient id={`${crUid}-rg1`} gradientUnits="userSpaceOnUse" cx={CENTER} cy={CENTER} r={RADIUS}>
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
            <clipPath id={`${crUid}-clip1`}>
              <polygon points={polygonPoints(vals1)} />
            </clipPath>
            <filter id={`${crUid}-egl1`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>

            {/* Per-edge linear gradients for Domain 1 (stroke + glow) */}
            {AXES.map((_, i) => {
              const j = (i + 1) % AXES.length;
              const [x0, y0] = vertices1[i];
              const [x1, y1] = vertices1[j];
              const op0 = radarEdgeOpacity(rawScores1[i]);
              const op1 = radarEdgeOpacity(rawScores1[j]);
              return (
                <g key={`d1-eg-defs-${i}`}>
                  <linearGradient
                    id={`${crUid}-eg1-${i}`}
                    gradientUnits="userSpaceOnUse"
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                  >
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={op0} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={op1} />
                  </linearGradient>
                  <linearGradient
                    id={`${crUid}-eglg1-${i}`}
                    gradientUnits="userSpaceOnUse"
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                  >
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={op0 * 0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={op1 * 0.35} />
                  </linearGradient>
                </g>
              );
            })}

            {/* ── Domain 2 (orange) gradient defs ── */}
            <radialGradient id={`${crUid}-rg2`} gradientUnits="userSpaceOnUse" cx={CENTER} cy={CENTER} r={RADIUS}>
              <stop offset="0%" stopColor={coreColor} stopOpacity={coreOpacity * 0.6} />
              <stop offset="5%" stopColor={d2Color} stopOpacity={0.03} />
              <stop offset="12%" stopColor={d2Color} stopOpacity={0.06} />
              <stop offset="25%" stopColor={d2Color} stopOpacity={0.1} />
              <stop offset="40%" stopColor={d2Color} stopOpacity={0.18} />
              <stop offset="55%" stopColor={d2Color} stopOpacity={0.28} />
              <stop offset="70%" stopColor={d2Color} stopOpacity={0.38} />
              <stop offset="85%" stopColor={d2Color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={d2Color} stopOpacity={edgeSaturation * 0.7} />
            </radialGradient>
            <clipPath id={`${crUid}-clip2`}>
              <polygon points={polygonPoints(vals2)} />
            </clipPath>
            <filter id={`${crUid}-egl2`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" />
            </filter>

            {/* Per-edge linear gradients for Domain 2 (stroke + glow) */}
            {AXES.map((_, i) => {
              const j = (i + 1) % AXES.length;
              const [x0, y0] = vertices2[i];
              const [x1, y1] = vertices2[j];
              const op0 = radarEdgeOpacity(rawScores2[i]);
              const op1 = radarEdgeOpacity(rawScores2[j]);
              return (
                <g key={`d2-eg-defs-${i}`}>
                  <linearGradient
                    id={`${crUid}-eg2-${i}`}
                    gradientUnits="userSpaceOnUse"
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                  >
                    <stop offset="0%" stopColor={d2Color} stopOpacity={op0 * 0.9} />
                    <stop offset="100%" stopColor={d2Color} stopOpacity={op1 * 0.9} />
                  </linearGradient>
                  <linearGradient
                    id={`${crUid}-eglg2-${i}`}
                    gradientUnits="userSpaceOnUse"
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                  >
                    <stop offset="0%" stopColor={d2Color} stopOpacity={op0 * 0.25} />
                    <stop offset="100%" stopColor={d2Color} stopOpacity={op1 * 0.25} />
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
                filter={`url(#${crUid}-gg)`}
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

          {/* ── Domain 1: radial gradient fill clipped to data polygon ── */}
          <g clipPath={`url(#${crUid}-clip1)`}>
            <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${crUid}-rg1)`} />
          </g>

          {/* Domain 1: edge glow — blurred wider strokes behind crisp edges */}
          {AXES.map((_, i) => {
            const j = (i + 1) % AXES.length;
            const [x0, y0] = vertices1[i];
            const [x1, y1] = vertices1[j];
            return (
              <line
                key={`glow1-${i}`}
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={`url(#${crUid}-eglg1-${i})`}
                strokeWidth={5}
                strokeLinecap="round"
                filter={`url(#${crUid}-egl1)`}
              />
            );
          })}

          {/* Domain 1: edge strokes — per-segment gradient */}
          {AXES.map((_, i) => {
            const j = (i + 1) % AXES.length;
            const [x0, y0] = vertices1[i];
            const [x1, y1] = vertices1[j];
            return (
              <line
                key={`edge1-${i}`}
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={`url(#${crUid}-eg1-${i})`}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            );
          })}

          {/* ── Domain 2: radial gradient fill clipped to data polygon ── */}
          <g clipPath={`url(#${crUid}-clip2)`}>
            <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${crUid}-rg2)`} />
          </g>

          {/* Domain 2: edge glow — lighter than domain 1 */}
          {AXES.map((_, i) => {
            const j = (i + 1) % AXES.length;
            const [x0, y0] = vertices2[i];
            const [x1, y1] = vertices2[j];
            return (
              <line
                key={`glow2-${i}`}
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={`url(#${crUid}-eglg2-${i})`}
                strokeWidth={4}
                strokeLinecap="round"
                filter={`url(#${crUid}-egl2)`}
              />
            );
          })}

          {/* Domain 2: edge strokes — dashed, per-segment gradient */}
          {AXES.map((_, i) => {
            const j = (i + 1) % AXES.length;
            const [x0, y0] = vertices2[i];
            const [x1, y1] = vertices2[j];
            return (
              <line
                key={`edge2-${i}`}
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke={`url(#${crUid}-eg2-${i})`}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeDasharray="6 3"
              />
            );
          })}

          {/* Center dot */}
          <circle cx={CENTER} cy={CENTER} r={1.5} fill={coreColor} opacity={coreOpacity * 0.8} />

          {/* Axis labels with scores */}
          {AXES.map((axis, i) => {
            const angle = (2 * Math.PI * i) / AXES.length;
            const labelR = RADIUS + 22;
            const [x, y] = polarToCartesian(angle, labelR);
            const isHovered = hoveredAxis === axis;
            return (
              <g key={axis}>
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "10px",
                    fontWeight: isHovered ? 600 : 500,
                    fill: isHovered ? "var(--text)" : "var(--dim)",
                    cursor: "default",
                    transition: "fill 0.15s",
                  }}
                  onMouseEnter={() => setHoveredAxis(axis)}
                  onMouseLeave={() => setHoveredAxis(null)}
                >
                  {AXIS_LABELS[axis]}
                </text>
                {/* Score pair under label */}
                <text
                  x={x}
                  y={y + 12}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    fontWeight: 600,
                    opacity: isHovered ? 1 : 0.6,
                  }}
                >
                  <tspan fill="var(--accent)">{rawScores1[i]}</tspan>
                  <tspan fill="var(--dim)"> / </tspan>
                  <tspan fill={d2Color}>{rawScores2[i]}</tspan>
                </text>
              </g>
            );
          })}

          {/* Hover zones */}
          {AXES.map((axis, i) => {
            const angle = (2 * Math.PI * i) / AXES.length;
            const [x, y] = polarToCartesian(angle, RADIUS * 0.6);
            return (
              <circle
                key={`zone-${axis}`}
                cx={x}
                cy={y}
                r={26}
                fill="transparent"
                style={{ cursor: "default" }}
                onMouseEnter={() => setHoveredAxis(axis)}
                onMouseLeave={() => setHoveredAxis(null)}
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
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>{axes1[hoveredAxis].score ?? "N/A"}</span>
            <span style={{ color: "var(--dim)", margin: "0 4px" }}>vs</span>
            <span style={{ color: d2Color, fontWeight: 600 }}>{axes2[hoveredAxis].score ?? "N/A"}</span>
            <span style={{ color: "var(--dim)", marginLeft: 6 }}>
              ({(axes1[hoveredAxis].score ?? 0) - (axes2[hoveredAxis].score ?? 0) > 0 ? "+" : ""}
              {(axes1[hoveredAxis].score ?? 0) - (axes2[hoveredAxis].score ?? 0)})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Compare Share Bar ───────────────────────────────────────────────

// ─── Base64url helpers ───────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let b64 = "";
  const len = bytes.length;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    b64 += chars[(triplet >> 18) & 0x3f];
    b64 += chars[(triplet >> 12) & 0x3f];
    b64 += i + 1 < len ? chars[(triplet >> 6) & 0x3f] : "";
    b64 += i + 2 < len ? chars[triplet & 0x3f] : "";
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const SHARE_AXIS_ORDER: Axis[] = ["security", "foundations", "reputation", "speed", "discoverability", "email"];

function buildComparePayload(data: CompareResult): string {
  // Build axis arrays in the canonical share order from comparison axes
  const axisMap1 = new Map(data.comparison.axes.map((a) => [a.axis, a.score1]));
  const axisMap2 = new Map(data.comparison.axes.map((a) => [a.axis, a.score2]));
  const a1 = SHARE_AXIS_ORDER.map((a) => axisMap1.get(a) ?? 0);
  const a2 = SHARE_AXIS_ORDER.map((a) => axisMap2.get(a) ?? 0);
  const obj = {
    d1: data.domain1.domain,
    d2: data.domain2.domain,
    s1: data.comparison.composite.score1 ?? 0,
    s2: data.comparison.composite.score2 ?? 0,
    g1: data.comparison.composite.tier1 ?? "?",
    g2: data.comparison.composite.tier2 ?? "?",
    a1,
    a2,
    t: Math.floor(Date.now() / 1000),
  };
  return base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function getCompareSignedUrl(payload: string, origin: string): Promise<string> {
  const resp = await fetch(`${origin}/api/share-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  if (!resp.ok) throw new Error("Failed to sign compare share payload");
  const result = (await resp.json()) as { signature: string };
  return `${origin}/c/${payload}.${result.signature}`;
}

function CompareShareBar({ data }: { data: CompareResult }) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const signingRef = useRef<Promise<string> | null>(null);

  // Build signed URL on mount / data change
  useEffect(() => {
    const { score1, score2, tier1, tier2 } = data.comparison.composite;
    if (score1 == null || score2 == null || !tier1 || !tier2) return;
    const payload = buildComparePayload(data);
    const promise = getCompareSignedUrl(payload, window.location.origin);
    signingRef.current = promise;
    promise
      .then((url) => {
        if (signingRef.current === promise) setShareUrl(url);
      })
      .catch(() => {
        // Fallback to plain compare URL
        if (signingRef.current === promise) {
          setShareUrl(`${window.location.origin}/compare/${data.domain1.domain}/${data.domain2.domain}`);
        }
      });
  }, [data]);

  const currentUrl = shareUrl ?? `${window.location.origin}/compare/${data.domain1.domain}/${data.domain2.domain}`;
  const shareText = `${data.domain1.domain} vs ${data.domain2.domain} — Domain Intelligence Comparison`;

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = currentUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [currentUrl]);

  const shareToX = useCallback(() => {
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(currentUrl)}`,
      "_blank",
      "noopener,noreferrer,width=550,height=420",
    );
  }, [currentUrl, shareText]);

  const shareToLinkedIn = useCallback(() => {
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(currentUrl)}`,
      "_blank",
      "noopener,noreferrer,width=600,height=500",
    );
  }, [currentUrl]);

  const shareToReddit = useCallback(() => {
    window.open(
      `https://reddit.com/submit?url=${encodeURIComponent(currentUrl)}&title=${encodeURIComponent(shareText)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [currentUrl, shareText]);

  const nativeShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareText, text: shareText, url: currentUrl });
      } catch {
        /* cancelled */
      }
    }
  }, [currentUrl, shareText]);

  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className="share-bar">
      <button type="button" className="share-btn share-copy" onClick={copyLink} title="Copy permalink">
        <Link2 size={12} />
        <span>{copied ? "Copied!" : "Copy link"}</span>
      </button>
      <button type="button" className="share-btn" onClick={shareToX} title="Share on X">
        <CmpXIcon />
        <span className="share-label-wide">Share</span>
      </button>
      <button type="button" className="share-btn" onClick={shareToLinkedIn} title="Share on LinkedIn">
        <CmpLinkedInIcon />
        <span className="share-label-wide">Share</span>
      </button>
      <button type="button" className="share-btn" onClick={shareToReddit} title="Share on Reddit">
        <CmpRedditIcon />
        <span className="share-label-wide">Share</span>
      </button>
      {hasNativeShare && (
        <button type="button" className="share-btn" onClick={nativeShare} title="Share">
          <Share2 size={12} />
        </button>
      )}
    </div>
  );
}

/* Tiny inline SVG icons for social platforms (local to avoid circular import) */
function CmpXIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function CmpLinkedInIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function CmpRedditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}

// ─── Score helpers ───────────────────────────────────────────────────

function tierColor(tier: string): string {
  if (tier === "Excellent") return "var(--success)";
  if (tier === "Strong") return "#58a6ff";
  if (tier === "Moderate") return "var(--warning)";
  if (tier === "Weak") return "#ffa198";
  return "var(--danger)";
}

function scoreColor(score: number): string {
  if (score >= 90) return "var(--success)";
  if (score >= 80) return "#7ee787";
  if (score >= 70) return "var(--warning)";
  if (score >= 60) return "#ffa198";
  return "var(--danger)";
}

function deltaDisplay(delta: number): { text: string; color: string } {
  if (delta > 0) return { text: `+${delta}`, color: "var(--success)" };
  if (delta < 0) return { text: `${delta}`, color: "var(--danger)" };
  return { text: "", color: "var(--dim)" };
}

// ─── Compact Score Card ──────────────────────────────────────────────

function ScoreCard({
  domain,
  score,
  tier,
  archetype,
  color,
}: {
  domain: string;
  score: number;
  tier: string;
  archetype: string | null;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div style={{ textAlign: "center", flexShrink: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "32px",
            fontWeight: 700,
            lineHeight: "1",
            color: scoreColor(score),
          }}
        >
          {score}
        </div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "10px", color: "var(--dim)", marginTop: 1 }}>/100</div>
      </div>
      <div
        style={{
          minWidth: 36,
          height: 36,
          padding: "0 8px",
          borderRadius: "var(--radius)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          fontWeight: 700,
          color: tierColor(tier),
          flexShrink: 0,
          background: `color-mix(in srgb, ${tierColor(tier)} 10%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tierColor(tier)} 20%, transparent)`,
        }}
      >
        {tier}
      </div>
      <div className="min-w-0">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            fontWeight: 600,
            color,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {domain}
        </div>
        {archetype && (
          <span className="badge badge-info" style={{ fontSize: "9px", marginTop: 2 }}>
            {ARCHETYPE_ICONS[archetype] ?? "🌐"} {ARCHETYPE_LABELS[archetype] ?? archetype}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Compare View ──────────────────────────────────────────────

export function CompareView({ initialDomain }: { initialDomain?: string }) {
  const [domain1, setDomain1] = useState(initialDomain ?? "");
  const [domain2, setDomain2] = useState("");
  const [_narrow, setNarrow] = useState(false);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 500);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Check URL for compare path
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/compare\/([^/]+)\/([^/]+)$/);
    if (match) {
      setDomain1(match[1]);
      setDomain2(match[2]);
    }
  }, []);

  const compare = useStreamingCompare();

  const doCompare = useCallback(() => {
    const d1 = domain1.trim();
    const d2 = domain2.trim();
    if (!d1 || !d2 || compare.isPending) return;
    compare.mutate({ domain1: d1, domain2: d2 });
  }, [domain1, domain2, compare]);

  // Update URL + title when compare finishes
  useEffect(() => {
    if (compare.data && compare.dom1 && compare.dom2) {
      const comparePath = `/compare/${compare.dom1}/${compare.dom2}`;
      if (window.location.pathname !== comparePath) {
        window.history.pushState(null, "", comparePath);
      }
      document.title = `${compare.dom1} vs ${compare.dom2} — Yoke`;
    }
  }, [compare.data, compare.dom1, compare.dom2]);

  // Auto-trigger if both domains come from URL
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/^\/compare\/([^/]+)\/([^/]+)$/);
    if (match && !compare.data && !compare.isPending) {
      compare.mutate({ domain1: match[1], domain2: match[2] });
    }
  }, [compare.mutate, compare.isPending, compare.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const swap = () => {
    setDomain1(domain2);
    setDomain2(domain1);
  };

  const data = compare.data;
  const ds1 = data?.domain1?.domain_score;
  const ds2 = data?.domain2?.domain_score;

  return (
    <div className="space-y-4">
      {/* Input bar */}
      <div className="panel p-3">
        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <input
            type="text"
            value={domain1}
            onChange={(e) => setDomain1(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doCompare();
            }}
            placeholder="domain1.com"
            className="flex-1 bg-transparent px-3 py-2 rounded-md outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              color: "var(--accent)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
            }}
            disabled={compare.isPending}
          />

          <button
            type="button"
            onClick={swap}
            className="flex items-center justify-center px-2 py-1 rounded-md self-center"
            style={{
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--dim)",
              cursor: "pointer",
              flexShrink: 0,
            }}
            title="Swap domains"
          >
            <ArrowLeftRight size={14} />
          </button>

          <input
            type="text"
            value={domain2}
            onChange={(e) => setDomain2(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doCompare();
            }}
            placeholder="domain2.com"
            className="flex-1 bg-transparent px-3 py-2 rounded-md outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              color: "#f97316",
              border: "1px solid var(--border)",
              background: "var(--surface)",
            }}
            disabled={compare.isPending}
          />

          <button
            type="button"
            onClick={doCompare}
            disabled={compare.isPending || !domain1.trim() || !domain2.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-md transition-all disabled:opacity-30"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
              fontFamily: "var(--font-ui)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: compare.isPending ? "default" : "pointer",
              border: "none",
              flexShrink: 0,
            }}
          >
            {compare.isPending ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeftRight size={14} />}
            {compare.isPending ? "Comparing…" : "Go"}
          </button>
        </div>
      </div>

      {/* Error */}
      {compare.error && (
        <div className="panel p-4 flex items-center gap-3" style={{ borderColor: "var(--danger)" }}>
          <span style={{ color: "var(--danger)", fontFamily: "var(--font-ui)", fontSize: "13px" }}>
            Compare failed: {String(compare.error)}
          </span>
        </div>
      )}

      {/* Streaming progress — dual domain bars */}
      {compare.isPending && (
        <div className="panel p-4 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <ArrowLeftRight size={14} style={{ color: "var(--accent)" }} />
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
              Comparing domains…
            </span>
          </div>
          <div className="flex gap-4" style={{ flexDirection: "row" }}>
            <CompareProgress domain={compare.dom1 || domain1} progress={compare.progress1} />
            <div style={{ width: 1, background: "var(--border)", flexShrink: 0 }} />
            <CompareProgress domain={compare.dom2 || domain2} progress={compare.progress2} />
          </div>
        </div>
      )}

      {/* Results */}
      {data && ds1 && ds2 && !compare.isPending && (
        <div className="space-y-4">
          {/* Score cards side by side */}
          <div className="panel p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
              <ScoreCard
                domain={data.domain1.domain}
                score={ds1.composite}
                tier={ds1.tier}
                archetype={data.comparison.archetype1}
                color="var(--accent)"
              />
              <div className="hidden sm:flex flex-col items-center" style={{ flexShrink: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "14px",
                    fontWeight: 700,
                    color:
                      data.comparison.composite.delta > 0
                        ? "var(--success)"
                        : data.comparison.composite.delta < 0
                          ? "var(--danger)"
                          : "var(--dim)",
                  }}
                >
                  {data.comparison.composite.delta > 0 ? "+" : ""}
                  {data.comparison.composite.delta}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "9px",
                    color: "var(--dim)",
                    textTransform: "uppercase",
                  }}
                >
                  delta
                </div>
              </div>
              <ScoreCard
                domain={data.domain2.domain}
                score={ds2.composite}
                tier={ds2.tier}
                archetype={data.comparison.archetype2}
                color="#f97316"
              />
            </div>
          </div>

          {/* Share bar */}
          <CompareShareBar data={data} />

          {/* Radar plot */}
          <div className="panel p-4">
            <div className="panel-header mb-3" style={{ padding: 0, border: "none" }}>
              <span className="flex items-center gap-2">
                <span className="opacity-60">
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
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>
                  Score Comparison
                </span>
              </span>
            </div>

            <CompareRadar
              axes1={ds1.axes}
              axes2={ds2.axes}
              domain1={data.domain1.domain}
              domain2={data.domain2.domain}
            />
          </div>

          {/* Axis comparison bars */}
          <div className="panel p-4">
            <div
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 10,
              }}
            >
              Per-Axis Breakdown
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.comparison.axes.map((ax) => {
                const d = deltaDisplay(ax.delta);
                const isBigDiff = ax.absDelta >= 15;
                return (
                  <div key={ax.axis} className="flex items-center gap-2" style={{ minHeight: 20 }}>
                    {/* Axis label + delta */}
                    <div
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "11px",
                        fontWeight: 600,
                        color: isBigDiff ? "var(--text)" : "var(--dim)",
                        minWidth: 82,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {AXIS_LABELS[ax.axis]}
                      {isBigDiff && <span style={{ fontSize: "9px", color: "var(--warning)" }}>★</span>}
                      {d.text && (
                        <span
                          style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700, color: d.color }}
                        >
                          {d.text}
                        </span>
                      )}
                    </div>
                    {/* Score 1 */}
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--accent)",
                        fontWeight: 600,
                        fontSize: "11px",
                        minWidth: 22,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {ax.score1 ?? "N/A"}
                    </span>
                    {/* Bars */}
                    <div className="flex-1 relative" style={{ height: 8, borderRadius: 4 }}>
                      <div className="absolute inset-0 rounded" style={{ background: "var(--border)", opacity: 0.5 }} />
                      <div
                        className="absolute top-0 left-0 rounded"
                        style={{
                          height: 4,
                          width: `${ax.score1 ?? 0}%`,
                          background: "var(--accent)",
                          transition: "width 0.6s ease-out",
                        }}
                      />
                      <div
                        className="absolute bottom-0 left-0 rounded"
                        style={{
                          height: 4,
                          width: `${ax.score2 ?? 0}%`,
                          background: "#f97316",
                          transition: "width 0.6s ease-out",
                        }}
                      />
                    </div>
                    {/* Score 2 */}
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "#f97316",
                        fontWeight: 600,
                        fontSize: "11px",
                        minWidth: 22,
                        textAlign: "left",
                        flexShrink: 0,
                      }}
                    >
                      {ax.score2 ?? "N/A"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key differences */}
          <KeyDifferences data={data} />
        </div>
      )}

      {/* No score data */}
      {data && (!ds1 || !ds2) && !compare.isPending && (
        <div className="panel p-4" style={{ textAlign: "center" }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "13px", color: "var(--dim)" }}>
            {!ds1 && `Could not compute score for ${data.domain1.domain}. `}
            {!ds2 && `Could not compute score for ${data.domain2.domain}. `}
            Try different domains.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Key Differences ─────────────────────────────────────────────────

function KeyDifferences({ data }: { data: CompareResult }) {
  const d1 = data.domain1;
  const d2 = data.domain2;

  const diffs: { label: string; domain1: string; domain2: string }[] = [];

  // SSL grade
  if (d1.ssl?.grade !== d2.ssl?.grade) {
    diffs.push({ label: "SSL Grade", domain1: d1.ssl?.grade ?? "N/A", domain2: d2.ssl?.grade ?? "N/A" });
  }

  // Security headers grade
  if (d1.headers?.security_grade !== d2.headers?.security_grade) {
    diffs.push({
      label: "Security Headers",
      domain1: d1.headers?.security_grade ?? "N/A",
      domain2: d2.headers?.security_grade ?? "N/A",
    });
  }

  // HTTP/2 vs HTTP/3
  const h1 = d1.http_protocols;
  const h2 = d2.http_protocols;
  if (h1?.http3 !== h2?.http3) {
    diffs.push({ label: "HTTP/3", domain1: h1?.http3 ? "Yes" : "No", domain2: h2?.http3 ? "Yes" : "No" });
  }

  // DNSSEC
  if (d1.dnssec?.enabled !== d2.dnssec?.enabled) {
    diffs.push({
      label: "DNSSEC",
      domain1: d1.dnssec?.enabled ? "Enabled" : "Off",
      domain2: d2.dnssec?.enabled ? "Enabled" : "Off",
    });
  }

  // CDN
  const cdn1 = d1.hosting?.cdn;
  const cdn2 = d2.hosting?.cdn;
  if (cdn1 !== cdn2) {
    diffs.push({ label: "CDN", domain1: cdn1 ?? "None", domain2: cdn2 ?? "None" });
  }

  // WAF
  const waf1 = d1.waf?.detected ? d1.waf.provider : (d1.hosting?.waf ?? null);
  const waf2 = d2.waf?.detected ? d2.waf.provider : (d2.hosting?.waf ?? null);
  if (waf1 !== waf2) {
    diffs.push({ label: "WAF", domain1: waf1 ?? "None", domain2: waf2 ?? "None" });
  }

  // Performance score
  const ps1 = d1.performance?.score;
  const ps2 = d2.performance?.score;
  if (ps1 != null && ps2 != null && Math.abs(ps1 - ps2) >= 10) {
    diffs.push({ label: "PageSpeed", domain1: `${ps1}/100`, domain2: `${ps2}/100` });
  }

  // DMARC
  const dm1 = d1.email_auth?.dmarc?.policy;
  const dm2 = d2.email_auth?.dmarc?.policy;
  if (dm1 !== dm2) {
    diffs.push({ label: "DMARC Policy", domain1: dm1 ?? "None", domain2: dm2 ?? "None" });
  }

  // Tranco rank
  const tr1 = d1.tranco_rank;
  const tr2 = d2.tranco_rank;
  if ((tr1 ?? 0) !== (tr2 ?? 0)) {
    diffs.push({
      label: "Tranco Rank",
      domain1: tr1 ? `#${tr1.toLocaleString()}` : "Unranked",
      domain2: tr2 ? `#${tr2.toLocaleString()}` : "Unranked",
    });
  }

  // Connection timing
  const ct1 = d1.network_health?.connection_timing;
  const ct2 = d2.network_health?.connection_timing;
  if (ct1 && ct2 && Math.abs(ct1.total_ms - ct2.total_ms) >= 50) {
    diffs.push({
      label: "Connection Time",
      domain1: `${Math.round(ct1.total_ms)}ms`,
      domain2: `${Math.round(ct2.total_ms)}ms`,
    });
  }

  // Routing stability
  const rs1 = d1.network_health?.ripe_routing?.routing_stability;
  const rs2 = d2.network_health?.ripe_routing?.routing_stability;
  if (rs1 && rs2 && rs1 !== rs2) {
    const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    diffs.push({ label: "BGP Stability", domain1: label(rs1), domain2: label(rs2) });
  }

  // DNS consistency
  const dc1 = d1.network_health?.dns_propagation?.consistent;
  const dc2 = d2.network_health?.dns_propagation?.consistent;
  if (dc1 != null && dc2 != null && dc1 !== dc2) {
    diffs.push({
      label: "DNS Consistency",
      domain1: dc1 ? "Consistent" : "Inconsistent",
      domain2: dc2 ? "Consistent" : "Inconsistent",
    });
  }

  if (diffs.length === 0) return null;

  return (
    <div className="panel p-4">
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        Key Differences
      </div>
      <div className="overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", fontFamily: "var(--font-ui)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: "4px 8px 4px 0",
                  color: "var(--dim)",
                  fontWeight: 500,
                  fontSize: "10px",
                }}
              >
                Signal
              </th>
              <th
                style={{
                  textAlign: "center",
                  padding: "4px 8px",
                  color: "var(--accent)",
                  fontWeight: 600,
                  fontSize: "10px",
                }}
              >
                {data.domain1.domain}
              </th>
              <th
                style={{
                  textAlign: "center",
                  padding: "4px 0 4px 8px",
                  color: "#f97316",
                  fontWeight: 600,
                  fontSize: "10px",
                }}
              >
                {data.domain2.domain}
              </th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d, i) => (
              <tr key={d.label} style={{ borderBottom: i < diffs.length - 1 ? "1px solid var(--border)" : "none" }}>
                <td style={{ padding: "5px 8px 5px 0", color: "var(--text)", fontWeight: 500 }}>{d.label}</td>
                <td
                  style={{
                    padding: "5px 8px",
                    textAlign: "center",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                  }}
                >
                  {d.domain1}
                </td>
                <td
                  style={{
                    padding: "5px 0 5px 8px",
                    textAlign: "center",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                  }}
                >
                  {d.domain2}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
