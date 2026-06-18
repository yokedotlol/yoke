package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// ─── Batch Processing ───────────────────────────────────────────────
//
// When stdin is a pipe (not a TTY), read domain names one per line and
// process each sequentially. This supports:
//
//   cat domains.txt | yoke fast --json
//   cat domains.txt | yoke dns --raw
//   cat domains.txt | yoke check --min-grade B
//
// Processing is sequential to respect satellite rate limits.

// isStdinPipe returns true if stdin is being piped (not interactive).
func isStdinPipe() bool {
	stat, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (stat.Mode() & os.ModeCharDevice) == 0
}

// runBatch reads domains from stdin and runs fn for each.
// Called from subcommand RunE when no positional arg is given.
// If stdin is not a pipe, shows usage help.
func runBatch(cmd *cobra.Command, args []string, fn func(domain string) error) error {
	if !isStdinPipe() {
		// No domain arg and no piped input — show help
		return fmt.Errorf("domain required: %s <domain>\n\nOr pipe domains via stdin: cat domains.txt | %s", cmd.CommandPath(), cmd.CommandPath())
	}

	// Suppress TTY features during batch processing
	origTTY := isTTY
	isTTY = false
	defer func() { isTTY = origTTY }()

	scanner := bufio.NewScanner(os.Stdin)
	var errs []string

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue // skip blank lines and comments
		}

		domain := normalizeDomain(line)
		if domain == "" {
			continue
		}

		if err := fn(domain); err != nil {
			// In batch mode, log errors to stderr and continue
			fmt.Fprintf(os.Stderr, "error: %s: %s\n", domain, err)
			errs = append(errs, domain)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("reading stdin: %w", err)
	}

	if len(errs) > 0 {
		return fmt.Errorf("%d domain(s) failed: %s", len(errs), strings.Join(errs, ", "))
	}

	return nil
}

// runSingleScore wraps the existing runScore for batch use.
// This handles a single domain in --raw/--json/human modes.
func runSingleScore(domain string) error {
	if rawOutput {
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
	// For JSON/human, delegate to the standard handler by simulating args.
	// This is a simplification — in batch JSON mode we need JSONL.
	if jsonOutput || !isTTY {
		result, err := fetchFastResult(domain)
		if err != nil {
			return err
		}
		if result.Score == nil {
			return fmt.Errorf("no score data for %s", domain)
		}
		minimal := struct {
			Domain string `json:"domain"`
			Score  int    `json:"score"`
			Tier   string `json:"tier"`
		}{
			Domain: result.Domain,
			Score:  result.Score.Composite,
			Tier:   result.Score.Tier,
		}
		out, _ := json.MarshalIndent(minimal, "", "  ")
		fmt.Println(string(out))
		return nil
	}
	// Human mode single-domain score
	result, err := fetchFastResult(domain)
	if err != nil {
		return err
	}
	if result.Score == nil {
		return fmt.Errorf("no score data for %s", domain)
	}
	tier := tierStyle(result.Score.Tier).Bold(true).Render(result.Score.Tier)
	fmt.Printf("%s  %d/100  %s\n", title.Render(domain), result.Score.Composite, tier)
	return nil
}

// runSingleAnalyze wraps the existing analyze for batch use.
func runSingleAnalyze(domain string) error {
	if rawOutput {
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
	if jsonOutput || !isTTY {
		return printRawJSON(domain, freshScan)
	}
	result, err := fetchAnalysisStream(domain, freshScan)
	if err != nil {
		return err
	}
	printAnalysis(result)
	return nil
}
