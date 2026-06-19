import { checkBreaches } from "../actions/breaches";
import type { Check } from "./types";

export const breachesCheck: Check = {
  key: "breaches",
  label: "Data Breaches",
  default: { found: false, count: 0, total_pwned: 0, items: [] },
  run: (ctx) => checkBreaches(ctx.domain, ctx.env.REFERENCE_DATA, ctx.env.STATS_DB),
};
