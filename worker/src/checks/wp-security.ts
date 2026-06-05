import { analyzeWordPress, probeWordPressSecurity } from "../actions/wordpress";
import { fetchWithTimeout } from "../helpers";
import type { Check } from "./types";

export const wordPressSecurityCheck: Check = {
  key: "wordpress_security",
  label: "WordPress security",
  default: null,
  timeout: 15_000,
  run: async (ctx) => {
    const probe = await ctx.httpProbePromise;
    if (!probe?.httpProbeSucceeded) return null;

    const headers = probe.headers ?? {};
    const wpDetails = analyzeWordPress(probe.html, headers, ctx.dnsRecords);
    if (!wpDetails) return null;

    // WordPress detected — run security probes
    const securityResult = await probeWordPressSecurity(ctx.domain, fetchWithTimeout).catch(() => null);

    if (securityResult) {
      wpDetails.xmlrpc_accessible = securityResult.xmlrpc_accessible;
      wpDetails.login_accessible = securityResult.login_accessible;
      wpDetails.user_enumeration = securityResult.user_enumeration;
      wpDetails.directory_listing = securityResult.directory_listing;
    }

    return wpDetails;
  },
};
