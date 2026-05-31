// ─── Shared Severity Utilities ───────────────────────────────────────
// Single source of truth for severity→color and severity→icon mappings.
// Used by DomainScore, AIAnalysisPanel, and any component showing findings.

export function severityBg(severity: string): string {
  switch (severity) {
    case "critical":
      return "rgba(248,81,73,0.15)";
    case "high":
      return "rgba(255,161,152,0.15)";
    case "medium":
      return "rgba(210,153,34,0.15)";
    case "low":
      return "rgba(88,166,255,0.15)";
    case "info":
      return "rgba(88,166,255,0.08)";
    case "good":
      return "rgba(126,231,135,0.15)";
    default:
      return "rgba(128,128,128,0.1)";
  }
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "var(--danger)";
    case "high":
      return "#ffa198";
    case "medium":
      return "var(--warning)";
    case "low":
      return "#58a6ff";
    case "info":
      return "var(--accent)";
    case "good":
      return "var(--success)";
    default:
      return "var(--dim)";
  }
}

export function severityIcon(severity: string): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
    case "low":
      return "🔵";
    case "info":
      return "ℹ️";
    case "good":
      return "✅";
    default:
      return "·";
  }
}

export function tierColor(tier: string): string {
  switch (tier) {
    case "Excellent":
      return "var(--success)";
    case "Strong":
      return "#58a6ff";
    case "Moderate":
      return "var(--warning)";
    case "Weak":
      return "#ffa198";
    case "Critical":
      return "var(--danger)";
    default:
      return "var(--danger)";
  }
}
