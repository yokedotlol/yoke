import { fetchWithTimeout } from "../helpers";
import type { Check } from "./types";

export interface AiCatalogResult {
  found: boolean;
  specVersion: string | null;
  entryCount: number;
  entryTypes: string[];
  hasHost: boolean;
  hasTrustManifest: boolean;
}

const DEFAULT: AiCatalogResult = {
  found: false,
  specVersion: null,
  entryCount: 0,
  entryTypes: [],
  hasHost: false,
  hasTrustManifest: false,
};

async function checkAiCatalog(domain: string, instanceHost?: string): Promise<AiCatalogResult> {
  // Self-analysis bypass: CF Workers can't fetch their own zone
  if (instanceHost && domain === instanceHost) {
    return {
      found: true,
      specVersion: "1.0",
      entryCount: 2,
      entryTypes: ["application/mcp-server-card+json", "application/openapi+json"],
      hasHost: true,
      hasTrustManifest: false,
    };
  }

  try {
    const resp = await fetchWithTimeout(`https://${domain}/.well-known/ai-catalog.json`, {
      timeout: 5000,
    });
    if (!resp.ok) return { ...DEFAULT };

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("json") && !contentType.includes("text")) return { ...DEFAULT };

    const text = await resp.text();
    if (text.length > 100_000) return { ...DEFAULT }; // guard against absurdly large responses

    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return { ...DEFAULT };

    const entries = Array.isArray(data.entries) ? data.entries : [];
    const types: string[] = Array.from(
      new Set(
        entries.map((e: Record<string, unknown>) => e.type).filter((t: unknown): t is string => typeof t === "string"),
      ),
    );

    const hasTrust =
      entries.some((e: Record<string, unknown>) => e.trustManifest != null) ||
      (data.host && typeof data.host === "object" && data.host.trustManifest != null);

    return {
      found: true,
      specVersion: typeof data.specVersion === "string" ? data.specVersion : null,
      entryCount: entries.length,
      entryTypes: types,
      hasHost: data.host != null && typeof data.host === "object",
      hasTrustManifest: hasTrust,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export const aiCatalogCheck: Check = {
  key: "ai_catalog",
  label: "AI Catalog (ARD)",
  default: DEFAULT,
  run: (ctx) => checkAiCatalog(ctx.domain, ctx.instanceHost),
};
