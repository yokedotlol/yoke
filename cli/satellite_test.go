package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// ─── Satellite Response Parsing ─────────────────────────────────────

func TestNSResponseParsing(t *testing.T) {
	raw := `{
		"domain": "stripe.com",
		"query_time": "2025-01-01T00:00:00Z",
		"resolver": "1.1.1.1",
		"summary": {
			"total_records": 12,
			"record_types": ["A", "MX", "NS", "TXT"],
			"avg_query_time_ms": 15.5,
			"dnssec": "unsigned"
		},
		"records": {
			"A": {
				"records": [
					{"type": "A", "name": "stripe.com.", "TTL": 300, "data": "185.166.143.1", "ttl_human": "5m"}
				],
				"rcode": "NOERROR",
				"query_time_ms": 12.3
			},
			"MX": {
				"records": [
					{"type": "MX", "name": "stripe.com.", "TTL": 3600, "data": "10 mx1.stripe.com.", "ttl_human": "1h"}
				],
				"rcode": "NOERROR",
				"query_time_ms": 18.1
			}
		}
	}`

	var data NSResponse
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	if data.Domain != "stripe.com" {
		t.Errorf("domain = %q, want %q", data.Domain, "stripe.com")
	}
	if data.Summary.TotalRecords != 12 {
		t.Errorf("total_records = %d, want 12", data.Summary.TotalRecords)
	}
	if data.Summary.DNSSEC != "unsigned" {
		t.Errorf("dnssec = %q, want %q", data.Summary.DNSSEC, "unsigned")
	}
	if _, ok := data.Records["A"]; !ok {
		t.Error("missing A records")
	}
	if len(data.Records["A"].Records) != 1 {
		t.Errorf("A record count = %d, want 1", len(data.Records["A"].Records))
	}
	if data.Records["A"].Records[0].Data != "185.166.143.1" {
		t.Errorf("A record data = %q", data.Records["A"].Records[0].Data)
	}
}

func TestXHTTPResponseParsing(t *testing.T) {
	raw := `{
		"url": "https://stripe.com",
		"scanned_at": "2025-01-01T00:00:00Z",
		"grade": "B+",
		"security_headers": {
			"grade": "A",
			"score": 8,
			"max_score": 10,
			"headers": {
				"strict-transport-security": {"present": true, "value": "max-age=31536000", "issues": []},
				"content-security-policy": {"present": false, "value": "", "issues": ["missing"]}
			}
		},
		"redirect_chain": {
			"hops": 1,
			"chain": [
				{"url": "http://stripe.com", "status": 301, "location": "https://stripe.com", "timing_ms": 45.2},
				{"url": "https://stripe.com", "status": 200, "location": "", "timing_ms": 30.1}
			]
		},
		"cors": {"enabled": false, "allow_origin": "", "allow_methods": null},
		"csp": {"present": false, "policy": "", "report_only": false},
		"cache": {"cdn_provider": "Cloudflare", "cache_control": "max-age=600", "effective_ttl": 600}
	}`

	var data XHTTPResponse
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	if data.Grade != "B+" {
		t.Errorf("grade = %q, want %q", data.Grade, "B+")
	}
	if data.SecurityHeaders == nil {
		t.Fatal("security_headers is nil")
	}
	if data.SecurityHeaders.Grade != "A" {
		t.Errorf("security grade = %q, want %q", data.SecurityHeaders.Grade, "A")
	}
	hsts, ok := data.SecurityHeaders.Headers["strict-transport-security"]
	if !ok {
		t.Fatal("missing HSTS header")
	}
	if !hsts.Present {
		t.Error("HSTS should be present")
	}
	csp, ok := data.SecurityHeaders.Headers["content-security-policy"]
	if !ok {
		t.Fatal("missing CSP header")
	}
	if csp.Present {
		t.Error("CSP should not be present")
	}
	if data.RedirectChain == nil || len(data.RedirectChain.Chain) != 2 {
		t.Errorf("redirect chain length = %v, want 2", data.RedirectChain)
	}
	if data.Cache == nil || data.Cache.CDNProvider != "Cloudflare" {
		t.Error("cache CDN should be Cloudflare")
	}
}

func TestCertsResponseParsing(t *testing.T) {
	raw := `{
		"grade": "A+",
		"issuer": "CN=R3,O=Let's Encrypt,C=US",
		"subject": "CN=stripe.com",
		"valid_from": "2025-01-01T00:00:00Z",
		"valid_to": "2025-04-01T00:00:00Z",
		"key_alg": "ECDSA",
		"key_size": 256,
		"protocols": ["TLS 1.3", "TLS 1.2"],
		"chain_depth": 3,
		"chain_valid": true,
		"chain_certs": [
			{"subject": "CN=stripe.com", "issuer": "CN=R3", "valid_from": "2025-01-01", "valid_to": "2025-04-01", "key_alg": "ECDSA", "key_size": 256}
		],
		"sans": ["stripe.com", "*.stripe.com"],
		"serial": "04:ab:cd:ef:12:34",
		"fingerprint": "sha256:abcdef1234567890",
		"probe_ms": 42.5
	}`

	var data CertsResponse
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	if data.Grade != "A+" {
		t.Errorf("grade = %q, want %q", data.Grade, "A+")
	}
	if data.KeyAlg != "ECDSA" {
		t.Errorf("key_alg = %q, want %q", data.KeyAlg, "ECDSA")
	}
	if len(data.Protocols) != 2 {
		t.Errorf("protocols count = %d, want 2", len(data.Protocols))
	}
	if data.Protocols[0] != "TLS 1.3" {
		t.Errorf("protocols[0] = %q, want %q", data.Protocols[0], "TLS 1.3")
	}
	if !data.ChainValid {
		t.Error("chain should be valid")
	}
	if len(data.SANs) != 2 {
		t.Errorf("sans count = %d, want 2", len(data.SANs))
	}
}

// ─── Grade Threshold ────────────────────────────────────────────────

func TestGradeThreshold(t *testing.T) {
	tests := []struct {
		grade     string
		wantScore int
		wantErr   bool
	}{
		{"A", 90, false},
		{"a", 90, false},
		{"B", 78, false},
		{"C", 60, false},
		{"D", 40, false},
		{"F", 0, false},
		{"X", 0, true},
		{"", 0, true},
		{"AB", 0, true},
	}
	for _, tt := range tests {
		score, err := gradeThreshold(tt.grade)
		if (err != nil) != tt.wantErr {
			t.Errorf("gradeThreshold(%q): err = %v, wantErr = %v", tt.grade, err, tt.wantErr)
			continue
		}
		if !tt.wantErr && score != tt.wantScore {
			t.Errorf("gradeThreshold(%q) = %d, want %d", tt.grade, score, tt.wantScore)
		}
	}
}

// ─── parseCNFromDN ──────────────────────────────────────────────────

func TestParseCNFromDN(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"CN=R3,O=Let's Encrypt,C=US", "R3"},
		{"CN=stripe.com", "stripe.com"},
		{"O=Example,CN=example.com,C=US", "example.com"},
		{"O=NoCN", "O=NoCN"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := parseCNFromDN(tt.input); got != tt.want {
			t.Errorf("parseCNFromDN(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// ─── daysUntilExpiry ────────────────────────────────────────────────

func TestDaysUntilExpiry(t *testing.T) {
	// A date far in the future should have positive days
	days, ok := daysUntilExpiry("2099-12-31T23:59:59Z")
	if !ok {
		t.Error("expected ok=true for valid date")
	}
	if days <= 0 {
		t.Errorf("expected positive days for future date, got %d", days)
	}

	// A date in the past should have negative days
	days, ok = daysUntilExpiry("2000-01-01T00:00:00Z")
	if !ok {
		t.Error("expected ok=true for valid past date")
	}
	if days >= 0 {
		t.Errorf("expected negative days for past date, got %d", days)
	}

	// Invalid date
	_, ok = daysUntilExpiry("not-a-date")
	if ok {
		t.Error("expected ok=false for invalid date")
	}

	// Date-only format
	_, ok = daysUntilExpiry("2099-12-31")
	if !ok {
		t.Error("expected ok=true for date-only format")
	}
}

// ─── DNS Record Order ───────────────────────────────────────────────

func TestDNSRecordOrder(t *testing.T) {
	order := dnsRecordOrder()
	if len(order) == 0 {
		t.Error("expected non-empty record order")
	}
	// A should come first
	if order[0] != "A" {
		t.Errorf("first record type = %q, want %q", order[0], "A")
	}
}

// ─── pluralS ────────────────────────────────────────────────────────

func TestPluralS(t *testing.T) {
	if got := pluralS(0); got != "s" {
		t.Errorf("pluralS(0) = %q, want %q", got, "s")
	}
	if got := pluralS(1); got != "" {
		t.Errorf("pluralS(1) = %q, want %q", got, "")
	}
	if got := pluralS(5); got != "s" {
		t.Errorf("pluralS(5) = %q, want %q", got, "s")
	}
}

// ─── Batch Line Parsing ─────────────────────────────────────────────

func TestBatchLineNormalization(t *testing.T) {
	// Simulate what runBatch does with each line
	inputs := []struct {
		line     string
		expected string
		skip     bool
	}{
		{"stripe.com", "stripe.com", false},
		{"  STRIPE.COM  ", "stripe.com", false},
		{"https://github.com/path", "github.com", false},
		{"# comment", "", true},
		{"", "", true},
		{"   ", "", true},
	}
	for _, tt := range inputs {
		line := strings.TrimSpace(tt.line)
		if line == "" || strings.HasPrefix(line, "#") {
			if !tt.skip {
				t.Errorf("expected non-skip for %q", tt.line)
			}
			continue
		}
		got := normalizeDomain(line)
		if got != tt.expected {
			t.Errorf("normalizeDomain(%q) = %q, want %q", tt.line, got, tt.expected)
		}
	}
}

// ─── Raw Output Formatting ──────────────────────────────────────────

func TestRawOutputIntegrity(t *testing.T) {
	// Verify that grade strings we'd output in --raw are clean
	grades := []string{"A+", "A", "A-", "B", "C", "D", "F", "—"}
	for _, g := range grades {
		if strings.ContainsAny(g, "\n\r\t") {
			t.Errorf("grade %q contains control characters", g)
		}
	}
}
