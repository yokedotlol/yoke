// ─── Shared formatting utilities ─────────────────────────────────────

/** Format a number with its ordinal suffix (1st, 2nd, 3rd, 4th, …). */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Human-readable percentile label: "Top 1%" for ≥90th, "53rd percentile" otherwise. */
export function percentileLabel(pctile: number): string {
  if (pctile >= 90) return `Top ${Math.max(1, 100 - pctile)}%`;
  return `${ordinal(pctile)} percentile`;
}
