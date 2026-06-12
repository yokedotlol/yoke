import { Award, Gauge, LayoutDashboard, Mail, Search, Server, Shield, Sparkles } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "security", label: "Security", icon: Shield },
  { id: "foundations", label: "Foundations", icon: Server },
  { id: "speed", label: "Speed", icon: Gauge },
  { id: "reputation", label: "Reputation", icon: Award },
  { id: "discoverability", label: "Discoverability", icon: Search },
  { id: "email", label: "Email", icon: Mail },
  { id: "insights", label: "Insights", icon: Sparkles },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** Worst severity level for a tab, used to render colored indicator dots */
export type TabSeverity = "critical" | "high" | "medium" | null;

const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--danger, #e53e3e)",
  high: "var(--warning, #d69e2e)",
  medium: "var(--info, #4299e1)",
};

interface TabBarProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  /** Optional severity dots per tab */
  severities?: Partial<Record<TabId, TabSeverity>>;
}

export function TabBar({ active, onChange, severities }: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<CSSProperties>({});

  // Animate the active indicator
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const activeBtn = bar.querySelector(`[data-tab="${active}"]`) as HTMLElement;
    if (!activeBtn) return;
    setIndicatorStyle({
      left: activeBtn.offsetLeft,
      width: activeBtn.offsetWidth,
    });
  }, [active]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = TABS.findIndex((t) => t.id === active);
      let nextIndex = currentIndex;

      switch (e.key) {
        case "ArrowRight":
          nextIndex = (currentIndex + 1) % TABS.length;
          break;
        case "ArrowLeft":
          nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = TABS.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      const nextTab = TABS[nextIndex];
      onChange(nextTab.id);

      // Focus the newly active tab button
      const bar = barRef.current;
      if (bar) {
        const btn = bar.querySelector(`[data-tab="${nextTab.id}"]`) as HTMLElement;
        btn?.focus();
      }
    },
    [active, onChange],
  );

  return (
    <div className="yoke-tab-bar" ref={barRef} role="tablist" aria-label="Analysis tabs" onKeyDown={handleKeyDown}>
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        const severity = severities?.[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            className={`yoke-tab ${isActive ? "active" : ""}`}
            onClick={() => onChange(tab.id)}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            aria-label={`${tab.label}${severity ? ` (${severity} severity findings)` : ""}`}
            title={isActive ? undefined : tab.label}
          >
            <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
            <span className="yoke-tab-label" aria-hidden="true">
              {tab.label}
            </span>
            {severity && (
              <span
                className="yoke-tab-severity-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: SEVERITY_COLORS[severity],
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
      <div className="yoke-tab-indicator" style={indicatorStyle} />
    </div>
  );
}
