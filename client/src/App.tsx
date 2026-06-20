import { ArrowLeftRight, CheckCircle2, Circle, Loader2, RotateCcw, XCircle, Zap } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { analyzeStream, type RateLimitInfo, type StreamEvent } from "./api";
import { CurlBar } from "./components/CurlShowcase";
import { AXIS_TO_TAB, DomainScore } from "./components/DomainScore";
import { DomainSignals, ExternalTools } from "./components/DomainSignals";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NotRegisteredBanner } from "./components/NotRegisteredBanner";
import { SkeletonPanel } from "./components/Panel";
import { type PanelDef, PanelGrid } from "./components/PanelLayout";
import { RecentLookups } from "./components/RecentLookups";
import { ScreenshotPanel, TrancoPanel } from "./components/ReputationPanels";
import { ShareBar } from "./components/ShareBar";
// Eagerly loaded components (needed for Overview tab and landing page)
import { TabBar, type TabId, type TabSeverity } from "./components/TabBar";
import { ThemeToggle } from "./components/ThemeToggle";
import { VitalsStrip } from "./components/VitalsStrip";
import { getConfig } from "./config";
import type { AnalysisResult } from "./utils/types";

// Lazy-loaded tab components (code-split into separate chunks)
const CompareView = lazy(() => import("./components/CompareView").then((m) => ({ default: m.CompareView })));
const InfrastructureTab = lazy(() => import("./components/tabs/InfrastructureTab"));
const SecurityTab = lazy(() => import("./components/tabs/SecurityTab"));
const PerformanceTab = lazy(() => import("./components/tabs/PerformanceTab"));
const ReputationTab = lazy(() => import("./components/tabs/ReputationTab"));
const DiscoverabilityTab = lazy(() => import("./components/tabs/DiscoverabilityTab"));
const EmailTab = lazy(() => import("./components/tabs/EmailTab"));
const AIAnalysisPanel = lazy(() =>
  import("./components/AIAnalysisPanel").then((m) => ({ default: m.AIAnalysisPanel })),
);

// Known false-positive e-commerce detections: WooCommerce & Magento pattern-match
// on pages that merely *mention* those names (e.g. Stripe lists them as integrations).
// Filter client-side for now; the server fingerprints will also be tightened.
const FP_ECOMMERCE_NAMES = new Set(["WooCommerce", "Magento"]);

/** Compute worst severity per tab from axis findings */
function computeTabSeverities(data: AnalysisResult): Partial<Record<TabId, TabSeverity>> {
  const ds = data.domain_score;
  if (!ds) return {};
  const severityRank: Record<string, number> = { critical: 3, high: 2, medium: 1 };
  const result: Partial<Record<TabId, TabSeverity>> = {};

  for (const [axis, tabId] of Object.entries(AXIS_TO_TAB) as [string, TabId][]) {
    const axisData = ds.axes[axis as keyof typeof ds.axes];
    if (!axisData?.findings) continue;
    let worst = 0;
    let worstLevel: TabSeverity = null;
    for (const f of axisData.findings) {
      const rank = severityRank[f.severity] ?? 0;
      if (rank > worst) {
        worst = rank;
        worstLevel = f.severity as TabSeverity;
      }
    }
    if (worstLevel) result[tabId] = worstLevel;
  }
  return result;
}

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
              // Populate pending checks when parallel analysis starts
              if ((d.phase === "checks" || d.phase === "phase2") && d.checks) {
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
                label: allDone ? "Finishing up…" : `Analyzing… ${completed} of ${total} checks complete`,
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
  // Show tabs as soon as we have DNS results
  return !!partial.dns;
}

// ─── Degraded Provider Banner ──────────────────────────────────

const DEGRADED_LABELS: Record<string, string> = {
  performance: "PageSpeed (Mobile)",
  performance_desktop: "PageSpeed (Desktop)",
  cert_transparency: "Certificate Transparency",
  tranco_rank: "Tranco Ranking",
  breaches: "Breach Data",
  shodan: "Shodan",
  greynoise: "GreyNoise",
  wayback: "Wayback Machine",
  rdap: "WHOIS / RDAP",
  carbon: "Website Carbon",
  ssl: "SSL / TLS",
  crux: "Chrome UX Report",
  ip_info: "IP Geolocation",
  blocklists: "Blocklists",
  email_auth: "Email Auth",
  green_hosting: "Green Hosting",
  dnssec: "DNSSEC",
  security_txt: "Security.txt",
  well_known: "Well-Known",
  dns_propagation: "DNS Propagation",
  ripe_routing: "RIPE Routing",
  connection_timing: "Connection Timing",
  outage_links: "Outage Detection",
  social_accounts: "Social Accounts",
  _status: "Status Check",
  _robots_sitemap: "Robots & Sitemap",
  llms_txt: "LLMs.txt",
  ans: "AI Agent Readiness",
};

function DegradedBanner({ providers }: { providers: string[] }) {
  const labels = providers.map((k) => DEGRADED_LABELS[k] ?? k);
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        background: "color-mix(in srgb, var(--warning) 8%, var(--surface))",
        border: "1px solid color-mix(in srgb, var(--warning) 25%, transparent)",
        color: "var(--dim)",
        fontSize: "11px",
        fontFamily: "var(--font-ui)",
      }}
    >
      <span style={{ color: "var(--warning)", marginRight: "6px" }}>⚠</span>
      Some data sources temporarily unavailable: {labels.join(", ")}. Results may be incomplete — try again later for
      full analysis.
    </div>
  );
}

// ─── Tab Content Components ────────────────────────────────────

function OverviewTab({
  data,
  streaming,
  onNavigateTab,
}: {
  data: AnalysisResult;
  streaming?: boolean;
  onNavigateTab?: (tab: TabId) => void;
}) {
  // Quick tech stack badges
  const techBadges = (data.tech_stack ?? []).slice(0, 8);

  const quickInfoPanels: PanelDef[] = [
    { id: "screenshot", node: <ScreenshotPanel data={data} streaming={streaming} /> },
    { id: "tranco", node: <TrancoPanel data={data} /> },
  ];

  return (
    <div className="space-y-3">
      {/* Domain Score — the headline */}
      <DomainScore data={data} onAxisClick={onNavigateTab ? (axis) => onNavigateTab(AXIS_TO_TAB[axis]) : undefined} />

      {/* Circuit breaker: degraded upstream notice */}
      {data._meta?.degraded && data._meta.degraded.length > 0 && <DegradedBanner providers={data._meta.degraded} />}

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

function TabContent({
  tab,
  data,
  streaming,
  onNavigateTab,
}: {
  tab: TabId;
  data: AnalysisResult;
  streaming?: boolean;
  onNavigateTab?: (tab: TabId) => void;
}) {
  // Overview is eagerly loaded — no Suspense needed
  if (tab === "overview") return <OverviewTab data={data} streaming={streaming} onNavigateTab={onNavigateTab} />;

  // All other tabs are lazy-loaded
  const lazyContent = (() => {
    switch (tab) {
      case "foundations":
        return <InfrastructureTab data={data} />;
      case "security":
        return <SecurityTab data={data} />;
      case "speed":
        return <PerformanceTab data={data} />;
      case "reputation":
        return <ReputationTab data={data} />;
      case "discoverability":
        return <DiscoverabilityTab data={data} />;
      case "email":
        return <EmailTab data={data} />;
      case "insights":
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
      style={{ position: "fixed", bottom: "16px", right: "16px", zIndex: 100 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      role="status"
    >
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full"
        onClick={() => setExpanded((e) => !e)}
        style={{
          background: "var(--surface-raised, var(--card-bg, #1c2028))",
          border: `1px solid ${isOut ? "var(--danger)" : "var(--border, #30363d)"}`,
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          padding: "6px 14px",
          color,
          opacity: isLow ? 1 : 0.7,
          transition: "opacity 0.3s, color 0.3s, border-color 0.3s",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
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
            bottom: "calc(100% + 6px)",
            right: 0,
            background: "var(--surface-raised, var(--card-bg, #1c2028))",
            border: "1px solid var(--border, #30363d)",
            borderRadius: "8px",
            padding: "10px 14px",
            minWidth: "220px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--text)",
            lineHeight: 1.6,
            zIndex: 101,
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
    <div className="panel p-5 mb-4 mt-3" role="alert" style={{ borderColor: "var(--warning, #d29922)" }}>
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
  const cfg = getConfig();
  const [domain, setDomain] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [compareMode, setCompareMode] = useState(() => {
    return window.location.pathname.startsWith("/compare");
  });

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
  }, [analyze.data]);

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
    <main id="main-content" className="min-h-screen pb-12" style={{ background: "var(--bg)" }}>
      <a href="#search-input" className="skip-nav">
        Skip to search
      </a>
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
              style={{ display: "flex", alignItems: "center", gap: "2px", textDecoration: "none", cursor: "pointer" }}
            >
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "22px",
                  fontWeight: 800,
                  color: "var(--text)",
                  letterSpacing: "-0.04em",
                }}
              >
                yoke
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "22px",
                  fontWeight: 800,
                  color: "var(--accent)",
                  letterSpacing: "-0.04em",
                }}
              >
                .lol
              </span>
            </a>
            <div className="h-4 w-px hidden sm:block" style={{ background: "var(--border)" }} />
            <span
              className="hidden sm:inline"
              style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--dim)", whiteSpace: "nowrap" }}
            >
              fast, API-first domain intelligence
            </span>
            <div className="flex-1" />
            <ThemeToggle />
          </div>
        </header>

        {/* Search Bar + Compare toggle */}
        <div className="mb-0">
          <div className="flex items-center gap-2">
            {!compareMode && (
              <div className="search-glow flex items-center flex-1 min-w-0" style={{ background: "transparent" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "14px",
                    color: "var(--accent)",
                    whiteSpace: "nowrap",
                    userSelect: "none",
                    paddingLeft: "4px",
                  }}
                  aria-hidden="true"
                >
                  $ yoke ▸
                </span>
                <input
                  id="search-input"
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
                  placeholder="example.com"
                  className="flex-1 bg-transparent px-3 py-3 outline-none min-w-0"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  inputMode="url"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "14px",
                    color: "var(--text)",
                    caretColor: "var(--accent)",
                  }}
                  aria-label="Domain name"
                  disabled={analyze.isPending}
                />
                {analyze.isPending && (
                  <Loader2 size={14} className="animate-spin mr-2" style={{ color: "var(--accent)", flexShrink: 0 }} />
                )}
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
            {/* Tab Bar - shown when we have results or are loading (never for NXDOMAIN) */}
            {(analyze.data || analyze.isPending) && !analyze.data?.not_registered && (
              <div className="mt-3 mb-3 sticky top-0 z-10" style={{ background: "var(--bg)" }}>
                <nav aria-label="Analysis tabs">
                  <TabBar
                    active={activeTab}
                    onChange={handleTabChange}
                    severities={analyze.data ? computeTabSeverities(analyze.data) : undefined}
                  />
                </nav>
              </div>
            )}

            {/* Error state */}
            {analyze.error &&
              !analyze.isPending &&
              (analyze.error.message.startsWith("rate_limit:") ? (
                <RateLimitError message={analyze.error.message} onRetry={() => doAnalyze()} />
              ) : (
                <div
                  className="panel p-4 mb-4 flex items-center gap-3 mt-3"
                  role="alert"
                  style={{ borderColor: "var(--danger)" }}
                >
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
                {analyze.partialData &&
                  !analyze.partialData.not_registered &&
                  hasEnoughForTabs(analyze.partialData) && (
                    <div className="mt-3">
                      <ErrorBoundary fallbackLabel="This tab encountered an error" key={`${activeTab}-streaming`}>
                        <TabContent
                          tab={activeTab}
                          data={cleanTechStack(analyze.partialData as AnalysisResult)}
                          streaming
                          onNavigateTab={handleTabChange}
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
            {analyze.data &&
              !analyze.isPending &&
              (analyze.data.not_registered ? (
                /* NXDOMAIN — no analysis check produces meaningful data, so show only the
                   not-registered empty-state result. No tab bar, no panels, no curl/share bars. */
                <NotRegisteredBanner domain={analyze.data.domain} />
              ) : (
                <div className="mt-0" role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
                  <div role="status" aria-live="polite" className="sr-only">
                    Analysis complete for {analyze.data.domain}
                  </div>
                  {/* Curl API showcase bar — hidden on tabs without direct API mapping */}
                  {activeTab !== "insights" && (
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
                    pdfUrl={analyze.data._meta?.pdf_url}
                  />
                  <ErrorBoundary fallbackLabel="This tab encountered an error" key={activeTab}>
                    <TabContent tab={activeTab} data={cleanTechStack(analyze.data)} onNavigateTab={handleTabChange} />
                  </ErrorBoundary>
                </div>
              ))}

            {/* Empty state — minimal landing */}
            {!analyze.data && !analyze.isPending && !analyze.error && (
              <div className="flex flex-col items-center justify-center py-16">
                {/* Curl hint */}
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    color: "var(--dim)",
                    marginBottom: "2rem",
                    textAlign: "center",
                  }}
                >
                  curl -s https://{window.location.host}/stripe.com
                </div>

                {/* Example domain pills */}
                <RecentLookups onSelect={handleNavigate} />

                {/* Axis labels */}
                <div className="flex flex-wrap justify-center gap-3 mt-6" style={{ maxWidth: "600px" }}>
                  {["security", "speed", "foundations", "reputation", "discoverability", "email"].map((axis) => (
                    <span
                      key={axis}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        color: "var(--dim)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {axis}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="footer">
        <nav aria-label="Site links" className="footer-links">
          {!cfg.hideCli && (
            <>
              <a href="/cli">cli</a>
              <span className="dot"> · </span>
            </>
          )}
          <a href="/docs">docs</a>
          <span className="dot"> · </span>
          <a href="/tools">tools</a>
          <span className="dot"> · </span>
          {!cfg.hideGithub && (
            <>
              <a href={cfg.repoUrl} target="_blank" rel="noopener noreferrer">
                github
              </a>
              <span className="dot"> · </span>
            </>
          )}
          <a href={cfg.extensionUrl} target="_blank" rel="noopener noreferrer">
            extension
          </a>
          <span className="dot"> · </span>
          <a href="/privacy">privacy</a>
          <span className="dot"> · </span>
          <a href="/terms">terms</a>
        </nav>
        <div className="footer-family">
          <a href="https://certs.lol" target="_blank" rel="noopener noreferrer">
            certs
          </a>
          <span className="dot"> · </span>
          <a href="https://ns.lol" target="_blank" rel="noopener noreferrer">
            ns
          </a>
          <span className="dot"> · </span>
          <a href="https://xhttp.lol" target="_blank" rel="noopener noreferrer">
            xhttp
          </a>
          <span className="dot"> · </span>
          <a href="https://vrfy.lol" target="_blank" rel="noopener noreferrer">
            vrfy
          </a>
        </div>
        <a
          href={`/${window.location.hostname}`}
          className="yoke-badge"
          title={`Yoke score for ${window.location.hostname}`}
        >
          <img
            src={`/badge/${window.location.hostname}.svg`}
            alt={`Yoke score for ${window.location.hostname}`}
            height="20"
            style={{ verticalAlign: "middle" }}
          />
        </a>
      </footer>
    </main>
  );
}
