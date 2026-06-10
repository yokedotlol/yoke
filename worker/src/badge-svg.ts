// ─── Badge SVG Renderer ──────────────────────────────────────────────
// Generates shields.io-style SVG badges for domain scores.
// Uses the exact shields.io SVG structure: Verdana 11px at 10× internal
// scale, #555 left pill, tier-colored right pill, shadow text layers.

/** Tier → badge color mapping (shields.io color names) */
const TIER_COLORS: Record<string, string> = {
  Excellent: "#4c1",
  Strong: "#97ca00",
  Moderate: "#dfb317",
  Weak: "#fe7d37",
  Critical: "#e05d44",
};

const NEUTRAL_COLOR = "#9f9f9f";

/**
 * Approximate text width in 110px Verdana (shields.io's internal scale).
 * shields.io uses canvas measurement; we approximate with per-char widths.
 */
function measureText(text: string): number {
  // Average character widths at font-size 110 (Verdana), empirically derived
  // from shields.io badge output. These are intentionally conservative.
  let width = 0;
  for (const ch of text) {
    if (ch === " ") width += 33;
    else if (ch >= "0" && ch <= "9") width += 65;
    else if (ch >= "A" && ch <= "Z") width += 75;
    else if (ch >= "a" && ch <= "z") width += 58;
    else width += 60;
  }
  return width;
}

/** Pad to nearest 10 and add side padding */
function textWidth(text: string): number {
  const raw = measureText(text);
  return raw + 100; // 50px padding on each side at 10× scale
}

export interface BadgeOptions {
  label: string;
  message: string;
  color: string;
  style?: "flat" | "flat-square";
}

/**
 * Render a shields.io-compatible SVG badge.
 */
export function renderBadgeSvg(opts: BadgeOptions): string {
  const { label, message, color, style = "flat" } = opts;

  const labelWidth10x = textWidth(label);
  const messageWidth10x = textWidth(message);

  // Final pixel dimensions (divide 10× coords by 10)
  const labelW = Math.round(labelWidth10x / 10);
  const messageW = Math.round(messageWidth10x / 10);
  const totalW = labelW + messageW;

  // Text center positions (in 10× scale)
  const labelX = Math.round(labelWidth10x / 2);
  const messageX = labelWidth10x + Math.round(messageWidth10x / 2);

  // Text widths for textLength (10× scale, minus padding)
  const labelTL = measureText(label);
  const messageTL = measureText(message);

  if (style === "flat-square") {
    return flatSquareBadge(totalW, labelW, messageW, labelX, messageX, labelTL, messageTL, label, message, color);
  }

  return flatBadge(totalW, labelW, messageW, labelX, messageX, labelTL, messageTL, label, message, color);
}

function flatBadge(
  totalW: number,
  labelW: number,
  messageW: number,
  labelX: number,
  messageX: number,
  labelTL: number,
  messageTL: number,
  label: string,
  message: string,
  color: string,
): string {
  const escapedLabel = escapeXml(label);
  const escapedMessage = escapeXml(message);
  const ariaLabel = `${escapedLabel}: ${escapedMessage}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${ariaLabel}"><title>${ariaLabel}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${labelW}" height="20" fill="#555"/><rect x="${labelW}" width="${messageW}" height="20" fill="${color}"/><rect width="${totalW}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelTL}">${escapedLabel}</text><text x="${labelX}" y="140" transform="scale(.1)" fill="#fff" textLength="${labelTL}">${escapedLabel}</text><text aria-hidden="true" x="${messageX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${messageTL}">${escapedMessage}</text><text x="${messageX}" y="140" transform="scale(.1)" fill="#fff" textLength="${messageTL}">${escapedMessage}</text></g></svg>`;
}

function flatSquareBadge(
  totalW: number,
  labelW: number,
  messageW: number,
  labelX: number,
  messageX: number,
  labelTL: number,
  messageTL: number,
  label: string,
  message: string,
  color: string,
): string {
  const escapedLabel = escapeXml(label);
  const escapedMessage = escapeXml(message);
  const ariaLabel = `${escapedLabel}: ${escapedMessage}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${ariaLabel}"><title>${ariaLabel}</title><g shape-rendering="crispEdges"><rect width="${labelW}" height="20" fill="#555"/><rect x="${labelW}" width="${messageW}" height="20" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><text x="${labelX}" y="140" transform="scale(.1)" fill="#fff" textLength="${labelTL}">${escapedLabel}</text><text x="${messageX}" y="140" transform="scale(.1)" fill="#fff" textLength="${messageTL}">${escapedMessage}</text></g></svg>`;
}

/** Build badge options from score data */
export function scoreBadgeOptions(
  label: string,
  score: number,
  tier: string,
  style?: "flat" | "flat-square",
): BadgeOptions {
  return {
    label,
    message: `${score} ${tier}`,
    color: TIER_COLORS[tier] || NEUTRAL_COLOR,
    style,
  };
}

/** Build a neutral badge ("not yet scanned" by default, or a custom message). */
export function neutralBadgeOptions(
  label: string,
  style?: "flat" | "flat-square",
  message = "not yet scanned",
): BadgeOptions {
  return {
    label,
    message,
    color: NEUTRAL_COLOR,
    style,
  };
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
