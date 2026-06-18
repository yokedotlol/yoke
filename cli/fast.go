package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// ─── Fast Command ───────────────────────────────────────────────────

func newFastCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fast <domain>",
		Short: "Lightweight analysis — skip heavy probes",
		Long: "Run a quick domain analysis that skips PageSpeed and other heavy probes.\n" +
			"Returns score, tier, axis breakdown, and top findings in under 2 seconds.\n\n" +
			"Uses the /api/quick endpoint when available, falls back to full analyze.",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runFast,
		Example: `  yoke fast stripe.com                   # quick score card
  yoke fast stripe.com --json            # raw JSON
  yoke fast stripe.com --raw             # score number only
  cat domains.txt | yoke fast            # batch quick scan
  cat domains.txt | yoke fast --json     # batch JSONL output`,
	}
	return cmd
}

func runFast(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return runBatch(cmd, args, runSingleFast)
	}
	return runSingleFast(normalizeDomain(args[0]))
}

func runSingleFast(domain string) error {
	if rawOutput {
		return runFastRaw(domain)
	}
	if jsonOutput || !isTTY {
		return runFastJSON(domain)
	}
	return runFastHuman(domain)
}

func runFastJSON(domain string) error {
	// Try /api/quick first, fall back to regular analyze
	body, err := fetchJSON(apiBase + "/api/quick/" + domain)
	if err != nil {
		// Fallback to regular analyze
		body, err = fetchJSON(apiBase + "/" + domain)
		if err != nil {
			return err
		}
	}
	os.Stdout.Write(body)
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
	return nil
}

func runFastRaw(domain string) error {
	result, err := fetchFastResult(domain)
	if err != nil {
		return err
	}
	if result.Score == nil {
		return fmt.Errorf("no score data for %s", domain)
	}
	fmt.Println(result.Score.Composite)
	return nil
}

func runFastHuman(domain string) error {
	spin := startSpinner("Quick scan of " + domain + "...")
	result, err := fetchFastResult(domain)
	spin.stop()
	if err != nil {
		return err
	}

	if result.Score == nil {
		return fmt.Errorf("no score data for %s", domain)
	}

	// Compact card: score + tier + axis bars
	var lines []string

	// Header: domain + score + tier
	tier := tierStyle(result.Score.Tier).Bold(true).Render(result.Score.Tier)
	lines = append(lines, fmt.Sprintf(
		"%s  %s %s",
		title.Render(result.Domain),
		title.Render(fmt.Sprintf("%d/100", result.Score.Composite)),
		tier,
	))

	if result.Score.Archetype != nil && result.Score.Archetype.Detected != "" {
		lines = append(lines, dim.Render(result.Score.Archetype.Detected))
	}
	lines = append(lines, "")

	// Axis scores with bars — compact, one-line-each
	for _, name := range sortedAxes(result.Score.Axes) {
		ax := result.Score.Axes[name]
		label := axisName.Render(strings.ToUpper(name))
		bar := renderBar(ax.Score, 16) // slightly shorter bar for compact view
		lines = append(lines, fmt.Sprintf("%s %s %s", label, bar, dim.Render(fmt.Sprintf("%d", ax.Score))))
	}

	// Quick facts row
	var facts []string
	if result.SSL != nil && result.SSL.Grade != "" {
		facts = append(facts, fmt.Sprintf("SSL %s", result.SSL.Grade))
	}
	if result.HTTPProtocols != nil {
		if result.HTTPProtocols.HTTP3 {
			facts = append(facts, "HTTP/3")
		} else if result.HTTPProtocols.HTTP2 {
			facts = append(facts, "HTTP/2")
		}
	}
	if result.Hosting != nil && result.Hosting.Provider != "" {
		facts = append(facts, result.Hosting.Provider)
	}
	if result.Hosting != nil && result.Hosting.CDN != "" {
		facts = append(facts, result.Hosting.CDN)
	}
	if len(facts) > 0 {
		lines = append(lines, "")
		lines = append(lines, dim.Render(strings.Join(facts, " · ")))
	}

	content := strings.Join(lines, "\n")
	fmt.Println()
	fmt.Println(cardBox.Render(content))
	fmt.Println()
	fmt.Printf("  %s\n\n", dim.Render(apiBase+"/"+result.Domain))

	return nil
}

// fetchFastResult tries the quick endpoint first, falls back to full analyze.
func fetchFastResult(domain string) (*AnalysisResult, error) {
	// Try /api/quick first
	body, err := fetchJSON(apiBase + "/api/quick/" + domain)
	if err == nil {
		var result AnalysisResult
		if err := json.Unmarshal(body, &result); err == nil {
			return &result, nil
		}
	}
	// Fall back to regular analyze (no SSE, plain JSON)
	return fetchAnalysis(domain)
}
