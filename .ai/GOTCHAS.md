# Yoke — Gotchas

> Lessons learned the hard way. Every "don't" is paired with a "do."
> Append new entries when a mistake is discovered. Never remove entries.

---

### Client-side scoring diverged from server

**What happened:** After switching the server to deductive scoring (start at 100, subtract), the client-side scoring code still used `BASELINE = 55` with anchor-and-adjust logic. Scores displayed in the browser didn't match API responses.

**Don't:** Change the scoring model in one place and assume the other is in sync.
**Do:** When changing scoring logic, always update BOTH `contextual-scoring.ts` (server) AND the client-side scoring in `client/src/`. Search the entire codebase for the old pattern before closing the task.

---

### Internal docs committed to public repo

**What happened:** `SCORING-CALIBRATION.md` (containing internal scoring methodology and calibration notes) was committed to the public repo at least 4 times across different sprints.

**Don't:** `git add` any `.md` file without asking: "Is this code documentation or internal work product?"
**Do:** Code docs (README, API docs, CHANGELOG, CONTRIBUTING, .ai/ files) go in the repo. Everything else (calibration methodology, audit reports, scoring rationale, planning notes) goes to `~/workspace/yoke-internal/`, never committed. When in doubt, it's internal.

---

### Signals double-emitting

**What happened:** `bimi_record` and `mta_sts` were each emitting their signal twice in a single scan, causing inflated deductions and incorrect axis scores.

**Don't:** Copy-paste signal emission blocks without checking for duplicates.
**Do:** The signal uniqueness CI test (`signal-registry.test.ts`) now catches this automatically. Always run `npx vitest run` after adding or modifying signal emissions.

---

### presentWeight counted all signals instead of canBeGood only

**What happened:** The denominator for "how much weight is actually being assessed" included signals that can never be `good` (penalty-only signals). This inflated the possible-points pool and deflated scores.

**Don't:** Include non-canBeGood signals in weight budget calculations.
**Do:** `presentWeight` must only sum weights for signals where `canBeGood: true`. The `AXIS_MAX_GOOD_WEIGHT` constant in signal-registry.ts handles this correctly now.

---

### email_trust used as a positive signal

**What happened:** `email_trust` was being treated as a signal that could contribute positively to the Email axis score. In reality, it should only penalize — it's a drag signal, not an achievement.

**Don't:** Assume every signal can swing both ways.
**Do:** Check `canBeGood` and `canBeNonGood` flags in the signal registry when working with scoring logic. Penalty-only signals have `canBeGood: false`.

---

### WordPress signals with zero weight

**What happened:** `wp_user_enumeration` was in the signal registry with `weightRange: [0, 0]`, meaning it was detected and displayed but had zero scoring impact. Users saw it flagged but it didn't affect their score — confusing.

**Don't:** Add signals to the registry with zero weight unless they're explicitly display-only (and documented as such).
**Do:** If a signal matters enough to flag, give it a non-zero weight. If detection is unreliable, leave it at `[0, 0]` but document why (see `wp_xmlrpc_enabled` and `wp_version_exposed`).

---

### Dead code accumulates silently

**What happened:** After removing `/api/recent`, the `RecentLookups` component and `recent:index` KV writes remained. After removing anchor-and-adjust scoring, ~110 lines of `applyAbsencePenalties` stayed. Dead code confuses future agents who see it and assume it's active.

**Don't:** Leave dead code after removing features.
**Do:** When removing a feature, grep the entire codebase for references: function calls, imports, component references, KV keys, D1 queries, API routes, test mocks. Remove them all in the same commit.

---

### Canny links survived platform migration

**What happened:** After switching from Canny to GitHub Issues for feedback, Canny links remained in the footer and About page. Users clicking "Feedback" got a 404 on Canny.

**Don't:** Migrate platforms and only update the obvious references.
**Do:** `grep -r "canny\|feedback\.yoke" --include="*.ts" --include="*.tsx" --include="*.html"` after any platform migration. Same applies to any external service change.

---

### console.log left in production code

**What happened:** Debug `console.log` statements were committed and deployed. They clutter CF Worker logs and can leak internal state.

**Don't:** Use `console.log` for debugging and forget to remove it.
**Do:** Use the structured logger (`worker/src/logger.ts`) for intentional logging. The Biome linter config should catch bare `console.log` — if it doesn't, that's a config bug.

---

### Stale CLAUDE.md causes agent confusion

**What happened:** CLAUDE.md referenced "5 axes" and "~136 signals" long after the project had 6 axes and 155 signals. Agents reading it as authoritative context produced work based on outdated assumptions.

**Don't:** Treat CLAUDE.md as a write-once file.
**Do:** Update CLAUDE.md when the project state changes significantly. Run `.ai/staleness-check.sh` to detect drift. The `.ai/STATE.md` file is the volatile snapshot; CLAUDE.md should point agents there.

---

### Subagents don't inherit context files

**What happened:** Spawned subagents have transcript context but don't automatically read MEMORY.md, CLAUDE.md, or `.ai/` files. They make decisions based on incomplete context, sometimes reverting agreed-upon changes.

**Don't:** Assume subagents know project invariants or recent decisions.
**Do:** When spawning subagents for Yoke work, explicitly include relevant invariants and recent decisions in the task instructions. At minimum, summarize the key points from `.ai/INVARIANTS.md`.
