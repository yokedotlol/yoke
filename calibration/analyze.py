#!/usr/bin/env python3
"""
Yoke Scoring Calibration — Full Analysis Pipeline
Phases 2-7: Signal audit, distribution analysis, expectation mapping,
root cause analysis, calibration proposal, validation simulation.
"""
import json
import os
import glob
import math
from collections import defaultdict
from typing import Any

# ─── Configuration ───────────────────────────────────────────────────

AXES = ["security", "speed", "foundations", "reputation", "discoverability", "email"]
AXIS_WEIGHTS = {
    "security": 0.24, "speed": 0.18, "foundations": 0.18,
    "reputation": 0.15, "discoverability": 0.13, "email": 0.12
}

SCORING_BASELINE = 55
SEVERITY_PENALTY = {"critical": -4, "high": -2.5, "medium": -1.25, "low": -0.5, "info": 0, "good": 0}
GOOD_BONUS_MULT = 2  # good bonus = 2 * weight

TIER_THRESHOLDS = [
    ("Excellent", 90), ("Strong", 75), ("Moderate", 60), ("Weak", 40), ("Critical", 0)
]

# Expected tiers for calibration targets
EXPECTED_TIERS = {
    "stripe.com": "Excellent",      # World-class engineering
    "github.com": "Strong",         # Strong infra, some header gaps
    "cloudflare.com": "Strong",     # Infra company
    "vercel.com": "Strong",         # Modern infra company
    "google.com": "Strong",         # It's Google
    "apple.com": "Strong",          # Major tech
    "microsoft.com": "Strong",      # Enterprise giant
    "amazon.com": "Strong",         # Massive infra
    "netflix.com": "Strong",        # Good engineering
    "notion.so": "Strong",          # Modern SaaS
    "figma.com": "Strong",          # Design tool
    "slack.com": "Strong",          # Enterprise SaaS
    "shopify.com": "Strong",        # E-commerce platform
    "facebook.com": "Strong",       # Big tech
    "twitter.com": "Moderate",      # Has known issues
    "reddit.com": "Moderate",       # Mixed bag
    "wikipedia.org": "Strong",      # Well-maintained
    "youtube.com": "Strong",        # Google property
    "nytimes.com": "Strong",        # Major media
    "bbc.com": "Strong",            # Major media
    "usa.gov": "Strong",            # Government
    "nasa.gov": "Strong",           # Government
    "mit.edu": "Strong",            # University
    "stanford.edu": "Strong",       # University
    "yoke.lol": "Strong",           # Our site, well-configured
    "example.com": "Weak",          # Bare placeholder
    "firetanksoftware.com": "Weak", # Basic site
    "paulgraham.com": "Moderate",   # Personal site
    "danluu.com": "Moderate",       # Tech blog
}

def tier_from_score(score):
    for name, min_score in TIER_THRESHOLDS:
        if score >= min_score:
            return name
    return "Critical"

def compute_axis_score(findings):
    """Replicate the anchor-and-adjust scoring."""
    if not findings:
        return SCORING_BASELINE
    score = SCORING_BASELINE
    for f in findings:
        sev = f.get("severity", "info")
        w = f.get("weight", 1)
        if sev == "good":
            score += GOOD_BONUS_MULT * w
        elif sev != "info":
            penalty = SEVERITY_PENALTY.get(sev, -1)
            score += penalty * max(w, 1)
    return max(0, min(100, round(score)))

def weighted_geometric_mean(axis_scores, weights):
    """Compute weighted geometric mean."""
    total_weight = sum(weights.values())
    if total_weight == 0:
        return 0
    log_sum = 0
    used_weight = 0
    for axis, score in axis_scores.items():
        if score is None:
            continue
        w = weights.get(axis, 0)
        if w > 0 and score > 0:
            log_sum += w * math.log(score)
            used_weight += w
    if used_weight == 0:
        return 0
    return round(math.exp(log_sum / used_weight))


# ─── Load corpus ─────────────────────────────────────────────────────

def load_corpus():
    raw_dir = "yoke-public/calibration/raw"
    corpus = {}
    for fpath in sorted(glob.glob(os.path.join(raw_dir, "*.json"))):
        domain = os.path.basename(fpath).replace(".json", "")
        try:
            with open(fpath) as f:
                data = json.load(f)
            corpus[domain] = data
        except Exception as e:
            print(f"  Skip {domain}: {e}")
    return corpus


# ─── Phase 2: Signal Audit ──────────────────────────────────────────

def signal_audit(corpus):
    """Analyze signal firing patterns across the corpus."""
    # Collect all findings
    signal_fires = defaultdict(list)  # signal -> [(domain, severity, weight)]
    per_axis_findings = defaultdict(lambda: defaultdict(list))  # axis -> domain -> [findings]
    
    for domain, data in corpus.items():
        ds = data.get("domain_score", {})
        axes = ds.get("axes", {})
        for axis_name, axis_data in axes.items():
            findings = axis_data.get("findings", [])
            per_axis_findings[axis_name][domain] = findings
            for f in findings:
                sig = f.get("signal", "unknown")
                signal_fires[sig].append({
                    "domain": domain,
                    "severity": f.get("severity", "unknown"),
                    "weight": f.get("weight", 0),
                    "label": f.get("label", ""),
                })
    
    return signal_fires, per_axis_findings


def analyze_axis_ceilings(per_axis_findings, corpus):
    """For each axis, determine the realistic ceiling based on good-only signals."""
    results = {}
    
    for axis_name in AXES:
        # Collect all good findings across all domains for this axis
        all_good_signals = defaultdict(list)  # signal -> [weight]
        all_findings_by_domain = {}
        
        for domain, findings in per_axis_findings.get(axis_name, {}).items():
            all_findings_by_domain[domain] = findings
            for f in findings:
                if f.get("severity") == "good":
                    all_good_signals[f["signal"]].append(f.get("weight", 0))
        
        # Compute max possible from good signals
        max_good_bonus = 0
        good_signal_details = {}
        for sig, weights in all_good_signals.items():
            max_w = max(weights)
            max_good_bonus += GOOD_BONUS_MULT * max_w
            good_signal_details[sig] = {"max_weight": max_w, "bonus": GOOD_BONUS_MULT * max_w, "fire_count": len(weights)}
        
        theoretical_ceiling = min(100, SCORING_BASELINE + max_good_bonus)
        
        # Actual best score seen
        actual_scores = []
        for domain, findings in all_findings_by_domain.items():
            s = compute_axis_score(findings)
            actual_scores.append((domain, s, findings))
        actual_scores.sort(key=lambda x: x[1], reverse=True)
        
        results[axis_name] = {
            "theoretical_ceiling": theoretical_ceiling,
            "max_good_bonus": max_good_bonus,
            "good_signal_count": len(all_good_signals),
            "good_signal_details": good_signal_details,
            "top_5": [(d, s) for d, s, _ in actual_scores[:5]],
            "bottom_5": [(d, s) for d, s, _ in actual_scores[-5:]],
            "all_scores": {d: s for d, s, _ in actual_scores},
        }
    
    return results


# ─── Phase 3: Distribution Analysis ─────────────────────────────────

def distribution_analysis(corpus, axis_ceilings):
    """Analyze score distributions."""
    composites = []
    tier_counts = defaultdict(int)
    axis_score_lists = defaultdict(list)
    
    for domain, data in corpus.items():
        ds = data.get("domain_score", {})
        comp = ds.get("composite")
        tier = ds.get("tier", "?")
        if comp is not None:
            composites.append((domain, comp, tier))
            tier_counts[tier] += 1
        
        axes = ds.get("axes", {})
        for axis_name in AXES:
            ax = axes.get(axis_name, {})
            score = ax.get("score")
            nm = ax.get("not_measured", False)
            if score is not None and not nm:
                axis_score_lists[axis_name].append((domain, score))
    
    composites.sort(key=lambda x: x[1], reverse=True)
    
    # Per-axis stats
    axis_stats = {}
    for axis_name in AXES:
        scores = [s for _, s in axis_score_lists[axis_name]]
        if scores:
            axis_stats[axis_name] = {
                "count": len(scores),
                "min": min(scores),
                "max": max(scores),
                "mean": round(sum(scores) / len(scores), 1),
                "median": sorted(scores)[len(scores) // 2],
                "theoretical_ceiling": axis_ceilings.get(axis_name, {}).get("theoretical_ceiling", "?"),
                "pct_excellent": round(100 * sum(1 for s in scores if s >= 90) / len(scores), 1),
                "pct_strong": round(100 * sum(1 for s in scores if 75 <= s < 90) / len(scores), 1),
                "pct_moderate": round(100 * sum(1 for s in scores if 60 <= s < 75) / len(scores), 1),
                "pct_weak": round(100 * sum(1 for s in scores if 40 <= s < 60) / len(scores), 1),
                "pct_critical": round(100 * sum(1 for s in scores if s < 40) / len(scores), 1),
            }
    
    return {
        "composites": composites,
        "tier_counts": dict(tier_counts),
        "axis_stats": axis_stats,
        "axis_score_lists": {k: v for k, v in axis_score_lists.items()},
    }


# ─── Phase 4: Expectation Mapping ───────────────────────────────────

def expectation_mapping(corpus):
    """Compare actual tiers to expected tiers."""
    gaps = []
    for domain, expected_tier in EXPECTED_TIERS.items():
        if domain not in corpus:
            continue
        ds = corpus[domain].get("domain_score", {})
        actual_tier = ds.get("tier", "?")
        composite = ds.get("composite", 0)
        
        tier_order = ["Critical", "Weak", "Moderate", "Strong", "Excellent"]
        expected_idx = tier_order.index(expected_tier) if expected_tier in tier_order else -1
        actual_idx = tier_order.index(actual_tier) if actual_tier in tier_order else -1
        
        gap = expected_idx - actual_idx
        gaps.append({
            "domain": domain,
            "expected": expected_tier,
            "actual": actual_tier,
            "composite": composite,
            "gap": gap,  # positive = underscored, negative = overscored
        })
    
    gaps.sort(key=lambda x: -abs(x["gap"]))
    return gaps


# ─── Phase 5: Root Cause Analysis ───────────────────────────────────

def root_cause_analysis(axis_ceilings, distribution, corpus):
    """Identify root causes for calibration problems."""
    problems = []
    
    for axis_name in AXES:
        ceiling = axis_ceilings.get(axis_name, {})
        stats = distribution["axis_stats"].get(axis_name, {})
        
        theoretical = ceiling.get("theoretical_ceiling", 100)
        
        # Problem 1: Unreachable Excellent tier
        if theoretical < 90:
            problems.append({
                "axis": axis_name,
                "type": "ceiling_too_low",
                "description": f"{axis_name} theoretical ceiling is {theoretical}, below Excellent (90). "
                               f"Good signals total bonus: +{ceiling.get('max_good_bonus', 0)} from baseline {SCORING_BASELINE}.",
                "severity": "high" if theoretical < 80 else "medium",
                "good_signals": ceiling.get("good_signal_details", {}),
            })
        
        # Problem 2: Bunched distribution (most scores in narrow range)
        if stats:
            score_range = stats["max"] - stats["min"]
            if score_range < 30 and stats["count"] > 5:
                problems.append({
                    "axis": axis_name,
                    "type": "narrow_distribution",
                    "description": f"{axis_name} scores bunched in {stats['min']}-{stats['max']} range "
                                   f"(spread={score_range}). Mean={stats['mean']}, median={stats['median']}.",
                    "severity": "medium",
                })
        
        # Problem 3: No domains reach Excellent
        if stats and stats.get("pct_excellent", 0) == 0:
            problems.append({
                "axis": axis_name,
                "type": "no_excellent",
                "description": f"No domains in corpus reach Excellent (≥90) on {axis_name}. "
                               f"Max observed: {stats['max']}. Ceiling: {theoretical}.",
                "severity": "high" if theoretical >= 90 else "info",
            })
    
    return problems


# ─── Phase 6: Calibration Proposal ──────────────────────────────────

def generate_proposals(axis_ceilings, distribution, problems, corpus, signal_fires):
    """Generate specific calibration change proposals."""
    proposals = []
    
    for axis_name in AXES:
        ceiling_info = axis_ceilings.get(axis_name, {})
        theoretical = ceiling_info.get("theoretical_ceiling", 100)
        
        if theoretical >= 92:
            continue  # This axis can already reach Excellent
        
        # Calculate how much additional bonus we need
        target_ceiling = 95  # Aim for a good site to hit 95
        deficit = target_ceiling - theoretical
        
        # Strategy: increase weights on key good-only signals
        good_details = ceiling_info.get("good_signal_details", {})
        
        # Sort signals by fire count (more common = safer to boost)
        sorted_signals = sorted(good_details.items(), key=lambda x: -x[1]["fire_count"])
        
        axis_proposals = []
        remaining_deficit = deficit
        
        for sig, info in sorted_signals:
            if remaining_deficit <= 0:
                break
            
            current_w = info["max_weight"]
            # Boost by 1-2 depending on importance
            boost = min(2, math.ceil(remaining_deficit / (2 * 2)))  # Each weight+1 gives +2 bonus
            new_w = current_w + boost
            
            new_bonus = GOOD_BONUS_MULT * new_w
            old_bonus = GOOD_BONUS_MULT * current_w
            delta = new_bonus - old_bonus
            
            axis_proposals.append({
                "signal": sig,
                "axis": axis_name,
                "old_weight": current_w,
                "new_weight": new_w,
                "bonus_delta": delta,
                "fire_count": info["fire_count"],
                "rationale": f"Increase weight from {current_w} to {new_w} to raise {axis_name} ceiling by +{delta}",
            })
            
            remaining_deficit -= delta
        
        proposals.extend(axis_proposals)
    
    return proposals


# ─── Phase 7: Validation Simulation ─────────────────────────────────

def simulate_changes(corpus, proposals, per_axis_findings):
    """Re-score all domains with proposed weight changes and compare."""
    # Build weight adjustment map: signal -> new_weight
    weight_changes = {p["signal"]: p["new_weight"] for p in proposals}
    
    results = []
    
    for domain, data in corpus.items():
        ds = data.get("domain_score", {})
        old_composite = ds.get("composite", 0)
        old_tier = ds.get("tier", "?")
        
        old_axes = ds.get("axes", {})
        new_axis_scores = {}
        old_axis_scores = {}
        
        for axis_name in AXES:
            ax = old_axes.get(axis_name, {})
            old_score = ax.get("score")
            nm = ax.get("not_measured", False)
            
            if old_score is None or nm:
                old_axis_scores[axis_name] = None
                new_axis_scores[axis_name] = None
                continue
            
            old_axis_scores[axis_name] = old_score
            
            # Get findings and apply weight changes
            findings = ax.get("findings", [])
            adjusted_findings = []
            for f in findings:
                af = dict(f)
                sig = af.get("signal", "")
                if sig in weight_changes and af.get("severity") == "good":
                    af["weight"] = weight_changes[sig]
                adjusted_findings.append(af)
            
            new_axis_scores[axis_name] = compute_axis_score(adjusted_findings)
        
        # Compute new composite using weighted geometric mean
        valid_old = {k: v for k, v in old_axis_scores.items() if v is not None}
        valid_new = {k: v for k, v in new_axis_scores.items() if v is not None}
        
        if valid_new:
            new_composite = weighted_geometric_mean(valid_new, AXIS_WEIGHTS)
        else:
            new_composite = 0
        
        new_tier = tier_from_score(new_composite)
        
        results.append({
            "domain": domain,
            "old_composite": old_composite,
            "new_composite": new_composite,
            "delta": new_composite - old_composite,
            "old_tier": old_tier,
            "new_tier": new_tier,
            "tier_changed": old_tier != new_tier,
            "old_axes": old_axis_scores,
            "new_axes": new_axis_scores,
        })
    
    results.sort(key=lambda x: -abs(x["delta"]))
    return results


# ─── Report Generation ───────────────────────────────────────────────

def generate_report(corpus, signal_fires, per_axis_findings, axis_ceilings, 
                    distribution, gaps, problems, proposals, simulation):
    """Generate the comprehensive calibration report."""
    lines = []
    
    lines.append("# Yoke Scoring Calibration Report")
    lines.append(f"\n**Date:** 2026-05-31")
    lines.append(f"**Corpus size:** {len(corpus)} domains")
    lines.append(f"**Scoring model:** Anchor-and-adjust (baseline={SCORING_BASELINE}), "
                 f"good bonus=2×weight, weighted geometric mean composite")
    lines.append("")
    
    # ─── Executive Summary ───────────────────────────────────────────
    lines.append("## 1. Executive Summary")
    lines.append("")
    
    ceiling_problems = [p for p in problems if p["type"] == "ceiling_too_low"]
    lines.append(f"**{len(ceiling_problems)} of 6 axes** have theoretical ceilings below the Excellent tier (90). "
                 "This means even a perfectly-configured site cannot reach Excellent on these axes.")
    lines.append("")
    lines.append("| Axis | Theoretical Ceiling | Deficit to 90 |")
    lines.append("|------|-------------------|---------------|")
    for axis_name in AXES:
        c = axis_ceilings.get(axis_name, {}).get("theoretical_ceiling", "?")
        deficit = max(0, 90 - c) if isinstance(c, (int, float)) else "?"
        marker = " ⚠️" if isinstance(c, (int, float)) and c < 90 else " ✅"
        lines.append(f"| {axis_name} | {c}{marker} | {deficit if deficit else '—'} |")
    lines.append("")
    
    # Tier distribution
    tc = distribution["tier_counts"]
    total = sum(tc.values())
    lines.append("**Corpus tier distribution:**")
    for tier_name in ["Excellent", "Strong", "Moderate", "Weak", "Critical"]:
        cnt = tc.get(tier_name, 0)
        pct = round(100 * cnt / total, 1) if total else 0
        lines.append(f"- {tier_name}: {cnt} ({pct}%)")
    lines.append("")
    
    # ─── Corpus Analysis ─────────────────────────────────────────────
    lines.append("## 2. Corpus Analysis")
    lines.append("")
    lines.append("### 2.1 All Domain Scores")
    lines.append("")
    lines.append("| Domain | Composite | Tier | Security | Speed | Foundations | Reputation | Discovery | Email |")
    lines.append("|--------|-----------|------|----------|-------|-------------|------------|-----------|-------|")
    
    sorted_domains = sorted(corpus.keys(), 
                           key=lambda d: corpus[d].get("domain_score", {}).get("composite", 0), 
                           reverse=True)
    for domain in sorted_domains:
        ds = corpus[domain].get("domain_score", {})
        comp = ds.get("composite", "?")
        tier = ds.get("tier", "?")
        axes = ds.get("axes", {})
        scores = []
        for ax in AXES:
            a = axes.get(ax, {})
            s = a.get("score")
            nm = a.get("not_measured", False)
            scores.append("N/A" if (s is None or nm) else str(s))
        lines.append(f"| {domain} | {comp} | {tier} | {' | '.join(scores)} |")
    lines.append("")
    
    # ─── Per-Axis Analysis ───────────────────────────────────────────
    lines.append("### 2.2 Per-Axis Score Distribution")
    lines.append("")
    lines.append("| Axis | Min | Max | Mean | Median | Ceiling | %Excellent | %Strong | %Moderate | %Weak |")
    lines.append("|------|-----|-----|------|--------|---------|------------|---------|-----------|-------|")
    for axis_name in AXES:
        s = distribution["axis_stats"].get(axis_name, {})
        if s:
            lines.append(f"| {axis_name} | {s['min']} | {s['max']} | {s['mean']} | {s['median']} | "
                        f"{s['theoretical_ceiling']} | {s['pct_excellent']}% | {s['pct_strong']}% | "
                        f"{s['pct_moderate']}% | {s['pct_weak']}% |")
    lines.append("")
    
    # ─── Ceiling Analysis ────────────────────────────────────────────
    lines.append("### 2.3 Per-Axis Ceiling Analysis")
    lines.append("")
    for axis_name in AXES:
        c = axis_ceilings.get(axis_name, {})
        lines.append(f"#### {axis_name.title()} (Ceiling: {c.get('theoretical_ceiling', '?')})")
        lines.append("")
        lines.append(f"Good signals contributing to ceiling ({c.get('good_signal_count', 0)} total):")
        lines.append("")
        lines.append("| Signal | Max Weight | Bonus | Fire Count (of {}) |".format(len(corpus)))
        lines.append("|--------|-----------|-------|---------------------|")
        gd = c.get("good_signal_details", {})
        for sig, info in sorted(gd.items(), key=lambda x: -x[1]["bonus"]):
            lines.append(f"| {sig} | {info['max_weight']} | +{info['bonus']} | {info['fire_count']} |")
        lines.append(f"\n**Total good bonus:** +{c.get('max_good_bonus', 0)} → ceiling = {SCORING_BASELINE} + {c.get('max_good_bonus', 0)} = {c.get('theoretical_ceiling', '?')}")
        lines.append(f"\n**Top 5 actual scores:** {', '.join(f'{d} ({s})' for d, s in c.get('top_5', []))}")
        lines.append(f"**Bottom 5 actual scores:** {', '.join(f'{d} ({s})' for d, s in c.get('bottom_5', []))}")
        lines.append("")
    
    # ─── Signal Coverage Matrix ──────────────────────────────────────
    lines.append("### 2.4 Signal Coverage")
    lines.append("")
    lines.append(f"Total unique signals fired across corpus: {len(signal_fires)}")
    lines.append("")
    
    # Signals that never fired
    # We'd need the full registry to compare — just list what we have
    rarely_fired = [(sig, data) for sig, data in signal_fires.items() if len(data) <= 2]
    if rarely_fired:
        lines.append("**Rarely-fired signals (≤2 domains):**")
        for sig, data in sorted(rarely_fired, key=lambda x: len(x[1])):
            domains = [d["domain"] for d in data]
            lines.append(f"- `{sig}`: {len(data)} fires ({', '.join(domains[:3])})")
        lines.append("")
    
    # ─── Expectation Gaps ────────────────────────────────────────────
    lines.append("## 3. Expectation Mapping")
    lines.append("")
    lines.append("| Domain | Expected | Actual | Composite | Gap |")
    lines.append("|--------|----------|--------|-----------|-----|")
    for g in gaps:
        gap_str = "✅ match" if g["gap"] == 0 else f"{'⬇️' if g['gap'] > 0 else '⬆️'} {abs(g['gap'])} tier{'s' if abs(g['gap'])>1 else ''}"
        lines.append(f"| {g['domain']} | {g['expected']} | {g['actual']} | {g['composite']} | {gap_str} |")
    lines.append("")
    
    mismatches = [g for g in gaps if g["gap"] != 0]
    lines.append(f"**{len(mismatches)} of {len(gaps)} reference domains** are miscalibrated.")
    lines.append("")
    
    # ─── Problems ────────────────────────────────────────────────────
    lines.append("## 4. Calibration Problems Identified")
    lines.append("")
    for i, p in enumerate(problems, 1):
        lines.append(f"### Problem {i}: {p['type']} ({p['axis']})")
        lines.append(f"**Severity:** {p.get('severity', '?')}")
        lines.append(f"\n{p['description']}")
        lines.append("")
    
    # ─── Proposals ───────────────────────────────────────────────────
    lines.append("## 5. Calibration Proposals")
    lines.append("")
    if proposals:
        lines.append("| # | Signal | Axis | Old Weight | New Weight | Bonus Δ | Fires in corpus |")
        lines.append("|---|--------|------|-----------|-----------|---------|-----------------|")
        for i, p in enumerate(proposals, 1):
            lines.append(f"| {i} | `{p['signal']}` | {p['axis']} | {p['old_weight']} | {p['new_weight']} | +{p['bonus_delta']} | {p['fire_count']} |")
        lines.append("")
        
        # New ceilings after proposals
        lines.append("### New Axis Ceilings After Proposals")
        lines.append("")
        for axis_name in AXES:
            c = axis_ceilings.get(axis_name, {})
            old_ceiling = c.get("theoretical_ceiling", "?")
            axis_proposals = [p for p in proposals if p["axis"] == axis_name]
            extra_bonus = sum(p["bonus_delta"] for p in axis_proposals)
            new_ceiling = min(100, old_ceiling + extra_bonus) if isinstance(old_ceiling, (int, float)) else "?"
            if axis_proposals:
                lines.append(f"- **{axis_name}**: {old_ceiling} → {new_ceiling} (+{extra_bonus})")
            else:
                lines.append(f"- **{axis_name}**: {old_ceiling} (unchanged)")
        lines.append("")
    
    # ─── Simulation Results ──────────────────────────────────────────
    lines.append("## 6. Simulation: Before vs After")
    lines.append("")
    lines.append("| Domain | Old Composite | New Composite | Δ | Old Tier | New Tier |")
    lines.append("|--------|--------------|--------------|---|---------|---------|")
    for r in sorted(simulation, key=lambda x: -x.get("new_composite", 0)):
        changed = " 🔄" if r["tier_changed"] else ""
        delta_str = f"+{r['delta']}" if r['delta'] > 0 else str(r['delta'])
        lines.append(f"| {r['domain']} | {r['old_composite']} | {r['new_composite']} | {delta_str} | {r['old_tier']} | {r['new_tier']}{changed} |")
    lines.append("")
    
    # Tier distribution comparison
    old_tiers = defaultdict(int)
    new_tiers = defaultdict(int)
    for r in simulation:
        old_tiers[r["old_tier"]] += 1
        new_tiers[r["new_tier"]] += 1
    
    lines.append("### Tier Distribution Comparison")
    lines.append("")
    lines.append("| Tier | Before | After | Change |")
    lines.append("|------|--------|-------|--------|")
    for tier_name in ["Excellent", "Strong", "Moderate", "Weak", "Critical"]:
        old = old_tiers.get(tier_name, 0)
        new = new_tiers.get(tier_name, 0)
        delta = new - old
        delta_str = f"+{delta}" if delta > 0 else str(delta) if delta < 0 else "—"
        lines.append(f"| {tier_name} | {old} | {new} | {delta_str} |")
    lines.append("")
    
    # ─── Expectation Gap Check ───────────────────────────────────────
    lines.append("### Expectation Gap After Calibration")
    lines.append("")
    sim_map = {r["domain"]: r for r in simulation}
    new_gaps = 0
    fixed_gaps = 0
    for g in gaps:
        if g["domain"] in sim_map:
            r = sim_map[g["domain"]]
            new_tier = r["new_tier"]
            expected = g["expected"]
            tier_order = ["Critical", "Weak", "Moderate", "Strong", "Excellent"]
            new_gap = tier_order.index(expected) - tier_order.index(new_tier) if new_tier in tier_order else 0
            old_gap = g["gap"]
            if new_gap == 0 and old_gap != 0:
                fixed_gaps += 1
            if new_gap != 0:
                new_gaps += 1
    
    lines.append(f"- Expectation gaps fixed: {fixed_gaps}")
    lines.append(f"- Remaining gaps: {new_gaps}")
    lines.append("")
    
    # ─── Per-Axis Detailed Changes ───────────────────────────────────
    lines.append("## 7. Per-Axis Score Changes")
    lines.append("")
    for axis_name in AXES:
        axis_changes = []
        for r in simulation:
            old_s = r["old_axes"].get(axis_name)
            new_s = r["new_axes"].get(axis_name)
            if old_s is not None and new_s is not None and old_s != new_s:
                axis_changes.append((r["domain"], old_s, new_s, new_s - old_s))
        
        if axis_changes:
            lines.append(f"### {axis_name.title()}")
            lines.append("")
            lines.append("| Domain | Old | New | Δ |")
            lines.append("|--------|-----|-----|---|")
            for d, old, new, delta in sorted(axis_changes, key=lambda x: -x[3]):
                delta_str = f"+{delta}" if delta > 0 else str(delta)
                lines.append(f"| {d} | {old} | {new} | {delta_str} |")
            lines.append("")
    
    # ─── Confidence Assessment ───────────────────────────────────────
    lines.append("## 8. Confidence Assessment & Risks")
    lines.append("")
    lines.append("### Confidence: Medium-High")
    lines.append("")
    lines.append("**Strengths of this analysis:**")
    lines.append("- Based on real data from {} domains spanning all archetypes".format(len(corpus)))
    lines.append("- Proposals are conservative (weight adjustments only, no model changes)")
    lines.append("- Simulation validates impact before implementation")
    lines.append("")
    lines.append("**Risks:**")
    lines.append("- Corpus is point-in-time; scores change as sites update")
    lines.append("- Speed axis scores depend on external PageSpeed API data")
    lines.append("- Some signals may fire differently with different probe locations")
    lines.append("- Weight changes affect all domains, not just reference set")
    lines.append("")
    lines.append("**Recommended next steps:**")
    lines.append("1. Review proposals with domain expertise")
    lines.append("2. Implement weight changes in signal-registry.ts")
    lines.append("3. Run test suite to verify no regressions")
    lines.append("4. Re-fetch corpus post-deploy and compare")
    lines.append("")
    
    return "\n".join(lines)


# ─── Main ────────────────────────────────────────────────────────────

def main():
    print("Loading corpus...")
    corpus = load_corpus()
    print(f"  Loaded {len(corpus)} domains")
    
    if len(corpus) < 10:
        print("  WARNING: Small corpus. Results may be unreliable.")
    
    print("\nPhase 2: Signal Audit...")
    signal_fires, per_axis_findings = signal_audit(corpus)
    print(f"  {len(signal_fires)} unique signals fired")
    
    print("\nPhase 2b: Axis Ceiling Analysis...")
    axis_ceilings = analyze_axis_ceilings(per_axis_findings, corpus)
    for ax in AXES:
        c = axis_ceilings[ax]
        print(f"  {ax:18} ceiling={c['theoretical_ceiling']:3}  "
              f"good_signals={c['good_signal_count']:2}  "
              f"top={c['top_5'][0][1] if c['top_5'] else '?'}")
    
    print("\nPhase 3: Distribution Analysis...")
    distribution = distribution_analysis(corpus, axis_ceilings)
    tc = distribution["tier_counts"]
    print(f"  Tier distribution: {dict(tc)}")
    
    print("\nPhase 4: Expectation Mapping...")
    gaps = expectation_mapping(corpus)
    mismatches = [g for g in gaps if g["gap"] != 0]
    print(f"  {len(mismatches)} expectation gaps found")
    for g in mismatches[:5]:
        print(f"    {g['domain']}: expected {g['expected']}, got {g['actual']} ({g['composite']})")
    
    print("\nPhase 5: Root Cause Analysis...")
    problems = root_cause_analysis(axis_ceilings, distribution, corpus)
    print(f"  {len(problems)} calibration problems identified")
    for p in problems:
        print(f"    [{p['severity']}] {p['axis']}: {p['type']}")
    
    print("\nPhase 6: Generating Calibration Proposals...")
    proposals = generate_proposals(axis_ceilings, distribution, problems, corpus, signal_fires)
    print(f"  {len(proposals)} weight changes proposed")
    for p in proposals:
        print(f"    {p['signal']:30} {p['axis']:15} {p['old_weight']}→{p['new_weight']} (+{p['bonus_delta']})")
    
    print("\nPhase 7: Simulation...")
    simulation = simulate_changes(corpus, proposals, per_axis_findings)
    tier_changes = sum(1 for r in simulation if r["tier_changed"])
    print(f"  {tier_changes} domains changed tier")
    avg_delta = sum(r["delta"] for r in simulation) / len(simulation) if simulation else 0
    print(f"  Average composite change: {avg_delta:+.1f}")
    
    print("\nGenerating report...")
    report = generate_report(corpus, signal_fires, per_axis_findings, axis_ceilings,
                           distribution, gaps, problems, proposals, simulation)
    
    with open("yoke-public/calibration/CALIBRATION-REPORT.md", "w") as f:
        f.write(report)
    print("  Saved CALIBRATION-REPORT.md")
    
    # Also save raw analysis data
    analysis_data = {
        "axis_ceilings": {k: {kk: vv for kk, vv in v.items() if kk != "all_scores"} 
                         for k, v in axis_ceilings.items()},
        "distribution_stats": distribution["axis_stats"],
        "tier_counts": distribution["tier_counts"],
        "composites": distribution["composites"],
        "expectation_gaps": gaps,
        "problems": [{"axis": p["axis"], "type": p["type"], "description": p["description"], 
                      "severity": p.get("severity")} for p in problems],
        "proposals": proposals,
        "simulation_summary": {
            "tier_changes": tier_changes,
            "avg_delta": round(avg_delta, 1),
        },
    }
    with open("yoke-public/calibration/analysis-data.json", "w") as f:
        json.dump(analysis_data, f, indent=2)
    print("  Saved analysis-data.json")

if __name__ == "__main__":
    main()
