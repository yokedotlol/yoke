// ─── Phase 2 Check Registry ─────────────────────────────────────────
// Ordered array of all parallel analysis checks.
// The orchestrator in core.ts iterates this registry to run Phase 2.
//
// ## Adding a new check
//
// 1. Create `worker/src/checks/your-check.ts` exporting a Check object
// 2. Import it below and add it to the `registry` array
// 3. Run `bun test` — the registry order test will verify consistency
//
// ORDER MATTERS: some downstream code references checks by index position
// in the results array. Append new checks at the end unless you have a
// specific reason to reorder.

import { ansCheck } from "./ans";
import { blocklistsCheck } from "./blocklists";
import { breachesCheck } from "./breaches";
import { carbonCheck } from "./carbon";
import { certTransparencyCheck } from "./cert-transparency";
import { connectionTimingCheck } from "./connection-timing";
import { cruxCheck } from "./crux";
import { dnsPropagationCheck } from "./dns-propagation";
import { dnssecCheck } from "./dnssec";
import { emailAuthCheck } from "./email-auth";
import { greenHostingCheck } from "./green-hosting";
import { greynoiseCheck } from "./greynoise";
import { ipInfoCheck } from "./ip-info";
import { llmsTxtCheck } from "./llms-txt";
import { outageLinksCheck } from "./outage-links";
import { performanceCheck, performanceDesktopCheck } from "./performance";
import { rdapCheck } from "./rdap";
import { ripeRoutingCheck } from "./ripe-routing";
import { robotsSitemapCheck } from "./robots-sitemap";
import { securityTxtCheck } from "./security-txt";
import { shodanCheck } from "./shodan";
import { socialAccountsCheck } from "./social-accounts";
import { sslCheck } from "./ssl";
import { statusCheck } from "./status";
import { trancoCheck } from "./tranco";
import type { Check } from "./types";
import { waybackCheck } from "./wayback";
import { wellKnownCheck } from "./well-known";

/**
 * The canonical ordered list of Phase 2 parallel checks.
 * This order must match the original hardcoded order in core.ts.
 */
export const registry: readonly Check[] = [
  rdapCheck,
  robotsSitemapCheck,
  ipInfoCheck,
  blocklistsCheck,
  sslCheck,
  performanceCheck,
  performanceDesktopCheck,
  cruxCheck,
  statusCheck,
  llmsTxtCheck,
  waybackCheck,
  trancoCheck,
  emailAuthCheck,
  carbonCheck,
  shodanCheck,
  dnssecCheck,
  breachesCheck,
  certTransparencyCheck,
  securityTxtCheck,
  greenHostingCheck,
  wellKnownCheck,
  greynoiseCheck,
  ansCheck,
  dnsPropagationCheck,
  ripeRoutingCheck,
  outageLinksCheck,
  connectionTimingCheck,
  socialAccountsCheck,
] as const;
