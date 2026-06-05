#!/usr/bin/env bash
# .ai/staleness-check.sh — Detect drift between .ai/ docs and the actual codebase.
# Run from repo root: bash .ai/staleness-check.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WARNINGS=0
warn() { echo "⚠️  STALE: $1"; ((WARNINGS++)); }
ok()   { echo "✅ OK: $1"; }

echo "═══ Yoke Staleness Check ═══"
echo ""

# ── 1. Signal count ──────────────────────────────────────────────────
ACTUAL_SIGNALS=$(node -e "
const fs = require('fs');
const c = fs.readFileSync('worker/src/config/signal-registry.ts','utf8');
const start = c.indexOf('SIGNAL_REGISTRY');
const sub = c.substring(start);
const m = sub.matchAll(/axis:\s*['\"](\w+)['\"]/g);
let count = 0; for (const _ of m) count++;
console.log(count);
")
STATE_SIGNALS=$(grep -oP 'Signal count \| \K[0-9]+' .ai/STATE.md 2>/dev/null || echo "0")

if [ "$ACTUAL_SIGNALS" != "$STATE_SIGNALS" ]; then
  warn "Signal count: STATE.md says $STATE_SIGNALS, code has $ACTUAL_SIGNALS"
else
  ok "Signal count: $ACTUAL_SIGNALS"
fi

# ── 2. ABSENT_DEDUCTION_FACTOR ───────────────────────────────────────
ACTUAL_ADF=$(grep -oP 'ABSENT_DEDUCTION_FACTOR\s*=\s*\K[0-9.]+' worker/src/actions/analyze/contextual-scoring.ts | head -1)
INVARIANT_ADF=$(grep -oP 'ABSENT_DEDUCTION_FACTOR = \K[0-9]+\.[0-9]+' .ai/INVARIANTS.md 2>/dev/null || echo "0")

if [ "$(echo "$ACTUAL_ADF" | sed 's/0*$//')" != "$(echo "$INVARIANT_ADF" | sed 's/0*$//')" ]; then
  warn "ABSENT_DEDUCTION_FACTOR: INVARIANTS.md says $INVARIANT_ADF, code has $ACTUAL_ADF"
else
  ok "ABSENT_DEDUCTION_FACTOR: $ACTUAL_ADF"
fi

# ── 3. Axis weight sum ───────────────────────────────────────────────
WEIGHT_SUM=$(node -e "
const fs = require('fs');
const c = fs.readFileSync('worker/src/config/signal-registry.ts','utf8');
const m = c.match(/AXIS_WEIGHTS[^}]*\{([^}]+)\}/s);
if (!m) { console.log('error'); process.exit(1); }
const nums = m[1].match(/:\s*([0-9.]+)/g).map(s => parseFloat(s.match(/[0-9.]+/)[0]));
console.log(nums.reduce((a,b)=>a+b,0).toFixed(2));
")

if [ "$WEIGHT_SUM" != "1.00" ]; then
  warn "Axis weights sum to $WEIGHT_SUM (should be 1.00)"
else
  ok "Axis weights sum: $WEIGHT_SUM"
fi

# ── 4. YOKE_VERSION ─────────────────────────────────────────────────
ACTUAL_VERSION=$(grep -oP 'YOKE_VERSION\s*=\s*"\K[^"]+' worker/src/helpers.ts)
STATE_VERSION=$(grep -oP 'Worker \(service\) \| \K[0-9.]+' .ai/STATE.md 2>/dev/null || echo "0")

if [ "$ACTUAL_VERSION" != "$STATE_VERSION" ]; then
  warn "Worker version: STATE.md says $STATE_VERSION, code has $ACTUAL_VERSION"
else
  ok "Worker version: $ACTUAL_VERSION"
fi

# ── 5. Test file count ───────────────────────────────────────────────
ACTUAL_TEST_FILES=$(ls tests/*.test.ts 2>/dev/null | wc -l | tr -d ' ')
STATE_TEST_FILES=$(grep -oP 'Test files \| \K[0-9]+' .ai/STATE.md 2>/dev/null || echo "0")

if [ "$ACTUAL_TEST_FILES" != "$STATE_TEST_FILES" ]; then
  warn "Test files: STATE.md says $STATE_TEST_FILES, found $ACTUAL_TEST_FILES"
else
  ok "Test files: $ACTUAL_TEST_FILES"
fi

# ── 6. Tier thresholds ──────────────────────────────────────────────
TIER_CHECK=$(node -e "
const fs = require('fs');
const c = fs.readFileSync('worker/src/config/signal-registry.ts','utf8');
const expected = [{tier:'Excellent',min:90},{tier:'Strong',min:78},{tier:'Moderate',min:60},{tier:'Weak',min:40},{tier:'Critical',min:0}];
let ok = true;
for (const e of expected) {
  if (!c.includes('\"' + e.tier + '\"') || !c.includes('min: ' + e.min)) {
    ok = false;
  }
}
console.log(ok ? 'ok' : 'mismatch');
")

if [ "$TIER_CHECK" != "ok" ]; then
  warn "Tier thresholds in code don't match INVARIANTS.md expectations"
else
  ok "Tier thresholds: Excellent≥90, Strong≥75, Moderate≥60, Weak≥40, Critical<40"
fi

# ── 7. No BASELINE constant ─────────────────────────────────────────
BASELINE_HITS=$(grep -rn "BASELINE\s*=" worker/src/ --include="*.ts" 2>/dev/null | grep -v "//\|node_modules\|\.test\." | wc -l)
BASELINE_HITS=$(echo "$BASELINE_HITS" | tr -d '[:space:]')

if [ "$BASELINE_HITS" != "0" ]; then
  warn "Found $BASELINE_HITS reference(s) to BASELINE constant in worker/src/ — should be 0 (deductive model)"
else
  ok "No BASELINE constant in worker/src/"
fi

# ── 8. No grade terminology in user-facing code ──────────────────────
GRADE_UP_HITS=$(grep -rni "grade.up\|gradeup\|grade_up" worker/src/ client/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "node_modules" | wc -l)
GRADE_UP_HITS=$(echo "$GRADE_UP_HITS" | tr -d '[:space:]')

if [ "$GRADE_UP_HITS" != "0" ]; then
  warn "Found $GRADE_UP_HITS 'Grade-Up' reference(s) — should be 'Level-Up'"
else
  ok "No Grade-Up references (Level-Up used consistently)"
fi

# ── 9. Internal docs tracked in git ──────────────────────────────────
INTERNAL_TRACKED=$(git ls-files docs/internal/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$INTERNAL_TRACKED" != "0" ]; then
  warn "Found $INTERNAL_TRACKED tracked file(s) in docs/internal/ — should be gitignored only"
else
  ok "No internal docs tracked in git"
fi

# ── 10. CLAUDE.md signal count ───────────────────────────────────────
if [ -f CLAUDE.md ]; then
  CLAUDE_SIGNALS=$(grep -oP '~?\K[0-9]+(?=\s*scoring signals)' CLAUDE.md 2>/dev/null || echo "0")
  if [ "$CLAUDE_SIGNALS" != "0" ] && [ "$CLAUDE_SIGNALS" != "$ACTUAL_SIGNALS" ]; then
    warn "CLAUDE.md says ~$CLAUDE_SIGNALS signals, code has $ACTUAL_SIGNALS"
  else
    ok "CLAUDE.md signal count"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
if [ "$WARNINGS" -gt 0 ]; then
  echo "🔴 $WARNINGS staleness warning(s) found. Update .ai/ files and/or CLAUDE.md."
  exit 1
else
  echo "🟢 All checks passed. Docs are in sync with code."
  exit 0
fi
