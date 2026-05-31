import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { usePanelContext } from "./PanelLayout";

interface PanelProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
}

export function Panel({ title, icon, children, badge }: PanelProps) {
  const ctx = usePanelContext();

  // If not inside a PanelGrid, render normally (no collapse/drag)
  if (!ctx) {
    return (
      <div className="panel">
        <div className="panel-header flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="opacity-60">{icon}</span>
            <span>{title}</span>
          </div>
          {badge}
        </div>
        <div>{children}</div>
      </div>
    );
  }

  return (
    <CollapsiblePanel title={title} icon={icon} badge={badge} collapsed={ctx.collapsed} onToggle={ctx.toggle}>
      {children}
    </CollapsiblePanel>
  );
}

function CollapsiblePanel({
  title,
  icon,
  badge,
  collapsed,
  onToggle,
  children,
}: PanelProps & { collapsed: boolean; onToggle: () => void }) {
  const ctx = usePanelContext();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [animHeight, setAnimHeight] = useState<number | "auto">(collapsed ? 0 : "auto");
  const mounted = useRef(false);
  const contentId = `panel-content-${title.replace(/\s+/g, "-").toLowerCase()}`;

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = bodyRef.current;
    if (!el) return;
    if (collapsed) {
      const h = el.scrollHeight;
      setAnimHeight(h);
      // Force reflow then animate to 0
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimHeight(0)));
    } else {
      setAnimHeight(el.scrollHeight);
      const t = setTimeout(() => setAnimHeight("auto"), 220);
      return () => clearTimeout(t);
    }
  }, [collapsed]);

  const heightStyle = collapsed && !mounted.current ? 0 : animHeight === "auto" ? "auto" : `${animHeight}px`;

  return (
    <div className="panel">
      {/* biome-ignore lint/a11y/useSemanticElements: panel header toggle is a composite widget, not a simple button */}
      <div
        className="panel-header flex items-center justify-between"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        style={{ cursor: "pointer", userSelect: "none", borderBottomColor: collapsed ? "transparent" : undefined }}
      >
        <div className="flex items-center gap-2.5">
          {/* Drag handle */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle uses mouse-only events intentionally */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: drag handle uses mouse-only events intentionally */}
          <span
            className="yoke-grip"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={() => ctx?.onGripMouseDown?.()}
            onMouseUp={() => ctx?.onGripMouseUp?.()}
            title="Drag to reorder"
          >
            <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2" r="1.1" />
              <circle cx="6" cy="2" r="1.1" />
              <circle cx="2" cy="7" r="1.1" />
              <circle cx="6" cy="7" r="1.1" />
              <circle cx="2" cy="12" r="1.1" />
              <circle cx="6" cy="12" r="1.1" />
            </svg>
          </span>
          <span className="opacity-60">{icon}</span>
          <span>{title}</span>
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation container, not an interactive element */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation container, not an interactive element */}
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {!collapsed && badge}
          <span
            className="yoke-chevron"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0)" }}
            aria-hidden="true"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: collapsible content region paired with button via aria-controls */}
      <div
        ref={bodyRef}
        id={contentId}
        role="region"
        style={{
          height: heightStyle,
          overflow: collapsed || animHeight !== "auto" ? "hidden" : "visible",
          transition: mounted.current ? "height 0.2s ease" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function DataRow({
  label,
  value,
  mono = true,
  copyValue,
}: {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isCopiable = copyValue != null || typeof value === "string" || typeof value === "number";

  const handleCopy = useCallback(() => {
    const text = copyValue ?? (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [value, copyValue]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: click-to-copy convenience, not primary interaction
    // biome-ignore lint/a11y/noStaticElementInteractions: click-to-copy data row
    <div
      className={`data-row${isCopiable ? " data-row-copiable" : ""}`}
      onClick={isCopiable ? handleCopy : undefined}
      title={isCopiable ? "Click to copy" : undefined}
    >
      <span className="data-label">{label}</span>
      <span className="data-value-wrap">
        <span
          className={mono ? "data-value" : "data-value"}
          style={mono ? undefined : { fontFamily: "var(--font-ui)" }}
        >
          {value}
        </span>
        {isCopiable && (
          <span className="data-copy-icon">
            {copied ? (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

export function StatusBadge({
  status,
  label,
}: {
  status: "pass" | "fail" | "warn" | "info" | "neutral";
  label: string;
}) {
  return <span className={`badge badge-${status}`}>{label}</span>;
}

/** Badge for external letter grades (SSL Labs, security headers) */
export function GradeBadge({ grade }: { grade: string }) {
  const letter = grade.replace("+", "").replace("-", "").toLowerCase().charAt(0);
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    a: { bg: "var(--success-subtle)", color: "var(--success)", border: "rgba(63,185,80,0.25)" },
    b: { bg: "rgba(63,185,80,0.06)", color: "#7ee787", border: "rgba(63,185,80,0.15)" },
    c: { bg: "var(--warning-subtle)", color: "var(--warning)", border: "rgba(210,153,34,0.2)" },
    d: { bg: "var(--danger-subtle)", color: "#ffa198", border: "rgba(248,81,73,0.15)" },
    f: { bg: "rgba(248,81,73,0.15)", color: "var(--danger)", border: "rgba(248,81,73,0.25)" },
  };
  const c = colors[letter] || colors.f;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 38,
        height: 38,
        borderRadius: "var(--radius)",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize: 18,
        background: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      }}
    >
      {grade}
    </span>
  );
}

/** Badge for composite score tiers (Excellent/Strong/Moderate/Weak/Critical) */
export function TierBadge({ tier }: { tier: string }) {
  const cls = tier.toLowerCase();
  return <span className={`tier-badge tier-${cls}`}>{tier}</span>;
}

export function SkeletonPanel({ title, icon, rows = 4 }: { title: string; icon: ReactNode; rows?: number }) {
  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2.5">
        <span className="opacity-40">{icon}</span>
        <span>{title}</span>
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={`skel-${i}`} className="skeleton h-4 rounded" style={{ width: `${55 + Math.random() * 35}%` }} />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-4 text-xs" style={{ color: "var(--dim)", fontFamily: "var(--font-ui)" }}>
      <span className="opacity-60">⚠</span> {message}
    </div>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <div className="section-header">{title}</div>;
}
