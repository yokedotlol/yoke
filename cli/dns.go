package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// ─── DNS Command ────────────────────────────────────────────────────

func newDNSCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "dns <domain>",
		Short: "DNS records, DNSSEC, and propagation via ns.lol",
		Long:  "Query DNS records for a domain using ns.lol.\nShows A, AAAA, CNAME, MX, NS, TXT, SOA, and other record types with TTLs.",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runDNS,
		Example: `  yoke dns stripe.com                    # all DNS records
  yoke dns stripe.com --json             # raw JSON from ns.lol
  yoke dns stripe.com --raw              # record data values only
  cat domains.txt | yoke dns --json      # batch JSON output`,
	}
	return cmd
}

func runDNS(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return runBatch(cmd, args, runSingleDNS)
	}
	return runSingleDNS(normalizeDomain(args[0]))
}

func runSingleDNS(domain string) error {
	if rawOutput {
		return runDNSRaw(domain)
	}
	if jsonOutput || !isTTY {
		return runDNSJSON(domain)
	}
	return runDNSHuman(domain)
}

func runDNSJSON(domain string) error {
	body, err := fetchSatelliteJSON(nsBase + "/" + domain)
	if err != nil {
		return err
	}
	os.Stdout.Write(body)
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
	return nil
}

func runDNSRaw(domain string) error {
	body, err := fetchSatelliteJSON(nsBase + "/" + domain)
	if err != nil {
		return err
	}
	var data NSResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}
	for _, rtype := range dnsRecordOrder() {
		group, ok := data.Records[rtype]
		if !ok {
			continue
		}
		for _, r := range group.Records {
			fmt.Println(strings.TrimSuffix(r.Data, "."))
		}
	}
	// Any remaining types not in canonical order
	seen := make(map[string]bool)
	for _, t := range dnsRecordOrder() {
		seen[t] = true
	}
	for rtype, group := range data.Records {
		if seen[rtype] {
			continue
		}
		for _, r := range group.Records {
			fmt.Println(strings.TrimSuffix(r.Data, "."))
		}
	}
	return nil
}

func runDNSHuman(domain string) error {
	spin := startSpinner("Querying DNS for " + domain + "...")
	body, err := fetchSatelliteJSON(nsBase + "/" + domain)
	spin.stop()
	if err != nil {
		return err
	}

	var data NSResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}

	fmt.Println()

	// Header: domain + DNSSEC + summary
	dnssecBadge := dim.Render("DNSSEC unsigned")
	if data.Summary.DNSSEC == "signed" {
		dnssecBadge = good.Render("DNSSEC ✓")
	}
	summaryLine := fmt.Sprintf("%d records · %.0fms avg",
		data.Summary.TotalRecords, data.Summary.AvgQueryTimeMs)

	fmt.Printf("  %s  %s  %s\n", title.Render(domain), dnssecBadge, dim.Render(summaryLine))
	fmt.Println()

	// Records grouped by type
	seen := make(map[string]bool)
	for _, rtype := range dnsRecordOrder() {
		group, ok := data.Records[rtype]
		if !ok || len(group.Records) == 0 {
			continue
		}
		seen[rtype] = true
		printDNSGroup(rtype, group)
	}
	// Any remaining types
	for rtype, group := range data.Records {
		if seen[rtype] || len(group.Records) == 0 {
			continue
		}
		printDNSGroup(rtype, group)
	}

	// Footer
	fmt.Printf("  %s\n\n", dim.Render(nsBase+"/"+domain))
	return nil
}

func printDNSGroup(rtype string, group NSRecordGroup) {
	fmt.Printf("  %s\n", title.Render(rtype))
	for _, r := range group.Records {
		dataVal := strings.TrimSuffix(r.Data, ".")
		ttl := r.TTLHuman
		if ttl == "" {
			ttl = fmt.Sprintf("%ds", r.TTL)
		}
		// Truncate very long TXT records for display
		displayData := dataVal
		if len(displayData) > 60 {
			displayData = displayData[:57] + "..."
		}
		fmt.Printf("    %s  %s\n",
			fmt.Sprintf("%-50s", displayData),
			dim.Render(ttl))
	}
	fmt.Println()
}

func dnsRecordOrder() []string {
	return []string{"A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "SRV", "CAA", "DNSKEY", "DS"}
}
