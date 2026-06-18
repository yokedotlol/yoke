package main

// Satellite API base URLs and shared fetch logic for direct satellite queries.
// The yoke CLI talks to three satellite APIs directly (not via yoke.lol)
// for the dns, headers, and tls subcommands.

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ─── Satellite Base URLs ────────────────────────────────────────────

const (
	nsBase    = "https://ns.lol"
	xhttpBase = "https://xhttp.lol"
	certsBase = "https://certs.lol"
)

// ─── Satellite API Client ───────────────────────────────────────────

// fetchSatelliteJSON fetches JSON from a satellite API.
// Unlike fetchJSON (which talks to yoke.lol), this accepts a full URL
// and uses a satellite-appropriate User-Agent.
func fetchSatelliteJSON(url string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "yoke-cli/"+version)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read failed: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

// ─── DNS Response Types ─────────────────────────────────────────────

type NSResponse struct {
	Domain    string               `json:"domain"`
	QueryTime string              `json:"query_time"`
	Resolver  string               `json:"resolver"`
	Summary   NSSummary            `json:"summary"`
	Records   map[string]NSRecordGroup `json:"records"`
}

type NSSummary struct {
	TotalRecords  int    `json:"total_records"`
	RecordTypes   []string `json:"record_types"`
	AvgQueryTimeMs float64 `json:"avg_query_time_ms"`
	DNSSEC        string `json:"dnssec"`
}

type NSRecordGroup struct {
	Records     []NSRecord `json:"records"`
	Rcode       string     `json:"rcode"`
	QueryTimeMs float64    `json:"query_time_ms"`
}

type NSRecord struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	TTL      int    `json:"TTL"`
	Data     string `json:"data"`
	TTLHuman string `json:"ttl_human"`
}

// ─── Headers (xhttp) Response Types ─────────────────────────────────

type XHTTPResponse struct {
	URL             string          `json:"url"`
	ScannedAt       string          `json:"scanned_at"`
	Grade           string          `json:"grade"`
	CORS            *XHTTPCors      `json:"cors"`
	CSP             *XHTTPCSP       `json:"csp"`
	SecurityHeaders *XHTTPSecHeaders `json:"security_headers"`
	RedirectChain   *XHTTPRedirects `json:"redirect_chain"`
	Cache           *XHTTPCache     `json:"cache"`
	TLS             *XHTTPTLS       `json:"tls"`
}

type XHTTPSecHeaders struct {
	Grade    string                      `json:"grade"`
	Score    int                         `json:"score"`
	MaxScore int                        `json:"max_score"`
	Headers  map[string]XHTTPHeaderInfo `json:"headers"`
}

type XHTTPHeaderInfo struct {
	Present bool     `json:"present"`
	Value   string   `json:"value"`
	Issues  []string `json:"issues"`
}

type XHTTPRedirects struct {
	Hops  int          `json:"hops"`
	Chain []XHTTPHop   `json:"chain"`
}

type XHTTPHop struct {
	URL      string  `json:"url"`
	Status   int     `json:"status"`
	Location string  `json:"location"`
	TimingMs float64 `json:"timing_ms"`
}

type XHTTPCors struct {
	Enabled      bool     `json:"enabled"`
	AllowOrigin  string   `json:"allow_origin"`
	AllowMethods []string `json:"allow_methods"`
}

type XHTTPCSP struct {
	Present    bool   `json:"present"`
	Policy     string `json:"policy"`
	ReportOnly bool   `json:"report_only"`
}

type XHTTPCache struct {
	CDNProvider  string `json:"cdn_provider"`
	CacheControl string `json:"cache_control"`
	EffectiveTTL int    `json:"effective_ttl"`
}

type XHTTPTLS struct {
	Version  string `json:"version"`
	Protocol string `json:"protocol"`
}

// ─── TLS (certs) Response Types ─────────────────────────────────────

type CertsResponse struct {
	Grade      string      `json:"grade"`
	Issuer     string      `json:"issuer"`
	Subject    string      `json:"subject"`
	ValidFrom  string      `json:"valid_from"`
	ValidTo    string      `json:"valid_to"`
	KeyAlg     string      `json:"key_alg"`
	KeySize    int         `json:"key_size"`
	Protocols  []string    `json:"protocols"`
	ChainDepth int         `json:"chain_depth"`
	ChainValid bool        `json:"chain_valid"`
	ChainCerts []ChainCert `json:"chain_certs"`
	SANs       []string    `json:"sans"`
	Serial     string      `json:"serial"`
	Fingerprint string    `json:"fingerprint"`
	ProbeMs    float64     `json:"probe_ms"`
	Error      string      `json:"error"`
}

type ChainCert struct {
	Subject      string `json:"subject"`
	Issuer       string `json:"issuer"`
	ValidFrom    string `json:"valid_from"`
	ValidTo      string `json:"valid_to"`
	KeyAlg       string `json:"key_alg"`
	KeySize      int    `json:"key_size"`
	Serial       string `json:"serial"`
	SANs         []string `json:"sans"`
	IsSelfSigned bool   `json:"is_self_signed"`
	SignatureAlg string `json:"signature_alg"`
}

// ─── Grade Threshold Logic ──────────────────────────────────────────

// gradeThreshold returns the minimum composite score for a given grade letter.
func gradeThreshold(grade string) (int, error) {
	switch strings.ToUpper(strings.TrimSpace(grade)) {
	case "A":
		return 90, nil
	case "B":
		return 78, nil
	case "C":
		return 60, nil
	case "D":
		return 40, nil
	case "F":
		return 0, nil
	default:
		return 0, fmt.Errorf("invalid grade %q — use A, B, C, D, or F", grade)
	}
}

// parseCNFromDN extracts the CN= value from a distinguished name string.
func parseCNFromDN(dn string) string {
	if dn == "" {
		return dn
	}
	for _, part := range strings.Split(dn, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "CN=") {
			return strings.TrimPrefix(part, "CN=")
		}
	}
	return dn
}

// daysUntilExpiry returns the number of days between now and an ISO timestamp.
func daysUntilExpiry(ts string) (int, bool) {
	for _, layout := range []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		t, err := time.Parse(layout, ts)
		if err == nil {
			days := int(time.Until(t).Hours() / 24)
			return days, true
		}
	}
	return 0, false
}
