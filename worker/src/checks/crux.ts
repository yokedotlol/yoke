import { checkCrux } from "../actions/analyze/performance";
import type { Check } from "./types";

export const cruxCheck: Check = {
  key: "crux",
  label: "Chrome UX Report",
  default: null,
  timeout: 15_000,
  run: (ctx) => checkCrux(ctx.domain, ctx.env),
};
