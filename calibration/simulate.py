#!/usr/bin/env python3
"""
Yoke Scoring Calibration — Simulation
Applies proposed weight changes and compares before/after scores.
"""
import json
import glob
import os
import math
from collections import defaultdict

AXES = ["security", "speed", "foundations", "reputation", "discoverability", "email"]
AXIS_WEIGHTS = {
    "security": 0.24, "speed": 0.18, "foundations": 0.18,
    "reputation": 0.15, "discoverability": 0.13, "email": 0.12
}
BASELINE = 55

SEVERITY_PENALTY = {"critical": -4, "high": -2.5, "medium": -1.25, "low": -0.5, "info": 0, "good": 0}

# Proposed weight changes: signal -> new_weight
WEIGHT_CHANGES = {
    # Foundations
    "cdn": 3,
    "http3": 3,
    "tcp_connection_time": 3,
    "dns_resolution_time": 3,
    # Reputation
    "domain_age_trust": 4,
    "blocklist_trust": 3,
    "organizational_identity": 3,
    "cookie_consent_cmp": 3,
}

# Absence penalty adjustments (foundations)
# cdn absence penalty is -4, but since cdn weight increases, let's keep the absence penalty as-is
# These are hardcoded in EXPECTED_BASELINES, not derived from signal weight

def compute_axis_score(findings):
    if not findings:
        return BASELINE
    score = BASELINE
    for f in findings:
        sev = f.get("severity", "info")
        w = f.get("weight", 1)
        if sev == "good":
            score += 2 * w
        elif sev != "info":
            score += SEVERITY_PENALTY.get(sev, -1) * max(w, 1)
    return max(0, min(100, round(score)))

def compute_composite(axis_scores):
    """Weighted geometric mean with weight re-normalization for missing axes."""
    log_sum = 0
    total_weight = 0
    for axis in AXES:
        s = axis_scores.get(axis)
        if s is None:
            continue
        s = max(s, 1)
        w = AXIS_WEIGHTS[axis]
        log_sum += w * math.log(s)
        total_weight += w
    if total_weight == 0:
        return 0
    # Re-normalize: divide by total weight of measured axes
    return max(0, min(100, round(math.exp(log_sum / total_weight))))

def tier_from_score(score):
    if score >= 90: return "Excellent"
    if score >= 75: return "Strong"
    if score >= 60: return "Moderate"
    if score >= 40: return "Weak"
    return "Critical"

def apply_absence_penalties(score, axis, findings, all_findings):
    """Replicate the absence penalty logic."""
    baselines = {
        "security": [
            {"signal": "hsts", "penalty": -3, "requires_http": True},
            {"signal": "http_to_https_redirect", "penalty": -3, "requires_http": True},
        ],
        "email": [
            {"signal": "email_auth", "penalty": -4},
            {"signal": "dmarc_reject", "penalty": -3},
        ],
        "foundations": [
            {"signal": "cdn", "penalty": -4, "requires_http": True},
            {"signal": "http2", "penalty": -3, "also_satisfied_by": ["http3"], "requires_http": True},
            {"signal": "ipv6", "penalty": -2},
        ],
        "reputation": [
            {"signal": "organizational_identity", "penalty": -2, "requires_http": True},
        ],
    }
    
    axis_baselines = baselines.get(axis, [])
    if not axis_baselines:
        return score
    
    signal_keys = {f.get("signal") for f in findings}
    all_signal_keys = {f.get("signal") for f in all_findings}
    
    http_blocked = any(s in all_signal_keys for s in [
        "site_unreachable", "http_blocked_security", 
        "http_blocked_infrastructure", "http_blocked_performance"
    ])
    
    adjusted = score
    for bl in axis_baselines:
        if bl.get("requires_http") and http_blocked:
            continue
        if bl["signal"] in signal_keys:
            continue
        alts = bl.get("also_satisfied_by", [])
        if any(alt in signal_keys for alt in alts):
            continue
        adjusted += bl["penalty"]
    
    return max(0, min(100, round(adjusted)))

def main():
    raw_dir = "yoke-public/calibration/raw"
    results = []
    
    for fpath in sorted(glob.glob(os.path.join(raw_dir, "*.json"))):
        domain = os.path.basename(fpath).replace(".json", "")
        data = json.load(open(fpath))
        ds = data.get("domain_score", {})
        old_composite = ds.get("composite", 0)
        old_tier = ds.get("tier", "?")
        axes = ds.get("axes", {})
        
        # Collect all findings for absence penalty logic
        all_findings = []
        for ax_data in axes.values():
            all_findings.extend(ax_data.get("findings", []))
        
        old_axis_scores = {}
        new_axis_scores = {}
        
        for axis_name in AXES:
            ax = axes.get(axis_name, {})
            old_score = ax.get("score")
            nm = ax.get("not_measured", False)
            
            if old_score is None or nm:
                old_axis_scores[axis_name] = None
                new_axis_scores[axis_name] = None
                continue
            
            old_axis_scores[axis_name] = old_score
            
            findings = ax.get("findings", [])
            
            # Apply weight changes to good findings only
            adjusted_findings = []
            for f in findings:
                af = dict(f)
                sig = af.get("signal", "")
                if sig in WEIGHT_CHANGES and af.get("severity") == "good":
                    af["weight"] = WEIGHT_CHANGES[sig]
                adjusted_findings.append(af)
            
            # Compute new axis score
            raw_score = compute_axis_score(adjusted_findings)
            
            # Apply absence penalties
            new_score = apply_absence_penalties(raw_score, axis_name, adjusted_findings, all_findings)
            new_axis_scores[axis_name] = new_score
        
        # Compute composites
        valid_old = {k: v for k, v in old_axis_scores.items() if v is not None}
        valid_new = {k: v for k, v in new_axis_scores.items() if v is not None}
        
        new_composite = compute_composite(valid_new) if valid_new else 0
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
    
    # Print results table
    results.sort(key=lambda x: -x["new_composite"])
    
    print("### Before/After Comparison")
    print("")
    print("| # | Domain | Old Comp | New Comp | Δ | Old Tier | New Tier |")
    print("|---|--------|----------|----------|---|---------|---------|")
    for i, r in enumerate(results, 1):
        delta_str = f"+{r['delta']}" if r['delta'] > 0 else str(r['delta'])
        changed = " ↑" if r["tier_changed"] and r["new_composite"] > r["old_composite"] else (" ↓" if r["tier_changed"] else "")
        print(f"| {i} | {r['domain']} | {r['old_composite']} | {r['new_composite']} | {delta_str} | {r['old_tier']} | {r['new_tier']}{changed} |")
    
    print("")
    
    # Tier distribution comparison
    old_tiers = defaultdict(int)
    new_tiers = defaultdict(int)
    for r in results:
        old_tiers[r["old_tier"]] += 1
        new_tiers[r["new_tier"]] += 1
    
    print("### Tier Distribution Before/After")
    print("")
    print("| Tier | Before | After | Change |")
    print("|------|--------|-------|--------|")
    for t in ["Excellent", "Strong", "Moderate", "Weak", "Critical"]:
        old = old_tiers.get(t, 0)
        new = new_tiers.get(t, 0)
        delta = new - old
        d_str = f"+{delta}" if delta > 0 else str(delta) if delta != 0 else "—"
        print(f"| {t} | {old} | {new} | {d_str} |")
    
    print("")
    
    # Per-axis change details
    print("### Per-Axis Score Changes (Δ > 0 only)")
    print("")
    for axis_name in AXES:
        changes = []
        for r in results:
            old = r["old_axes"].get(axis_name)
            new = r["new_axes"].get(axis_name)
            if old is not None and new is not None and old != new:
                changes.append((r["domain"], old, new, new - old))
        
        if changes:
            print(f"#### {axis_name.title()}")
            print(f"| Domain | Old | New | Δ |")
            print(f"|--------|-----|-----|---|")
            for d, old, new, delta in sorted(changes, key=lambda x: -x[3]):
                d_str = f"+{delta}" if delta > 0 else str(delta)
                print(f"| {d} | {old} | {new} | {d_str} |")
            print("")
    
    # Key reference domains
    print("### Key Reference Domain Details")
    print("")
    key_domains = ["stripe.com", "yoke.lol", "medium.com", "stanford.edu", "techcrunch.com", 
                   "google.com", "example.com", "firetanksoftware.com"]
    for r in results:
        if r["domain"] in key_domains:
            print(f"**{r['domain']}**: {r['old_composite']} → {r['new_composite']} ({r['old_tier']} → {r['new_tier']})")
            for ax in AXES:
                old = r["old_axes"].get(ax, "N/A")
                new = r["new_axes"].get(ax, "N/A")
                if old != new and old is not None:
                    print(f"  {ax}: {old} → {new}")
            print("")

if __name__ == "__main__":
    main()
