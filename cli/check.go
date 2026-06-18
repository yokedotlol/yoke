package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// ─── Check Command (CI Gate) ────────────────────────────────────────

var minGrade string

func newCheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "check <domain>",
		Short: "CI gate — exit 1 if domain score is below threshold",
		Long: "Check if a domain meets a minimum score threshold.\n" +
			"Returns exit code 0 if the domain passes, exit code 1 if it fails.\n" +
			"Designed for CI/CD pipelines — use in GitHub Actions, GitLab CI, etc.",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runCheck,
		Example: `  yoke check stripe.com --min-grade B    # exit 1 if below B (78)
  yoke check stripe.com --min-grade A    # exit 1 if below A (90)
  yoke check stripe.com --min-grade B --json  # JSON gate output
  yoke check stripe.com --min-grade B --raw   # "pass" or "fail"
  cat domains.txt | yoke check --min-grade B  # batch CI check`,
	}
	cmd.Flags().StringVar(&minGrade, "min-grade", "B", "minimum passing grade (A, B, C, D, F)")
	return cmd
}

func runCheck(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return runBatch(cmd, args, runSingleCheck)
	}
	return runSingleCheck(normalizeDomain(args[0]))
}

func runSingleCheck(domain string) error {
	threshold, err := gradeThreshold(minGrade)
	if err != nil {
		return err
	}

	// Fetch analysis (prefer fast/quick, fall back to full)
	result, err := fetchFastResult(domain)
	if err != nil {
		return err
	}
	if result.Score == nil {
		return fmt.Errorf("no score data for %s", domain)
	}

	score := result.Score.Composite
	tier := result.Score.Tier
	passed := score >= threshold

	if rawOutput {
		if passed {
			fmt.Println("pass")
		} else {
			fmt.Println("fail")
		}
		if !passed {
			os.Exit(1)
		}
		return nil
	}

	if jsonOutput || !isTTY {
		out := struct {
			Domain    string `json:"domain"`
			Score     int    `json:"score"`
			Tier      string `json:"tier"`
			Passed    bool   `json:"passed"`
			Threshold string `json:"threshold"`
			MinScore  int    `json:"min_score"`
		}{
			Domain:    domain,
			Score:     score,
			Tier:      tier,
			Passed:    passed,
			Threshold: strings.ToUpper(minGrade),
			MinScore:  threshold,
		}
		data, _ := json.Marshal(out)
		os.Stdout.Write(data)
		fmt.Println()
		if !passed {
			os.Exit(1)
		}
		return nil
	}

	// Human output: single line
	if passed {
		fmt.Printf("  %s %s: %s (%d)\n",
			good.Render("✓"),
			title.Render(domain),
			tierStyle(tier).Render(tier),
			score)
	} else {
		fmt.Printf("  %s %s: %s (%d) — below %s threshold (%d)\n",
			bad.Render("✗"),
			title.Render(domain),
			tierStyle(tier).Render(tier),
			score,
			strings.ToUpper(minGrade),
			threshold)
	}

	if !passed {
		os.Exit(1)
	}
	return nil
}
