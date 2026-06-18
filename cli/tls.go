package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

// ─── TLS Command ────────────────────────────────────────────────────

func newTLSCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "tls <domain>",
		Short: "TLS certificate, protocols, and chain via certs.lol",
		Long:  "Inspect TLS/SSL certificates for a domain using certs.lol.\nShows grade, certificate details, protocol support, and chain validation.",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runTLS,
		Example: `  yoke tls stripe.com                   # TLS certificate details
  yoke tls stripe.com --json            # raw JSON from certs.lol
  yoke tls stripe.com --raw             # grade letter only
  cat domains.txt | yoke tls --raw      # batch grade check`,
	}
	return cmd
}

func runTLS(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return runBatch(cmd, args, runSingleTLS)
	}
	return runSingleTLS(normalizeDomain(args[0]))
}

func runSingleTLS(domain string) error {
	if rawOutput {
		return runTLSRaw(domain)
	}
	if jsonOutput || !isTTY {
		return runTLSJSON(domain)
	}
	return runTLSHuman(domain)
}

func runTLSJSON(domain string) error {
	body, err := fetchSatelliteJSON(certsBase + "/" + domain)
	if err != nil {
		return err
	}
	os.Stdout.Write(body)
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
	return nil
}

func runTLSRaw(domain string) error {
	body, err := fetchSatelliteJSON(certsBase + "/" + domain)
	if err != nil {
		return err
	}
	var data CertsResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}
	grade := data.Grade
	if grade == "" {
		grade = "—"
	}
	fmt.Println(grade)
	return nil
}

func runTLSHuman(domain string) error {
	spin := startSpinner("Inspecting TLS for " + domain + "...")
	body, err := fetchSatelliteJSON(certsBase + "/" + domain)
	spin.stop()
	if err != nil {
		return err
	}

	var data CertsResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}

	if data.Error != "" {
		return fmt.Errorf("TLS probe failed: %s", data.Error)
	}

	fmt.Println()

	// Grade + top-level protocol info
	grade := data.Grade
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
	} else {
		grade = "—"
	}

	topProto := "—"
	if len(data.Protocols) > 0 {
		topProto = data.Protocols[0]
	}
	keyInfo := ""
	if data.KeyAlg != "" {
		keyInfo = fmt.Sprintf("%s %d", data.KeyAlg, data.KeySize)
	}

	fmt.Printf("  %s  %s  %s  %s\n",
		title.Render(domain),
		gradeStyle.Bold(true).Render(grade),
		dim.Render(topProto),
		dim.Render(keyInfo))
	fmt.Println()

	// Certificate details
	fmt.Printf("  %s\n", title.Render("Certificate"))
	printTLSRow("Issuer", parseCNFromDN(data.Issuer))
	printTLSRow("Subject", parseCNFromDN(data.Subject))

	if data.ValidFrom != "" {
		printTLSRow("Valid From", strings.Split(data.ValidFrom, "T")[0])
	}

	if data.ValidTo != "" {
		expDate := strings.Split(data.ValidTo, "T")[0]
		days, ok := daysUntilExpiry(data.ValidTo)
		if ok {
			expStyle := good
			label := fmt.Sprintf("%s (%dd)", expDate, days)
			if days <= 0 {
				expStyle = bad
				label = fmt.Sprintf("%s (expired)", expDate)
			} else if days <= 30 {
				expStyle = warn
				label = fmt.Sprintf("%s (%dd)", expDate, days)
			}
			fmt.Printf("    %-16s %s\n", "Expires", expStyle.Render(label))
		} else {
			printTLSRow("Expires", expDate)
		}
	}

	if data.Serial != "" {
		serial := data.Serial
		if len(serial) > 24 {
			serial = serial[:21] + "..."
		}
		printTLSRow("Serial", serial)
	}

	sanCount := len(data.SANs)
	if sanCount > 0 {
		printTLSRow("SANs", fmt.Sprintf("%d domain%s", sanCount, pluralS(sanCount)))
	}

	if data.Fingerprint != "" {
		fp := data.Fingerprint
		if len(fp) > 24 {
			fp = fp[:21] + "..."
		}
		printTLSRow("Fingerprint", fp)
	}
	fmt.Println()

	// Protocol support
	allProtos := []string{"TLS 1.3", "TLS 1.2", "TLS 1.1", "TLS 1.0", "SSL 3.0"}
	fmt.Printf("  %s\n", title.Render("Protocol Support"))
	for _, p := range allProtos {
		supported := false
		for _, sp := range data.Protocols {
			if sp == p {
				supported = true
				break
			}
		}
		icon := dim.Render("✗")
		if supported {
			// TLS 1.0 and SSL 3.0 being supported is a warning
			if p == "TLS 1.0" || p == "SSL 3.0" || p == "TLS 1.1" {
				icon = warn.Render("⚠")
			} else {
				icon = good.Render("✓")
			}
		}
		fmt.Printf("    %s %s\n", icon, p)
	}
	fmt.Println()

	// Certificate chain
	if len(data.ChainCerts) > 0 {
		chainLabel := "valid"
		chainStyle := good
		if !data.ChainValid {
			chainLabel = "invalid"
			chainStyle = bad
		}
		fmt.Printf("  %s %s\n",
			title.Render("Certificate Chain"),
			chainStyle.Render("("+chainLabel+")"))

		for i, cert := range data.ChainCerts {
			indent := strings.Repeat("  ", i)
			cn := parseCNFromDN(cert.Subject)
			keyLabel := ""
			if cert.KeyAlg != "" {
				keyLabel = fmt.Sprintf("%s %d", cert.KeyAlg, cert.KeySize)
			}

			dotStyle := good
			if i == len(data.ChainCerts)-1 {
				dotStyle = dim
			} else if i > 0 {
				dotStyle = info
			}
			fmt.Printf("    %s%s %s  %s\n", indent, dotStyle.Render("●"), cn, dim.Render(keyLabel))
		}
		fmt.Println()
	}

	// SANs (show first few if many)
	if len(data.SANs) > 0 {
		maxShow := 8
		fmt.Printf("  %s", title.Render("Subject Alt Names"))
		if len(data.SANs) > maxShow {
			fmt.Printf(" %s", dim.Render(fmt.Sprintf("(%d total, showing %d)", len(data.SANs), maxShow)))
		}
		fmt.Println()
		for i, san := range data.SANs {
			if i >= maxShow {
				remaining := len(data.SANs) - maxShow
				fmt.Printf("    %s\n", dim.Render(fmt.Sprintf("+%d more", remaining)))
				break
			}
			fmt.Printf("    %s\n", san)
		}
		fmt.Println()
	}

	// Probe timing
	if data.ProbeMs > 0 {
		fmt.Printf("  %s\n", dim.Render(fmt.Sprintf("Probe completed in %.0fms", data.ProbeMs)))
	}

	// Footer
	fmt.Printf("  %s\n\n", dim.Render(certsBase+"/"+domain))
	return nil
}

func printTLSRow(label, value string) {
	fmt.Printf("    %-16s %s\n", label, value)
}

func pluralS(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
