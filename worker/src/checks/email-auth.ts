import { checkEmailAuth } from "../actions/analyze/content";
import type { Check } from "./types";

export const emailAuthCheck: Check = {
  key: "email_auth",
  label: "Email Auth",
  default: {
    spf: { found: false, record: null, mechanisms: [], all_qualifier: null },
    dmarc: {
      found: false,
      record: null,
      policy: null,
      subdomain_policy: null,
      nonexistent_subdomain_policy: null,
      psd: null,
      rua: null,
      ruf: null,
      deprecated_tags: [],
    },
    dkim_selectors_found: [],
    bimi: { found: false, record: null, logo_url: null, authority_url: null },
    mta_sts: { dns_found: false, policy_found: false, mode: null },
    tls_rpt: { found: false, record: null, rua: null },
  },
  run: (ctx) => checkEmailAuth(ctx.domain, ctx.dnsRecords, ctx.env),
};
