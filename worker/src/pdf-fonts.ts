// PDF font loader — fetches fonts from KV on demand (lazy, only when generating a PDF)
// Fonts are stored in REFERENCE_DATA KV under keys: pdf-font:Inter-Regular, pdf-font:Inter-Bold, etc.
// Upload via: wrangler kv:key put --binding=REFERENCE_DATA "pdf-font:Inter-Regular" --path=worker/src/fonts/Inter-Regular.ttf
//
// Self-hosted fallback: workerd.capnp can embed fonts as data bindings (FONT_INTER_REGULAR, etc.)
// The loader tries KV first, then falls back to data bindings.

import type { Env } from "./helpers";

const FONT_KEYS = {
  interRegular: "pdf-font:Inter-Regular",
  interMedium: "pdf-font:Inter-Medium",
  interSemiBold: "pdf-font:Inter-SemiBold",
  interBold: "pdf-font:Inter-Bold",
  jetBrainsMono: "pdf-font:JetBrainsMono-Regular",
} as const;

/** Maps font key to the Env data-binding name used for self-hosted fallback */
const FONT_BINDINGS: Record<string, keyof Env> = {
  interRegular: "FONT_INTER_REGULAR",
  interMedium: "FONT_INTER_MEDIUM",
  interSemiBold: "FONT_INTER_SEMIBOLD",
  interBold: "FONT_INTER_BOLD",
  jetBrainsMono: "FONT_JETBRAINS_MONO",
};

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
      // Try KV first (Cloudflare production path)
      if (env.REFERENCE_DATA) {
        const data = await env.REFERENCE_DATA.get(kvKey, "arrayBuffer");
        if (data) return [key, new Uint8Array(data)] as const;
      }
      // Fallback: data binding from workerd.capnp (self-hosted path)
      const bindingKey = FONT_BINDINGS[key];
      if (bindingKey) {
        const binding = env[bindingKey] as ArrayBuffer | undefined;
        if (binding) return [key, new Uint8Array(binding)] as const;
      }
      throw new Error(`PDF font not available: ${kvKey} (no KV data and no data binding)`);
    }),
  );

  cachedFonts = Object.fromEntries(results) as unknown as PdfFontData;
  return cachedFonts;
}
