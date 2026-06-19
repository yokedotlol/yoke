import { getSocialAccounts } from "../actions/social";
import type { Check } from "./types";

export const socialAccountsCheck: Check = {
  key: "social_accounts",
  label: "Social Accounts",
  default: { accounts: [], cached: false },
  run: (ctx) => getSocialAccounts(ctx.env.REFERENCE_DATA, ctx.domain, ctx.env, ctx.skipCache),
};
