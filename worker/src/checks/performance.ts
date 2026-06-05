import { checkPageSpeed } from "../actions/analyze/performance";
import type { Check } from "./types";

export const performanceCheck: Check = {
  key: "performance",
  label: "Google PageSpeed (Mobile)",
  default: {
    score: null,
    fcp: null,
    lcp: null,
    tbt: null,
    cls: null,
    si: null,
    ttfb: null,
    strategy: "mobile",
    error: "PageSpeed timed out — analysis may take up to 60s",
    screenshot: null,
  },
  timeout: 65_000,
  run: (ctx) => checkPageSpeed(ctx.domain, ctx.httpResponseTimeMs, ctx.env, "mobile"),
};

export const performanceDesktopCheck: Check = {
  key: "performance_desktop",
  label: "Google PageSpeed (Desktop)",
  default: {
    score: null,
    fcp: null,
    lcp: null,
    tbt: null,
    cls: null,
    si: null,
    ttfb: null,
    strategy: "desktop",
    error: "PageSpeed desktop timed out",
    screenshot: null,
  },
  timeout: 65_000,
  run: (ctx) => checkPageSpeed(ctx.domain, ctx.httpResponseTimeMs, ctx.env, "desktop"),
};
