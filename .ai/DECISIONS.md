# Yoke — Decision Log

> Append-only record of significant decisions. Never edit or remove entries.
> Include `Rejected:` to prevent re-exploring dead ends, `Directive:` to guide future work.

---

### 2026-05-22 — Project created

Yoke registered at yoke.lol. Initial architecture: Cloudflare Worker + Vite SPA + Fly.io proxy.

---

### 2026-05-25 — Yahoo Finance removed

**What changed:** Removed all Yahoo Finance data sources and references.
**Why:** Terms of Service violation risk. Yahoo Finance explicitly prohibits scraping.
**Rejected:** Using a paid Yahoo Finance API → cost not justified for the data it provides.
**Directive:** Do not re-add any Yahoo Finance integration. If financial data is needed, find a ToS-compliant source.

---

### 2026-05-25 — SSL Labs removed

**What changed:** Removed SSL Labs API integration.
**Why:** Qualys ToS violation — their API terms prohibit use in competing products.
**Replaced with:** Direct SSL probing via the Fly proxy, deep link to SSL Labs for users who want the full report.
**Directive:** Do not call the SSL Labs API. The deep link in the UI is fine.

---

### 2026-05-27 — /api/recent endpoint deleted

**What changed:** Removed the `/api/recent` endpoint entirely. The site ticker (showing recent lookups) remains, backed by KV.
**Why:** Privacy concern (exposes what domains users are looking up), low value, attack surface.
**Rejected:** Keep endpoint but add rate limiting → still a privacy issue regardless of rate limits.
**Directive:** The KV write for the site ticker is the only remnant. Do not re-create a public recent-lookups API.

---

### 2026-05-27 — Health endpoint split into public and admin

**What changed:** `/api/health` shows status/version/uptime publicly. Full error details require `X-Admin-Key` header.
**Why:** Exposing internal errors publicly is an information leak.
**Directive:** Never add diagnostic details to the public health response.

---

### 2026-05-27 — WordPress signal weights finalized

**What changed:** `wp_user_enumeration` gets scoring weight `[1, 1]`. `wp_xmlrpc_enabled` and `wp_version_exposed` stay at weight `[0, 0]`.
**Why:** xmlrpc detection is unreliable (many hosts disable it at the server level, not WordPress level). Version exposure detection is flaky. User enumeration is a real, testable security concern.
**Directive:** If adding WP signals, default to weight 0 unless the detection is highly reliable and the security impact is clear.

---

### 2026-05-29 — D1 yoke-cache fully decommissioned

**What changed:** All caching moved from D1 `yoke-cache` to KV `REFERENCE_DATA`. D1 binding removed from wrangler.toml.
**Why:** KV is better suited for cache workloads (no row limits, TTL-based expiry, no schema management).
**Directive:** There is exactly ONE D1 database: `yoke-stats`. Do not create or reference a second D1. All caching goes through KV.

---

### 2026-05-29 — Recursive DNS panel removed

**What changed:** Removed `/api/recursive-dns` endpoint and the recursive DNS UI panel.
**Why:** Low value to users, potential attack vector (could be used to probe internal DNS infrastructure).
**Directive:** Do not re-add. If DNS resolver information is needed, fold it into existing DNS checks.

---

### 2026-05-31 — Scoring model: anchor-and-adjust → deductive

**What changed:** Replaced anchor-and-adjust scoring (BASELINE=55, add/subtract) with deductive scoring (start at 100, subtract deductions).
**Replaced:** `BASELINE = 55` constant and all adjustment logic.
**Why:** Anchor-and-adjust was opaque — hard to explain why a score was what it was. Deductive is intuitive: "you start perfect, here's what's costing you points."
**Rejected:** Keep anchor-and-adjust with better calibration → fundamental UX problem, not a calibration problem.
**Directive:** Scoring ALWAYS starts at 100 and subtracts. If you see any reference to BASELINE, an additive scoring model, or anchor-and-adjust, it's stale code that must be removed.

---

### 2026-05-31 — Composite: geometric mean → weighted arithmetic mean

**What changed:** Composite score uses weighted arithmetic mean of axis scores (with axis weights summing to 1.0), plus an outlier floor cap.
**Why:** Geometric mean punished single low axes too aggressively, making scores hard to explain.
**Outlier floor cap:** If ANY axis < 40, composite is capped at 74 (Moderate maximum). This preserves the "one terrible axis drags you down" principle without the geometric mean's opacity.
**Directive:** Do not use geometric mean for composite calculation. The arithmetic mean + floor cap is the current model.

---

### 2026-05-31 — Letter grades → descriptive tiers

**What changed:** Replaced A+/A/B+/B/C+/C/D+/D/F with Excellent/Strong/Moderate/Weak/Critical.
**Why:** Letter grades implied an academic testing metaphor that didn't match what we're measuring. Descriptive tiers communicate meaning directly.
**Directive:** Use "tier" (not "grade") everywhere — API responses, UI labels, documentation, test names. "Level-Up" (not "Grade-Up") for the improvement plan.

---

### 2026-05-31 — MCP server published to npm

**What changed:** `@yokedotlol/mcp-server` v1.0.1 published. TypeScript-based Model Context Protocol server for AI agent integration.
**Directive:** Version in `mcp-server/package.json`, released via `mcp/v*` tags.

---

### 2026-06-01 — ABSENT_DEDUCTION_FACTOR reduced 0.25 → 0.15

**What changed:** The penalty applied when a signal is absent (can't be assessed) reduced from 25% of its potential deduction to 15%.
**Why:** 0.25 was too harsh for Discoverability-heavy domains (e.g., google.com scored 69 on Discoverability). Many absent signals are genuinely not applicable, not a sign of poor configuration.
**Directive:** The current value is 0.15. Changes to this constant affect ALL scores and must be validated with calibration tests.

---

### 2026-06-01 — ip-api.com removed, replaced by ipwho.is + MaxMind

**What changed:** Removed ip-api.com geolocation. Primary: MaxMind GeoIP via Fly proxy. Fallback: ipwho.is (HTTPS).
**Why:** ip-api.com is HTTP-only — a security concern for a security tool.
**Directive:** Do not use HTTP-only APIs for any data source.

---

### 2026-06-01 — Level-Up Plan shows both penalties and opportunities

**What changed:** Level-Up Plan expanded to show penalty removals (fix bad things) AND positive canBeGood signal opportunities (add good things). Previously only showed penalties.
**Why:** Users need to see both "what's hurting you" and "what you're missing" to prioritize improvements effectively.
**Directive:** Level-Up must surface both dimensions. The `presentWeight` calculation only counts `canBeGood` signals.

---

### 2026-06-01 — .ai/ context framework added

**What changed:** Added `.ai/` directory with CONSTITUTION.md, DECISIONS.md, INVARIANTS.md, STATE.md, GOTCHAS.md, and staleness-check.sh.
**Why:** AI agents working on the project need persistent, structured context about decisions, invariants, and current state to avoid reverting agreed-upon changes or violating project principles.
**Directive:** Keep these files updated. See CONSTITUTION.md for the maintenance protocol.

---

### 2026-06-01: Restored recent domains ticker

- **What:** Re-added KV write for recent:index and homepage ticker display
- **Why:** Cleanup sprints accidentally removed both the write and display when removing /api/recent
- **Directive:** The ticker is an internal SPA feature. /api/recent remains removed as a public API endpoint.

---

### 2026-06-01: Canonical curl format is `curl -s https://`

- **What:** Updated all curl examples across README, CLAUDE.md, .ai/, CurlShowcase, API docs, MCP content, and meta tags to use `curl -s https://yoke.lol/...` format
- **Why:** Bare `curl yoke.lol/...` hits HTTP and doesn't follow the 301 redirect to HTTPS. Adding `-s` suppresses progress bars for cleaner piping to jq.
- **Directive:** All curl examples referencing yoke.lol must use explicit `https://` and `-s` flag.
