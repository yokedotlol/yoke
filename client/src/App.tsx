import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CheckCircle2, Circle, Loader2, RotateCcw, Search, XCircle, Zap } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { analyzeStream, type RateLimitInfo, type StreamEvent } from "./api";
import AboutPage from "./components/AboutPage";
import CliPage from "./components/CliPage";
import { ApiTeaser, CurlBar } from "./components/CurlShowcase";
import { DomainScore } from "./components/DomainScore";
import { DomainSignals, ExternalTools } from "./components/DomainSignals";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SkeletonPanel } from "./components/Panel";
import { type PanelDef, PanelGrid, ResetLayoutButton } from "./components/PanelLayout";
import { RecentLookups } from "./components/RecentLookups";
import { ScreenshotPanel, TrancoPanel } from "./components/ReputationPanels";
import { ShareBar } from "./components/ShareBar";
// Eagerly loaded components (needed for Overview tab and landing page)
import { TabBar, type TabId } from "./components/TabBar";
import { ThemeToggle } from "./components/ThemeToggle";
import { VitalsStrip } from "./components/VitalsStrip";
import type { AnalysisResult } from "./utils/types";

// Lazy-loaded tab components (code-split into separate chunks)
const CompareView = lazy(() => import("./components/CompareView").then((m) => ({ default: m.CompareView })));
const InfrastructureTab = lazy(() => import("./components/tabs/InfrastructureTab"));
const SecurityTab = lazy(() => import("./components/tabs/SecurityTab"));
const TechTab = lazy(() => import("./components/tabs/TechTab"));
const PerformanceTab = lazy(() => import("./components/tabs/PerformanceTab"));
const EmailTab = lazy(() => import("./components/tabs/EmailTab"));
const BusinessTabWrapper = lazy(() => import("./components/tabs/BusinessTabWrapper"));
const NewsTab = lazy(() => import("./components/NewsTab").then((m) => ({ default: m.NewsTab })));
const ExploreTab = lazy(() => import("./components/ExploreTab").then((m) => ({ default: m.ExploreTab })));
const AIAnalysisPanel = lazy(() =>
  import("./components/AIAnalysisPanel").then((m) => ({ default: m.AIAnalysisPanel })),
);

// Known false-positive e-commerce detections: WooCommerce & Magento pattern-match
// on pages that merely *mention* those names (e.g. Stripe lists them as integrations).
// Filter client-side for now; the server fingerprints will also be tightened.
const FP_ECOMMERCE_NAMES = new Set(["WooCommerce", "Magento"]);
function cleanTechStack(data: AnalysisResult): AnalysisResult {
  if (!data.tech_stack) return data;
  const hasEcommerceHeader = !!(data.headers?.raw?.["x-magento-vary"] || data.headers?.raw?.["x-woo-version"]);
  if (hasEcommerceHeader) return data; // genuine signal
  const cleaned = data.tech_stack.filter((t) => !FP_ECOMMERCE_NAMES.has(t.name));
  return { ...data, tech_stack: cleaned.length > 0 ? cleaned : null };
}

// ─── Streaming Progress Component ──────────────────────────────────
interface ProgressState {
  phase: string;
  label: string;
  completed: number;
  total: number;
  checks: Map<string, { label: string; done: boolean; error?: boolean }>;
  startedAt: number;
}

function PendingChecksCycler({ checks }: { checks: Map<string, { label: string; done: boolean; error?: boolean }> }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const pendingLabels = Array.from(checks.values())
    .filter((c) => !c.done)
    .map((c) => c.label);

  useEffect(() => {
    if (pendingLabels.length === 0) return;
    setIndex(0);
    setVisible(true);
  }, [pendingLabels.length]);

  useEffect(() => {
    if (pendingLabels.length <= 1) return;
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % pendingLabels.length);
        setVisible(true);
      }, 300);
    }, 2000);
    return () => clearInterval(interval);
  }, [pendingLabels.length]);

  if (pendingLabels.length === 0) return null;
  const label = pendingLabels[index % pendingLabels.length] || pendingLabels[0];

  // When PageSpeed is the sole remaining check, add timing hint
  const isPageSpeedAlone = pendingLabels.length === 1 && label === "Google PageSpeed";
  const displayText = isPageSpeedAlone
    ? "Waiting on Google PageSpeed — analysis may take up to 60s…"
    : `Waiting on ${label}…`;

  return (
    <span
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: "11px",
        color: "var(--dim)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      {displayText}
    </span>
  );
}

function StreamingProgress({ progress }: { progress: ProgressState }) {
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  const sortedChecks = Array.from(progress.checks.entries());

  // Elapsed timer — ticks every second
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!progress.startedAt) return;
    setElapsed(Math.floor((Date.now() - progress.startedAt) / 1000));
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - progress.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [progress.startedAt]);

  return (
    <div className="panel p-4 mt-3 space-y-3">
      {/* Header with count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent)" }} />
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>
            {progress.label || "Analyzing…"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <PendingChecksCycler checks={progress.checks} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--dim)" }}>
            {progress.completed}/{progress.total} checks{elapsed > 0 ? ` · ${elapsed}s` : ""}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full" style={{ background: "var(--border)" }}>
        <div
          className={`h-full rounded-full transition-all${pct >= 100 ? " animate-pulse" : ""}`}
          style={{ width: `${pct}%`, background: "var(--accent)", transition: "width 0.3s ease" }}
        />
      </div>

      {/* Check grid */}
      {sortedChecks.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 12px" }}>
          {sortedChecks.map(([key, { label, done, error }]) => (
            <div key={key} className="flex items-center gap-1.5" style={{ opacity: done ? 1 : 0.5 }}>
              {done ? (
                error ? (
                  <XCircle size={11} style={{ color: "var(--danger)", flexShrink: 0 }} />
                ) : (
                  <CheckCircle2 size={11} style={{ color: "var(--success)", flexShrink: 0 }} />
                )
              ) : (
                <Circle size={11} style={{ color: "var(--dim)", flexShrink: 0 }} />
              )}
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "10px",
                  color: done ? (error ? "var(--danger)" : "var(--text)") : "var(--dim)",
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

// ─── Custom Streaming Analysis Hook ─────────────────────────────────
function useStreamingAnalysis() {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [partialData, setPartialData] = useState<Partial<AnalysisResult> | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [progress, setProgress] = useState<ProgressState>({
    phase: "",
    label: "",
    completed: 0,
    total: 0,
    checks: new Map(),
    startedAt: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  // Abort in-flight SSE stream on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const mutate = useCallback((domain: string, options?: { force?: boolean }) => {
    // Abort any in-flight analysis
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsPending(true);
    setError(null);
    setData(null);
    setPartialData({ domain });
    setSessionCount((c) => c + 1);
    setProgress({
      phase: "init",
      label: "Connecting…",
      completed: 0,
      total: 0,
      checks: new Map(),
      startedAt: Date.now(),
    });

    analyzeStream(
      domain,
      (evt: StreamEvent) => {
        if (controller.signal.aborted) return;
        switch (evt.type) {
          case "phase": {
            const d = evt.data as {
              phase: string;
              status: string;
              label: string;
              total?: number;
              checks?: Array<{ key: string; label: string }>;
            };
            setProgress((prev) => {
              const checks = new Map(prev.checks);
              // Populate pending checks when phase2 starts
              if (d.phase === "phase2" && d.checks) {
                for (const c of d.checks) {
                  if (!checks.has(c.key)) {
                    checks.set(c.key, { label: c.label, done: false });
                  }
                }
              }
              return {
                ...prev,
                phase: d.phase,
                label: d.label,
                total: d.total ?? prev.total,
                checks,
              };
            });
            break;
          }
          case "result": {
            const d = evt.data as {
              key: string;
              value: unknown;
              completed?: number;
              total?: number;
              label?: string;
              error?: boolean;
            };
            // Merge into partial data
            if (d.key && !d.key.startsWith("_")) {
              setPartialData((prev) => (prev ? { ...prev, [d.key]: d.value } : { [d.key]: d.value }));
            }
            // Update progress
            setProgress((prev) => {
              const checks = new Map(prev.checks);
              if (d.label && d.key) {
                checks.set(d.key, { label: d.label, done: true, error: !!d.error });
              }
              const completed = d.completed ?? prev.completed;
              const total = d.total ?? prev.total;
              const allDone = total > 0 && completed >= total;
              return {
                ...prev,
                checks,
                completed,
                total,
                label: allDone ? "Calculating score…" : `Analyzing… ${completed} of ${total} checks complete`,
              };
            });
            break;
          }
          case "done": {
            const result = evt.data as AnalysisResult;
            setData(result);
            setPartialData(null);
            setIsPending(false);
            break;
          }
          case "error": {
            const d = evt.data as { message: string };
            setError(new Error(d.message));
            setIsPending(false);
            break;
          }
          case "ratelimit": {
            setRateLimit(evt.data as RateLimitInfo);
            break;
          }
        }
      },
      controller.signal,
      options?.force,
    ).catch((err) => {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsPending(false);
    });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setData(null);
    setPartialData(null);
    setIsPending(false);
    setError(null);
    setProgress({ phase: "", label: "", completed: 0, total: 0, checks: new Map(), startedAt: 0 });
  }, []);

  return { data, partialData, isPending, error, progress, rateLimit, sessionCount, mutate, reset };
}

const sIcon = <div className="w-3.5 h-3.5 rounded" style={{ background: "var(--border)" }} />;

// Check if partial data has enough to render tabs
function hasEnoughForTabs(partial: Partial<AnalysisResult>): boolean {
  // Show tabs as soon as we have DNS (phase 1 result)
  return !!partial.dns;
}

// ─── Tab Content Components ────────────────────────────────────

function OverviewTab({ data, streaming }: { data: AnalysisResult; streaming?: boolean }) {
  // Quick tech stack badges
  const techBadges = (data.tech_stack ?? []).slice(0, 8);

  const quickInfoPanels: PanelDef[] = [
    { id: "screenshot", node: <ScreenshotPanel data={data} /> },
    { id: "tranco", node: <TrancoPanel data={data} /> },
  ];

  return (
    <div className="space-y-3">
      {/* Domain Score — the headline */}
      <DomainScore data={data} />

      {/* Vitals Strip + Hosting badges */}
      <div className="space-y-2">
        <VitalsStrip data={data} />
        {data.hosting && (data.hosting.provider || data.hosting.cdn || data.hosting.waf) && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {data.hosting.provider && (
              <span className="vital-pill">
                <span style={{ color: "var(--accent)", fontWeight: 500 }}>{data.hosting.provider}</span>
              </span>
            )}
            {data.hosting.cdn && (
              <span className="vital-pill">
                <span style={{ color: "var(--success)", fontWeight: 500 }}>CDN: {data.hosting.cdn}</span>
              </span>
            )}
            {data.hosting.waf && (
              <span className="vital-pill">
                <span style={{ color: "var(--success)", fontWeight: 500 }}>WAF: {data.hosting.waf}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Domain Signals — the main event */}
      <DomainSignals data={data} streaming={streaming} />

      {/* Quick info cards */}
      <PanelGrid tabId="overview-quick" panels={quickInfoPanels} />

      {/* Quick tech stack */}
      {techBadges.length > 0 && (
        <div className="panel p-3">
          <div className="flex items-center gap-2 mb-2">
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Tech Stack
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {techBadges.map((t, _i) => (
              <span key={t.name} className="badge badge-info" style={{ fontSize: "11px" }}>
                {t.name}
                {t.version ? ` ${t.version}` : ""}
              </span>
            ))}
            {(data.tech_stack?.length ?? 0) > 8 && (
              <span className="badge badge-neutral" style={{ fontSize: "10px" }}>
                +{(data.tech_stack?.length ?? 0) - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Quick summary cards */}
      {/* External Tools */}
      <ExternalTools data={data} />
    </div>
  );
}

// ─── Main Tab Renderer ─────────────────────────────────────────

// ─── Lazy Tab Loading Fallback ─────────────────────────────────
function TabLoadingFallback() {
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SkeletonPanel title="Loading…" icon={sIcon} rows={5} />
        <SkeletonPanel title="Loading…" icon={sIcon} rows={5} />
      </div>
    </div>
  );
}

function TabContent({ tab, data, streaming }: { tab: TabId; data: AnalysisResult; streaming?: boolean }) {
  // Overview is eagerly loaded — no Suspense needed
  if (tab === "overview") return <OverviewTab data={data} streaming={streaming} />;

  // All other tabs are lazy-loaded
  const lazyContent = (() => {
    switch (tab) {
      case "foundations":
        return <InfrastructureTab data={data} />;
      case "security":
        return <SecurityTab data={data} />;
      case "tech":
        return <TechTab data={data} />;
      case "speed":
        return <PerformanceTab data={data} />;
      case "email":
        return <EmailTab data={data} />;
      case "business":
        return <BusinessTabWrapper data={data} />;
      case "news":
        return <NewsTab domain={data.domain} />;
      case "explore":
        return <ExploreTab domain={data.domain} data={data} />;
      case "ai":
        return <AIAnalysisPanel domain={data.domain} analysisData={data} streaming={streaming} />;
      default:
        return null;
    }
  })();

  return lazyContent ? <Suspense fallback={<TabLoadingFallback />}>{lazyContent}</Suspense> : null;
}

// ─── Rate Limit Pill ────────────────────────────────────────────────
function RateLimitPill({
  rateLimit,
  sessionCount: _sessionCount,
}: {
  rateLimit: RateLimitInfo | null;
  sessionCount: number;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [expanded, setExpanded] = useState(false);

  // Tick every 30s to update countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  // Always show when we have rate limit data
  if (!rateLimit) return null;

  const { limit, remaining, reset } = rateLimit;
  const pct = remaining / limit;
  const isLow = pct <= 0.25;
  const isOut = remaining <= 0;

  // Countdown for reset
  const secsLeft = Math.max(0, reset - now);
  const minsLeft = Math.ceil(secsLeft / 60);

  const color = isOut ? "var(--danger)" : isLow ? "var(--warning, #d29922)" : "var(--dim)";
  const used = limit - remaining;

  return (
    <div
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      role="status"
    >
      <button
        type="button"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
        onClick={() => setExpanded((e) => !e)}
        style={{
          background: "var(--surface-raised, var(--card-bg, #1c2028))",
          border: `1px solid ${isOut ? "var(--danger)" : "var(--border, #30363d)"}`,
          fontFamily: "var(--font-ui)",
          fontSize: "11px",
          color,
          opacity: isLow ? 1 : 0.7,
          transition: "opacity 0.3s, border-color 0.3s",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        <Zap size={11} />
        {isOut ? (
          <span>Opens in {minsLeft}m</span>
        ) : (
          <span>
            {remaining}/{limit}
          </span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            background: "var(--surface-raised, var(--card-bg, #1c2028))",
            border: "1px solid var(--border, #30363d)",
            borderRadius: "8px",
            padding: "10px 14px",
            minWidth: "220px",
            fontFamily: "var(--font-ui)",
            fontSize: "12px",
            color: "var(--text)",
            lineHeight: 1.6,
            zIndex: 100,
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "4px", color }}>
            {isOut ? "Rate limit reached" : isLow ? "Running low" : "API usage"}
          </div>
          {/* Usage bar */}
          <div
            style={{
              height: "4px",
              borderRadius: "2px",
              background: "var(--border, #30363d)",
              marginBottom: "8px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min((used / limit) * 100, 100)}%`,
                background: color,
                borderRadius: "2px",
                transition: "width 0.3s",
              }}
            />
          </div>
          <div style={{ color: "var(--dim, #8b949e)", fontSize: "11px" }}>
            <div>
              {used} of {limit} analyses used this hour
            </div>
            {isOut && secsLeft > 0 ? (
              <div>
                Next slot opens in {minsLeft} min{minsLeft !== 1 ? "s" : ""}
              </div>
            ) : (
              <div style={{ opacity: 0.7 }}>Rolling 1-hour window</div>
            )}
          </div>
          {isOut && (
            <div style={{ marginTop: "6px", fontSize: "11px" }}>
              <a
                href="https://github.com/yokedotlol/yoke#self-hosting"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                Self-host
              </a>{" "}
              for unlimited usage
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Rate Limit Error Banner ────────────────────────────────────────
function RateLimitError({ message, onRetry }: { message: string; onRetry: () => void }) {
  // Parse "rate_limit:XX" format
  const mins = parseInt(message.replace("rate_limit:", ""), 10) || 0;

  return (
    <div className="panel p-5 mb-4 mt-3" style={{ borderColor: "var(--warning, #d29922)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Zap size={16} style={{ color: "var(--warning, #d29922)" }} />
        <span
          style={{ color: "var(--warning, #d29922)", fontFamily: "var(--font-ui)", fontSize: "14px", fontWeight: 600 }}
        >
          Rate limit reached
        </span>
      </div>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "13px",
          color: "var(--text)",
          margin: "0 0 8px 0",
          lineHeight: 1.5,
        }}
      >
        {mins > 0 ? (
          <>
            You've hit the hourly analysis limit. Next slot opens in{" "}
            <strong>
              {mins} minute{mins !== 1 ? "s" : ""}
            </strong>
            .
          </>
        ) : (
          <>You've hit the hourly analysis limit. A slot will open shortly.</>
        )}
      </p>
      <p style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--dim)", margin: "0 0 12px 0" }}>
        For unlimited usage,{" "}
        <a
          href="https://github.com/yokedotlol/yoke#self-hosting"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "underline" }}
        >
          self-host Yoke
        </a>{" "}
        on Cloudflare Workers + Fly.io free tiers.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          fontFamily: "var(--font-ui)",
          fontSize: "12px",
          cursor: "pointer",
        }}
      >
        <RotateCcw size={11} /> Try again
      </button>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────

export function App() {
  // Route: /cli → dedicated CLI landing page
  if (window.location.pathname === "/cli") {
    return <CliPage />;
  }

  // Route: /about → About page
  if (window.location.pathname === "/about") {
    return <AboutPage />;
  }

  const [domain, setDomain] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [compareMode, setCompareMode] = useState(() => {
    return window.location.pathname.startsWith("/compare");
  });
  const queryClient = useQueryClient();

  // Track tab switches — fire-and-forget, never blocks UI
  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      try {
        const payload = JSON.stringify({ tab, domain: domain || undefined });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/track-tab", new Blob([payload], { type: "application/json" }));
        } else {
          fetch("/api/track-tab", {
            method: "POST",
            body: payload,
            headers: { "Content-Type": "application/json" },
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* tracking must never break UX */
      }
    },
    [domain],
  );

  const analyze = useStreamingAnalysis();

  // Sync URL on analysis complete
  const prevDataRef = useRef<AnalysisResult | null>(null);
  useEffect(() => {
    if (analyze.data && analyze.data !== prevDataRef.current) {
      prevDataRef.current = analyze.data;
      const clean = analyze.data.domain;
      if (clean && window.location.pathname !== `/${clean}`) {
        window.history.pushState(null, "", `/${clean}`);
      }
      document.title = `${clean} — Yoke`;
    }
  }, [analyze.data, queryClient]);

  const doAnalyze = useCallback(() => {
    let d = domain.trim().toLowerCase();
    // Strip protocol and path — extract hostname from pasted URLs
    d = d.replace(/^https?:\/\//, "");
    d = d.replace(/[/?#].*$/, "");
    if (!d || analyze.isPending) return;
    setDomain(d);
    setActiveTab("overview");
    analyze.mutate(d);
  }, [domain, analyze.isPending, analyze.mutate]);

  const handleNavigate = useCallback(
    (raw: string) => {
      const d = raw
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/[/?#].*$/, "");
      setDomain(d);
      setActiveTab("overview");
      analyze.mutate(d);
    },
    [analyze.mutate],
  );

  // URL-based routing: yoke.lol/cloudflare.com → auto-analyze
  useEffect(() => {
    if (autoLoaded || compareMode) return;
    let path = window.location.pathname.slice(1); // strip leading /
    if (path.startsWith("compare")) return; // compare mode handled separately
    // Clean pasted URLs from path: yoke.lol/https://example.com/foo → example.com
    path = path.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
    if (path?.includes(".") && !path.startsWith("api/") && !path.startsWith("assets/")) {
      // URL has a domain in it — analyze it
      setAutoLoaded(true);
      setDomain(path);
      analyze.mutate(path);
      return;
    }
    // No domain in URL — show clean landing page (no auto-analyze)
  }, [autoLoaded, compareMode, analyze.mutate]);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      if (path.startsWith("/compare")) {
        setCompareMode(true);
        return;
      }
      setCompareMode(false);
      const slug = path.slice(1);
      if (slug?.includes(".")) {
        setDomain(slug);
        setActiveTab("overview");
        analyze.mutate(slug);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [analyze.mutate]);

  return (
    <main className="min-h-screen pb-12" style={{ background: "var(--bg)" }}>
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-6">
        {/* Header */}
        <header>
          <div className="flex items-center gap-2 sm:gap-3 mb-5 min-w-0">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                setDomain("");
                analyze.reset();
                setActiveTab("overview");
                setCompareMode(false);
                window.history.pushState({}, "", "/");
                document.title = "Yoke";
              }}
              style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none", cursor: "pointer" }}
            >
              <img
                src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAF80lEQVR4nN2ZS4xURRSG/+qe4aGyQEQTQRHCKyA4EUTAB4mJgPhKZKErV2o0xp0a48JEY9AAC4iGsBA1RBYqJCZqjHHhwkRWPsEHqAxCGCDKQxEYpqf7c1GnuGfudM9M9/TQhJN0bt2qU+f851Gnqm5LlyoBBSBcBDgCUKh3UnGE8DRMQ8LkrQVmAFem/hHGVxWLPccDM6xdOysMfJr0MrAFGNPKaABFw7AFeCmP0zMGYy4A24g0xcbqy78mksuGKYZpq8MaPGPRnuuN8X3f30py2D40bGt9v7eyA6gAvcALZmlby5AbAW2G5UXDVgFusrFiQVJKkUclBUkt93oNalPEFhSxSlIoSKrYS4djXhRC4MJhG5gMywLX1WFPfLn6znKsFzgLzLL+9gsLN6OkG5gNdBs2gG+tP7QphgRJPTavImmMpPeAFSGE42Zk0fhSZAghYGuo0UpVCSFUTH6qKqldDiGUgAmStkkaLalkOHq9lWmV73CLuGyW/go8WGvzGMkNzhbuA8Aew1IGSoZxe8KeIiBJX0t6SNHDRcVIzJL0kaTvgc8k7ZS0T9JJSd0hhGPAEkmPmIyhRiKtu60hhG/My6MljZc0TdJiSSsl3ez403oNkr6y/uDL6PWW+2WzMlmdooHrOwMsBkYBXTROvxM3z2VOd15X6qtY+zQwyTAXUrhSGr1mzOeqCCq5/h3G/7y9d9t4Pb9um/ukyfrU6S5VMSbpftVj9vlWJHr0S2PsIYtE3gOTgQnACfpGrB5K844A44CpxMjm5VUMC4ZtFPmjRDLCnuOAj52AtHBK9p4OVRvdeKOU5q4xma/U0IlhGuex9iM/ADwLHM8pPAhcBswkpkCj3k/ko3odcDnwZ47nOPBcNYw1jSCLxg3A68Ryeg5Yaf3bnaeGS0nGOyZ7OdE5PwNryE7F/Y/Rykpo3oiCpLYQQo+9z5e0VNIeSfMkbVAst6m8hVqyBvJVTkZF0jOS9kqaIWlnCOFH0z9KUm8IoVJDVh/wRde+DfiCuLjODsGTQ0mnfG5Xo27T9zmwtBq2wYyYDrxbRXCZrCJ0AhuAH3I8vVSnSm6sTDx/bQAOWV8P/csnwNvAtMFAB2A0sA74J6e04t5L1ncaWGhzbwHWAn/lAFdrHyHuNx029y6yg5qPYl73SeJ6bKfaQibuiO3AJueN3pywPB3DTq0m41piefW7ZwLQY865xvEvIqZnnjzwXrKob8SuvjWjYM/HyfLU5+sZM7DTgewClufkLCaW3GTAAWBBjme1eTUZ2gm8Rd9TQHJaCXjMYxwoldrseTuw2wT8C2wGZtrYrirGrSNGMJ3hf3Njv1hfOzAWeNONJRm7jGcu8SvEf9a/G7jDYxuUnBFjgVVYLba+IvCTCU+HreSpD4xnvvNs+s2xsU+cd9NGBrHu+wo4FbgHGFsXeCegkHs/n3vA3pzyClno7wbuc95NHl5BPN9D3zRJu/mepJdcucxj8VTTKndTKijevspO0H7FzaasbCNLd4gnJP1RReSdkm40Hg+wLKld8Z5hqs/rCrJbWy2cdZF5JxD3iS7nwRQFgKPEc75PIYB9wN853pR6h0xm/R9yGzHCnh1kVaTa5jMYpTnHgHle9ogT2SJfRv9Tqfe6p0oVnlPArV7mBSOycvlwLh0Go7T4y8CqloCvYsTmOoxIPOu9jFYZULDfNGIq1Uof7/0KcUefnOYPB8NwFw1W4g4rfmoJimWx2mfJio0FSacknbC5w/qEOVwD0rlkjqSJiiD9175EmK4245koaW4zMAzXgDT/ftfeKemoMiOwdpeNyd7vde3WENnnmF1kdX0hMAk47HL+EHA1sMR4yjan/+eROqnhCDjFBWVHirKkpyVdIWmTsrvyG5KukvSU4z2vf7hGNExku/JU4lHB05kabYD9wHQvo2XkjJhOvLhAPG2m62e6JqYT6IGLBnwism+rs4k3sVp0kOyPk6bsvk3LPaBox+BpklYr+z9LyvaG7SGEzsTbLN1No6GkRLPTpumrn4H/cmre5eRSof8BhMBhW2ydYVUAAAAASUVORK5CYII="
                alt="Yoke"
                className="site-logo"
                style={{ width: "24px", height: "24px", flexShrink: 0 }}
              />
              <h1
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "var(--text)",
                  letterSpacing: "-0.02em",
                  whiteSpace: "nowrap",
                  margin: 0,
                }}
              >
                Yoke
              </h1>
            </a>
            <div className="h-4 w-px hidden sm:block" style={{ background: "var(--border)" }} />
            <span
              className="hidden sm:inline"
              style={{ fontFamily: "var(--font-ui)", fontSize: "13px", color: "var(--dim)", whiteSpace: "nowrap" }}
            >
              Domain Intelligence
            </span>
            <div className="flex-1" />
            <ThemeToggle />
          </div>
        </header>

        {/* Search Bar + Compare toggle */}
        <div className="mb-0">
          <div className="flex items-center gap-2">
            {!compareMode && (
              <div
                className="search-glow flex items-center rounded-lg flex-1 min-w-0"
                style={{ background: "var(--surface)" }}
              >
                <div className="pl-4" style={{ color: "var(--dim)" }}>
                  <Search size={16} />
                </div>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (compareMode) {
                        setCompareMode(false);
                      }
                      doAnalyze();
                    }
                  }}
                  placeholder="Enter domain name (e.g. example.com)"
                  className="flex-1 bg-transparent px-3 py-3 outline-none min-w-0"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "14px", color: "var(--text)" }}
                  aria-label="Domain name"
                  disabled={analyze.isPending}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (compareMode) setCompareMode(false);
                    doAnalyze();
                  }}
                  disabled={analyze.isPending || !domain.trim()}
                  className="flex items-center gap-2 px-5 py-2 mr-1.5 rounded-md transition-all disabled:opacity-30"
                  style={{
                    background: "var(--accent)",
                    color: "var(--accent-fg)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: analyze.isPending || !domain.trim() ? "default" : "pointer",
                    border: "none",
                  }}
                  aria-label="Analyze domain"
                >
                  {analyze.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  {analyze.isPending ? "Analyzing…" : "Analyze"}
                </button>
              </div>
            )}
            <RateLimitPill rateLimit={analyze.rateLimit} sessionCount={analyze.sessionCount} />
            {/* Compare toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !compareMode;
                setCompareMode(next);
                if (next) {
                  window.history.pushState(null, "", "/compare");
                  document.title = "Compare — Yoke";
                } else if (analyze.data) {
                  window.history.pushState(null, "", `/${analyze.data.domain}`);
                  document.title = `${analyze.data.domain} — Yoke`;
                } else {
                  window.history.pushState(null, "", "/");
                  document.title = "Yoke";
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg transition-all flex-shrink-0"
              style={{
                background: compareMode ? "var(--accent)" : "var(--surface)",
                color: compareMode ? "var(--accent-fg)" : "var(--dim)",
                border: `1px solid ${compareMode ? "var(--accent)" : "var(--border)"}`,
                fontFamily: "var(--font-ui)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Compare two domains"
            >
              <ArrowLeftRight size={14} />
              <span className="hidden sm:inline">vs</span>
            </button>
          </div>
        </div>

        {/* Compare Mode */}
        {compareMode && (
          <div className="mt-4">
            <Suspense fallback={<TabLoadingFallback />}>
              <CompareView initialDomain={domain || analyze.data?.domain} />
            </Suspense>
          </div>
        )}

        {/* Normal Analysis Mode */}
        {!compareMode && (
          <>
            {/* Tab Bar - shown when we have results or are loading */}
            {(analyze.data || analyze.isPending) && (
              <div className="mt-3 mb-3 sticky top-0 z-10" style={{ background: "var(--bg)" }}>
                <nav aria-label="Analysis tabs">
                  <TabBar active={activeTab} onChange={handleTabChange} />
                </nav>
              </div>
            )}

            {/* Error state */}
            {analyze.error &&
              !analyze.isPending &&
              (analyze.error.message.startsWith("rate_limit:") ? (
                <RateLimitError message={analyze.error.message} onRetry={() => doAnalyze()} />
              ) : (
                <div className="panel p-4 mb-4 flex items-center gap-3 mt-3" style={{ borderColor: "var(--danger)" }}>
                  <span style={{ color: "var(--danger)", fontFamily: "var(--font-ui)", fontSize: "13px" }}>
                    Analysis failed: {String(analyze.error)}
                  </span>
                  <button
                    type="button"
                    onClick={() => doAnalyze()}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md"
                    style={{
                      background: "var(--danger-subtle)",
                      border: "1px solid rgba(248, 81, 73, 0.25)",
                      color: "var(--danger)",
                      fontFamily: "var(--font-ui)",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                    aria-label="Retry analysis"
                  >
                    <RotateCcw size={11} /> Retry
                  </button>
                </div>
              ))}

            {/* Streaming progress + partial results */}
            {analyze.isPending && (
              <>
                <div role="status" aria-live="polite" className="sr-only">
                  Analyzing domain…
                </div>
                <StreamingProgress progress={analyze.progress} />
                {analyze.partialData && hasEnoughForTabs(analyze.partialData) && (
                  <div className="mt-3">
                    <ErrorBoundary fallbackLabel="This tab encountered an error" key={`${activeTab}-streaming`}>
                      <TabContent
                        tab={activeTab}
                        data={cleanTechStack(analyze.partialData as AnalysisResult)}
                        streaming
                      />
                    </ErrorBoundary>
                  </div>
                )}
              </>
            )}

            {/* Cached indicator + re-analyze — shown above results */}
            {analyze.data?.cached && !analyze.isPending && (
              <div
                className="mt-3 mb-3 flex items-center justify-center gap-3"
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "12px", color: "var(--dim)" }}>
                  Cached results from{" "}
                  {new Date(analyze.data.cached_at || analyze.data.analyzed_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (analyze.data) analyze.mutate(analyze.data.domain, { force: true });
                  }}
                  disabled={analyze.isPending}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border)",
                    color: "var(--dim)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--dim)";
                  }}
                  title="Force fresh analysis, bypassing cache"
                >
                  <RotateCcw size={10} />
                  Re-analyze
                </button>
              </div>
            )}

            {/* Final results */}
            {analyze.data && !analyze.isPending && (
              <div className="mt-0" role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
                <div role="status" aria-live="polite" className="sr-only">
                  Analysis complete for {analyze.data.domain}
                </div>
                {/* Curl API showcase bar — hidden on tabs without direct API mapping */}
                {activeTab !== "ai" && activeTab !== "explore" && (
                  <div className="mb-3">
                    <CurlBar domain={analyze.data.domain} activeTab={activeTab} />
                  </div>
                )}
                <ShareBar
                  domain={analyze.data.domain}
                  composite={analyze.data.domain_score?.composite}
                  tier={analyze.data.domain_score?.tier}
                  axes={analyze.data.domain_score?.axes}
                  analyzedAt={analyze.data.analyzed_at}
                />
                <ErrorBoundary fallbackLabel="This tab encountered an error" key={activeTab}>
                  <TabContent tab={activeTab} data={cleanTechStack(analyze.data)} />
                </ErrorBoundary>
              </div>
            )}

            {/* Empty state — SEO-friendly landing content */}
            {!analyze.data && !analyze.isPending && !analyze.error && (
              <div className="flex flex-col items-center justify-center py-16">
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center mb-5"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  <Search size={28} style={{ color: "var(--accent)", opacity: 0.4 }} />
                </div>
                <h2
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "var(--text)",
                    textAlign: "center",
                    marginBottom: "0.5rem",
                  }}
                >
                  Free Domain Intelligence &amp; OSINT Tool
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "14px",
                    color: "var(--dim)",
                    textAlign: "center",
                    maxWidth: "520px",
                    lineHeight: "22px",
                    marginBottom: "1.5rem",
                  }}
                >
                  Enter any domain to analyze DNS records, SSL certificates, WHOIS data, security headers, tech stack,
                  performance, data breaches, and more — across 9 intelligence tabs.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: "0.75rem",
                    width: "100%",
                    maxWidth: "700px",
                    marginBottom: "1.5rem",
                  }}
                >
                  <div className="panel" style={{ padding: "0.75rem 1rem" }}>
                    <h3
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--accent)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      🔍 Deep Analysis
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "11px",
                        color: "var(--dim)",
                        lineHeight: "16px",
                      }}
                    >
                      DNS, SSL, WHOIS, security headers, email auth, DNSSEC, and certificate transparency
                    </p>
                  </div>
                  <div className="panel" style={{ padding: "0.75rem 1rem" }}>
                    <h3
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--accent)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      🛡️ Security &amp; Breaches
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "11px",
                        color: "var(--dim)",
                        lineHeight: "16px",
                      }}
                    >
                      HIBP breach detection, Shodan/GreyNoise intel, cookie audit
                    </p>
                  </div>
                  <div className="panel" style={{ padding: "0.75rem 1rem" }}>
                    <h3
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--accent)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      ⚙️ Tech Stack
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "11px",
                        color: "var(--dim)",
                        lineHeight: "16px",
                      }}
                    >
                      Framework, CMS, CDN, WAF detection. Deep WordPress fingerprinting with plugins and themes
                    </p>
                  </div>
                  <div className="panel" style={{ padding: "0.75rem 1rem" }}>
                    <h3
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--accent)",
                        marginBottom: "0.25rem",
                      }}
                    >
                      🤖 AI &amp; API
                    </h3>
                    <p
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "11px",
                        color: "var(--dim)",
                        lineHeight: "16px",
                      }}
                    >
                      AI-powered analysis with expert personas. Free JSON API:{" "}
                      <code style={{ fontSize: "10px", color: "var(--text)" }}>
                        curl -s https://{window.location.host}/stripe.com
                      </code>
                    </p>
                  </div>
                </div>
                <RecentLookups onSelect={handleNavigate} />
                <ApiTeaser />
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "1rem 1rem",
          marginTop: "3rem",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: "0.5rem 1.25rem",
          fontFamily: "var(--font-ui)",
          fontSize: "12px",
          color: "var(--dim)",
        }}
      >
        <nav aria-label="Site links" style={{ display: "contents" }}>
          <a
            href="https://github.com/yokedotlol/yoke"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--dim)",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: "0.35rem",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub ⭐
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="https://github.com/yokedotlol/yoke/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            Feedback
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="/api/docs"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            API
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="/status"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            Status
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="/privacy"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            Privacy
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="/terms"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            Terms
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="/about"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            About
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            Chrome Extension
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <a
            href="/cli"
            style={{ color: "var(--dim)", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--dim)")}
          >
            CLI
          </a>
          <span style={{ color: "var(--border)" }} aria-hidden="true">
            ·
          </span>
          <ResetLayoutButton />
        </nav>
      </footer>
    </main>
  );
}
