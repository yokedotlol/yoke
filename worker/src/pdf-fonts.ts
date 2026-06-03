// PDF font loader — fetches fonts from KV on demand (lazy, only when generating a PDF)
// Fonts are stored in REFERENCE_DATA KV under keys: pdf-font:Inter-Regular, pdf-font:Inter-Bold, etc.
// Upload via: wrangler kv:key put --binding=REFERENCE_DATA "pdf-font:Inter-Regular" --path=worker/src/fonts/Inter-Regular.ttf

import type { Env } from "./helpers";

const FONT_KEYS = {
  interRegular: "pdf-font:Inter-Regular",
  interMedium: "pdf-font:Inter-Medium",
  interSemiBold: "pdf-font:Inter-SemiBold",
  interBold: "pdf-font:Inter-Bold",
  jetBrainsMono: "pdf-font:JetBrainsMono-Regular",
} as const;

export interface PdfFontData {
  interRegular: Uint8Array;
  interMedium: Uint8Array;
  interSemiBold: Uint8Array;
  interBold: Uint8Array;
  jetBrainsMono: Uint8Array;
}

let cachedFonts: PdfFontData | null = null;

export async function loadPdfFonts(env: Env): Promise<PdfFontData> {
  if (cachedFonts) return cachedFonts;

  const results = await Promise.all(
    Object.entries(FONT_KEYS).map(async ([key, kvKey]) => {
      if (!env.REFERENCE_DATA) throw new Error("REFERENCE_DATA KV binding not configured");
      const data = await env.REFERENCE_DATA.get(kvKey, "arrayBuffer");
      if (!data) throw new Error(`PDF font not found in KV: ${kvKey}`);
      return [key, new Uint8Array(data)] as const;
    }),
  );

  cachedFonts = Object.fromEntries(results) as unknown as PdfFontData;
  return cachedFonts;
}
