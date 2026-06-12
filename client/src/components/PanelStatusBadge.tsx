import type { ReactNode } from "react";

/**
 * Compact status indicator for collapsed panel headers.
 * Shows a colored dot and optional text summary.
 */
export function PanelStatusBadge({
  status,
  label,
}: {
  status: "good" | "warning" | "error" | "info" | "neutral";
  label: string;
}) {
  const colors: Record<string, string> = {
    good: "var(--success, #38a169)",
    warning: "var(--warning, #d69e2e)",
    error: "var(--danger, #e53e3e)",
    info: "var(--info, #4299e1)",
    neutral: "var(--dim)",
  };

  const color = colors[status] ?? colors.neutral;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--font-ui)",
        fontSize: "10px",
        fontWeight: 600,
        color,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}

/**
 * Wrapper for multiple collapsed summary badges.
 */
export function PanelSummaryGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3" style={{ marginRight: 4 }}>
      {children}
    </div>
  );
}
