package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

// ─── Headers Command ────────────────────────────────────────────────

func newHeadersCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "headers <domain>",
		Short: "Security headers, redirects, and CORS via xhttp.lol",
		Long:  "Analyze HTTP security headers for a domain using xhttp.lol.\nChecks security headers, redirect chains, CORS policy, CSP, and cache behavior.",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runHeaders,
		Example: `  yoke headers stripe.com               # security header analysis
  yoke headers stripe.com --json        # raw JSON from xhttp.lol
  yoke headers stripe.com --raw         # grade letter only
  cat domains.txt | yoke headers --raw  # batch grade check`,
	}
	return cmd
}

func runHeaders(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return runBatch(cmd, args, runSingleHeaders)
	}
	return runSingleHeaders(normalizeDomain(args[0]))
}

func runSingleHeaders(domain string) error {
	if rawOutput {
		return runHeadersRaw(domain)
	}
	if jsonOutput || !isTTY {
		return runHeadersJSON(domain)
	}
	return runHeadersHuman(domain)
}

func runHeadersJSON(domain string) error {
	body, err := fetchSatelliteJSON(xhttpBase + "/" + domain)
	if err != nil {
		return err
	}
	os.Stdout.Write(body)
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
	return nil
}

func runHeadersRaw(domain string) error {
	body, err := fetchSatelliteJSON(xhttpBase + "/" + domain)
	if err != nil {
		return err
	}
	var data XHTTPResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}
	grade := data.Grade
	if data.SecurityHeaders != nil && data.SecurityHeaders.Grade != "" {
		grade = data.SecurityHeaders.Grade
	}
	if grade == "" {
		grade = "—"
	}
	fmt.Println(grade)
	return nil
}

func runHeadersHuman(domain string) error {
	spin := startSpinner("Scanning headers for " + domain + "...")
	body, err := fetchSatelliteJSON(xhttpBase + "/" + domain)
	spin.stop()
	if err != nil {
		return err
	}

	var data XHTTPResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}

	fmt.Println()

	// Grade and score
	sh := data.SecurityHeaders
	grade := data.Grade
	if sh != nil && sh.Grade != "" {
		grade = sh.Grade
	}

	gradeStyle := good
	if grade != "" {
		switch grade[0] {
		case 'A':
			gradeStyle = good
		case 'B':
			gradeStyle = info
		case 'C':
			gradeStyle = warn
		default:
			gradeStyle = bad
		}
	}

	scoreLabel := ""
	if sh != nil {
		scoreLabel = fmt.Sprintf(" (%d/%d)", sh.Score, sh.MaxScore)
	}
	fmt.Printf("  %s  %s%s\n", title.Render(domain), gradeStyle.Bold(true).Render(grade), dim.Render(scoreLabel))
	fmt.Println()

	// Security headers checklist
	if sh != nil && len(sh.Headers) > 0 {
		fmt.Printf("  %s\n", title.Render("Security Headers"))

		// Canonical order for well-known headers
		headerOrder := []string{
			"strict-transport-security",
			"content-security-policy",
			"x-content-type-options",
			"x-frame-options",
			"referrer-policy",
			"permissions-policy",
			"x-xss-protection",
			"cross-origin-opener-policy",
			"cross-origin-resource-policy",
			"cross-origin-embedder-policy",
		}

		printed := make(map[string]bool)
		for _, name := range headerOrder {
			hdr, ok := sh.Headers[name]
			if !ok {
				continue
			}
			printed[name] = true
			printHeaderRow(name, hdr)
		}
		// Any remaining headers not in canonical order
		for name, hdr := range sh.Headers {
			if printed[name] {
				continue
			}
			printHeaderRow(name, hdr)
		}
		fmt.Println()
	}

	// Redirect chain
	if data.RedirectChain != nil && len(data.RedirectChain.Chain) > 0 {
		chain := data.RedirectChain.Chain
		hops := data.RedirectChain.Hops
		if hops == 0 && len(chain) > 1 {
			hops = len(chain) - 1
		}
		hopWord := "hop"
		if hops != 1 {
			hopWord = "hops"
		}
		fmt.Printf("  %s %s\n", title.Render("Redirect Chain"), dim.Render(fmt.Sprintf("(%d %s)", hops, hopWord)))
		for i, hop := range chain {
			codeStyle := dim
			if hop.Status >= 200 && hop.Status < 300 {
				codeStyle = good
			} else if hop.Status >= 300 && hop.Status < 400 {
				codeStyle = info
			} else if hop.Status >= 400 {
				codeStyle = bad
			}
			// Truncate long URLs
			displayURL := hop.URL
			if len(displayURL) > 65 {
				displayURL = displayURL[:62] + "..."
			}
			fmt.Printf("    %s %s\n", codeStyle.Render(fmt.Sprintf("%d", hop.Status)), displayURL)
			if i < len(chain)-1 {
				fmt.Printf("    %s\n", dim.Render("↓"))
			}
		}
		fmt.Println()
	}

	// CORS
	if data.CORS != nil {
		fmt.Printf("  %s\n", title.Render("CORS"))
		if data.CORS.Enabled {
			fmt.Printf("    %s Enabled", good.Render("✓"))
			if data.CORS.AllowOrigin != "" {
				fmt.Printf("  %s", dim.Render("origin: "+data.CORS.AllowOrigin))
			}
			fmt.Println()
		} else {
			fmt.Printf("    %s Not configured\n", dim.Render("—"))
		}
		fmt.Println()
	}

	// CSP
	if data.CSP != nil {
		fmt.Printf("  %s\n", title.Render("Content Security Policy"))
		if data.CSP.Present {
			label := "Enforced"
			if data.CSP.ReportOnly {
				label = "Report-Only"
			}
			fmt.Printf("    %s %s\n", good.Render("✓"), label)
		} else {
			fmt.Printf("    %s Not set\n", warn.Render("✗"))
		}
		fmt.Println()
	}

	// Cache
	if data.Cache != nil && data.Cache.CDNProvider != "" {
		fmt.Printf("  %s\n", title.Render("Cache"))
		if data.Cache.CDNProvider != "" {
			fmt.Printf("    CDN: %s\n", data.Cache.CDNProvider)
		}
		if data.Cache.CacheControl != "" {
			cc := data.Cache.CacheControl
			if len(cc) > 60 {
				cc = cc[:57] + "..."
			}
			fmt.Printf("    %s\n", dim.Render(cc))
		}
		fmt.Println()
	}

	// Footer
	fmt.Printf("  %s\n\n", dim.Render(xhttpBase+"/"+domain))
	return nil
}

func printHeaderRow(name string, hdr XHTTPHeaderInfo) {
	icon := warn.Render("✗")
	if hdr.Present {
		icon = good.Render("✓")
	}
	valPreview := ""
	if hdr.Present && hdr.Value != "" {
		v := hdr.Value
		if len(v) > 40 {
			v = v[:37] + "..."
		}
		valPreview = "  " + dim.Render(v)
	}
	fmt.Printf("    %s %-38s%s\n", icon, name, valPreview)
}
