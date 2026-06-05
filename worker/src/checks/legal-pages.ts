import { detectLegalPages } from "../actions/analyze/content";
import type { Check } from "./types";

export const legalPagesCheck: Check = {
  key: "legal_pages",
  label: "Legal pages",
  default: null,
  timeout: 15_000,
  run: async (ctx) => {
    const probe = await ctx.httpProbePromise;
    const html = probe?.httpProbeSucceeded ? probe.html : "";
    return detectLegalPages(html, ctx.domain, ctx.env);
  },
};
