package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"github.com/oschwald/geoip2-golang"
	"golang.org/x/time/rate"
)

var domainRe = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$`)

// MaxMind GeoLite2 databases (loaded at startup if available)
var geoDB *geoip2.Reader
var asnDB *geoip2.Reader

func initGeoIP() {
	// City database (lat/lon, country, city)
	cityPath := "/GeoLite2-City.mmdb"
	if envPath := os.Getenv("MAXMIND_DB_PATH"); envPath != "" {
		cityPath = envPath
	}
	db, err := geoip2.Open(cityPath)
	if err != nil {
		log.Printf("[geo] MaxMind GeoLite2-City not available at %s: %v — using API fallback", cityPath, err)
	} else {
		geoDB = db
		log.Printf("[geo] Loaded MaxMind GeoLite2-City from %s", cityPath)
	}

	// ASN database (ISP, org, ASN)
	asnPath := "/GeoLite2-ASN.mmdb"
	if envPath := os.Getenv("MAXMIND_ASN_DB_PATH"); envPath != "" {
		asnPath = envPath
	}
	adb, err := geoip2.Open(asnPath)
	if err != nil {
		log.Printf("[geo] MaxMind GeoLite2-ASN not available at %s: %v — ISP/ASN from API fallback", asnPath, err)
	} else {
		asnDB = adb
		log.Printf("[geo] Loaded MaxMind GeoLite2-ASN from %s", asnPath)
	}
}

// ─── Global Rate Limiter ────────────────────────────────────────────
// Token bucket at 1000 req/s with burst of 1000. Protects against
// runaway loops, not per-user abuse (worker is the only caller).

var globalLimiter = rate.NewLimiter(1000, 1000)

// Rolling counters for health tier (reset every 60s by background goroutine)
var (
	windowTotal    atomic.Int64
	windowRejected atomic.Int64
)

func initHealthTicker() {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		for range ticker.C {
			windowTotal.Store(0)
			windowRejected.Store(0)
		}
	}()
}

// healthTier returns green/yellow/red based on rejection ratio
// green: 0-50% of limit utilization, yellow: 51-80%, red: 81-100%
func healthTier() string {
	total := windowTotal.Load()
	if total == 0 {
		return "green"
	}
	rejected := windowRejected.Load()
	rejectRatio := float64(rejected) / float64(total)
	// Map rejection ratio to utilization tiers:
	// Any rejections mean we're near the limit
	if rejectRatio > 0.05 {
		return "red"
	}
	// Estimate utilization from request volume vs capacity (60K/min at 1000/s)
	utilization := float64(total) / 60000.0
	if utilization > 0.80 {
		return "red"
	}
	if utilization > 0.50 {
		return "yellow"
	}
	return "green"
}

// ─── SSRF Protection ────────────────────────────────────────────────
// Block connections to private, reserved, and link-local IP ranges.
// Applied at dial time to catch DNS rebinding attacks.

var privateRanges []*net.IPNet

func init() {
	cidrs := []string{
		"127.0.0.0/8",     // IPv4 loopback
		"10.0.0.0/8",      // RFC1918
		"172.16.0.0/12",   // RFC1918
		"192.168.0.0/16",  // RFC1918
		"169.254.0.0/16",  // link-local
		"224.0.0.0/4",     // multicast
		"0.0.0.0/8",       // unspecified
		"100.64.0.0/10",   // carrier-grade NAT
		"192.0.0.0/24",    // IETF protocol
		"192.0.2.0/24",    // documentation (TEST-NET-1)
		"198.51.100.0/24", // documentation (TEST-NET-2)
		"203.0.113.0/24",  // documentation (TEST-NET-3)
		"198.18.0.0/15",   // benchmarking
		"240.0.0.0/4",     // reserved
		"::1/128",         // IPv6 loopback
		"fc00::/7",        // IPv6 unique local
		"fe80::/10",       // IPv6 link-local
		"ff00::/8",        // IPv6 multicast
	}
	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil {
			privateRanges = append(privateRanges, network)
		}
	}
}

func isPrivateIP(ip net.IP) bool {
	// Check IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	for _, network := range privateRanges {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// safeDialContext resolves the hostname and rejects private IPs before connecting.
func safeDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("invalid address: %s", addr)
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if isPrivateIP(ip.IP) {
			return nil, fmt.Errorf("connection to private/reserved IP %s blocked (SSRF protection)", ip.IP)
		}
	}
	// Connect to the first resolved address
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].IP.String(), port))
}

// safeTransport returns an http.Transport that rejects private IPs at dial time.
func safeTransport() *http.Transport {
	return &http.Transport{
		DialContext:       safeDialContext,
		ForceAttemptHTTP2: true,
		TLSClientConfig:   &tls.Config{InsecureSkipVerify: false},
	}
}

// safeTLSDial resolves the hostname, rejects private IPs, then does a TLS handshake.
func safeTLSDial(domain string, timeout time.Duration, tlsConfig *tls.Config) (*tls.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, domain)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if isPrivateIP(ip.IP) {
			return nil, fmt.Errorf("connection to private/reserved IP %s blocked (SSRF protection)", ip.IP)
		}
	}
	dialer := &net.Dialer{Timeout: timeout}
	addr := net.JoinHostPort(ips[0].IP.String(), "443")
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
	return conn, err
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Require FLY_AUTH_SECRET unless explicitly opted out
	authSecret := os.Getenv("FLY_AUTH_SECRET")
	if authSecret == "" {
		if os.Getenv("ALLOW_OPEN_PROXY") != "true" {
			fmt.Println("❌ FLY_AUTH_SECRET is not set. The probe will not start without authentication.")
			fmt.Println("   Set FLY_AUTH_SECRET to a shared secret that your worker also knows.")
			fmt.Println("   To intentionally run without auth (NOT recommended), set ALLOW_OPEN_PROXY=true")
			os.Exit(1)
		}
		fmt.Println("⚠️  Running without authentication — probe is open to all requests")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", handler)

	// Initialize MaxMind GeoIP database
	initGeoIP()

	// Start health metric ticker (resets counters every 60s)
	initHealthTicker()

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 65 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	fmt.Printf("yoke probe proxy listening on :%s\n", port)
	server.ListenAndServe()
}

// checkAuth verifies the Authorization header if FLY_AUTH_SECRET is set.
// If the env var is not set (ALLOW_OPEN_PROXY mode), all requests are allowed.
func checkAuth(r *http.Request) bool {
	secret := os.Getenv("FLY_AUTH_SECRET")
	if secret == "" {
		return true // ALLOW_OPEN_PROXY mode — startup already warned
	}
	auth := r.Header.Get("Authorization")
	expected := "Bearer " + secret
	if len(auth) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(auth), []byte(expected)) == 1
}

func handler(w http.ResponseWriter, r *http.Request) {
	// CORS
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization")
	if r.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}

	// Health check — unauthenticated for Fly's health checks, returns traffic tier
	if r.URL.Path == "/" || r.URL.Path == "/health" {
		w.Header().Set("Content-Type", "application/json")
		serviceName := os.Getenv("SERVICE_NAME")
		if serviceName == "" {
			serviceName = "yoke-probe"
		}
		tier := healthTier()
		fmt.Fprintf(w, `{"status":"ok","service":"%s","health":"%s"}`, serviceName, tier)
		return
	}

	// Auth check — reject unauthorized requests for all endpoints except health
	if !checkAuth(r) {
		http.Error(w, `{"error":"unauthorized"}`, 403)
		return
	}

	// Global rate limiting — 1000 req/s token bucket
	windowTotal.Add(1)
	if !globalLimiter.Allow() {
		windowRejected.Add(1)
		w.Header().Set("Retry-After", "1")
		w.Header().Set("Content-Type", "application/json")
		http.Error(w, `{"error":"rate_limited","retry_after":1}`, 429)
		return
	}

	// Proxy check-host.net requests
	if strings.HasPrefix(r.URL.Path, "/check-") {
		targetURL := "https://check-host.net" + r.URL.Path
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}

		client := &http.Client{Timeout: 15 * time.Second}
		req, err := http.NewRequest("GET", targetURL, nil)
		if err != nil {
			http.Error(w, `{"error":"bad request"}`, 400)
			return
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "Yoke/1.0 (Domain Intelligence)")

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[check-host] upstream error for %s: %v", r.URL.Path, err)
			http.Error(w, `{"error":"upstream unavailable"}`, 502)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, io.LimitReader(resp.Body, 1<<20)) // 1MB response body limit
		return
	}

	// Probe HTTP status from Fly.io (avoids CF Worker IP blocks)
	if r.URL.Path == "/probe-status" {
		domain := r.URL.Query().Get("domain")
		if domain == "" || !domainRe.MatchString(domain) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid or missing domain parameter"}`, 400)
			return
		}
		result := probeStatus(domain)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(result)
		return
	}

	// SSL/TLS probe — direct TLS handshake for instant cert info
	if r.URL.Path == "/probe-ssl" {
		domain := r.URL.Query().Get("domain")
		if domain == "" || !domainRe.MatchString(domain) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid or missing domain parameter"}`, 400)
			return
		}
		result := probeSSL(domain)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(result)
		return
	}

	// HTTP protocol probe — detect HTTP/2 and HTTP/3 support
	if r.URL.Path == "/probe-protocols" {
		domain := r.URL.Query().Get("domain")
		if domain == "" || !domainRe.MatchString(domain) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid or missing domain parameter"}`, 400)
			return
		}
		result := probeProtocols(domain)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(result)
		return
	}

	// Connection timing probe — DNS, TCP, TLS breakdown
	if r.URL.Path == "/probe-timing" {
		host := r.URL.Query().Get("host")
		if host == "" || !domainRe.MatchString(host) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid or missing host parameter"}`, 400)
			return
		}
		result := probeTiming(host)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(result)
		return
	}

	if r.URL.Path == "/probe-geo" {
		ip := r.URL.Query().Get("ip")
		if ip == "" {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"missing ip parameter"}`, 400)
			return
		}
		result := probeGeoIP(ip)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(result)
		return
	}

	// HTTP content fallback probe — full HTTP fetch from Fly's IPs
	if r.URL.Path == "/probe-http" {
		domain := r.URL.Query().Get("domain")
		if domain == "" || !domainRe.MatchString(domain) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid or missing domain parameter"}`, 400)
			return
		}
		result := probeHTTP(domain)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(result)
		return
	}

	// PageSpeed Insights proxy — avoids Cloudflare Worker IP blocks
	if r.URL.Path == "/pagespeed" {
		domain := r.URL.Query().Get("domain")
		if domain == "" || !domainRe.MatchString(domain) {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid or missing domain parameter"}`, 400)
			return
		}
		apiKey := os.Getenv("GOOGLE_PAGESPEED_API_KEY")
		strategy := r.URL.Query().Get("strategy")
		if strategy != "desktop" {
			strategy = "mobile"
		}
		result := proxyPageSpeed(domain, apiKey, strategy)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(result)
		return
	}

	// General-purpose URL fetch — used for self-domain fetches that CF Workers
	// can't make (e.g., MTA-STS policy on a subdomain routed to the same worker).
	if r.URL.Path == "/probe-fetch" {
		targetURL := r.URL.Query().Get("url")
		if targetURL == "" {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"missing url parameter"}`, 400)
			return
		}
		parsedURL, err := url.Parse(targetURL)
		if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"invalid url"}`, 400)
			return
		}
		client := &http.Client{
			Transport: safeTransport(),
			Timeout:   10 * time.Second,
		}
		resp, err := client.Get(targetURL)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":  err.Error(),
				"status": 0,
			})
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024)) // 64KB max
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  resp.StatusCode,
			"body":    string(body),
			"headers": resp.Header,
		})
		return
	}

	http.Error(w, `{"error":"not found"}`, 404)
}

// ─── IP Geolocation Probe ───────────────────────────────────────────

type GeoResult struct {
	IP          string   `json:"ip"`
	City        *string  `json:"city"`
	Country     *string  `json:"country"`
	CountryCode *string  `json:"country_code"`
	Lat         *float64 `json:"lat"`
	Lon         *float64 `json:"lon"`
	ISP         *string  `json:"isp"`
	Org         *string  `json:"org"`
	ASN         *string  `json:"asn"`
	Source      string   `json:"source"`
	Error       *string  `json:"error"`
}

func probeGeoIP(ip string) GeoResult {
	// Try local MaxMind DB first (no rate limits, sub-ms)
	if result := tryMaxMind(ip); result != nil {
		return *result
	}
	// Fall back to ipwho.is (HTTPS, no key needed)
	if result := tryIpWhois(ip); result != nil {
		return *result
	}
	errStr := "all geolocation providers failed"
	return GeoResult{IP: ip, Error: &errStr}
}

func tryMaxMind(ipStr string) *GeoResult {
	if geoDB == nil {
		return nil
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return nil
	}
	record, err := geoDB.City(ip)
	if err != nil {
		log.Printf("[geo] MaxMind lookup failed for %s: %v", ipStr, err)
		return nil
	}

	city := ""
	if name, ok := record.City.Names["en"]; ok {
		city = name
	}
	country := ""
	if name, ok := record.Country.Names["en"]; ok {
		country = name
	}
	countryCode := record.Country.IsoCode
	lat := record.Location.Latitude
	lon := record.Location.Longitude

	// Enrich with ASN data if available
	var isp, org, asn *string
	if asnDB != nil {
		asnRecord, err := asnDB.ASN(ip)
		if err == nil {
			asnStr := fmt.Sprintf("AS%d", asnRecord.AutonomousSystemNumber)
			orgStr := asnRecord.AutonomousSystemOrganization
			asn = &asnStr
			org = &orgStr
			isp = &orgStr // ASN DB uses org as ISP
		}
	}

	return &GeoResult{
		IP: ipStr, City: &city, Country: &country,
		CountryCode: &countryCode, Lat: &lat, Lon: &lon,
		ISP: isp, Org: org, ASN: asn, Source: "maxmind",
	}
}

func tryIpWhois(ip string) *GeoResult {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("https://ipwho.is/" + ip)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil
	}

	var data struct {
		Success     bool    `json:"success"`
		Country     string  `json:"country"`
		CountryCode string  `json:"country_code"`
		City        string  `json:"city"`
		Latitude    float64 `json:"latitude"`
		Longitude   float64 `json:"longitude"`
		Connection  struct {
			ISP string `json:"isp"`
			Org string `json:"org"`
			ASN int    `json:"asn"`
		} `json:"connection"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil || !data.Success {
		return nil
	}

	asn := ""
	if data.Connection.ASN > 0 {
		asn = "AS" + strings.TrimLeft(fmt.Sprintf("%d", data.Connection.ASN), "0")
	}

	return &GeoResult{
		IP: ip, City: &data.City, Country: &data.Country,
		CountryCode: &data.CountryCode, Lat: &data.Latitude, Lon: &data.Longitude,
		ISP: &data.Connection.ISP, Org: &data.Connection.Org, ASN: &asn, Source: "ipwho.is",
	}
}

// ─── SSL Probe ──────────────────────────────────────────────────────

type CipherInfo struct {
	Name     string `json:"name"`
	ID       uint16 `json:"id"`
	Strength string `json:"strength"` // "strong", "acceptable", "weak", "insecure"
}

type ChainCert struct {
	Subject   string   `json:"subject"`
	Issuer    string   `json:"issuer"`
	ValidFrom string   `json:"valid_from"`
	ValidTo   string   `json:"valid_to"`
	KeyAlg    string   `json:"key_alg"`
	KeySize   int      `json:"key_size"`
	Serial    string   `json:"serial"`
	SANs      []string `json:"sans,omitempty"`
	IsSelfSigned bool  `json:"is_self_signed"`
	SignatureAlg string `json:"signature_alg"`
}

type SSLResult struct {
	Grade          string       `json:"grade"`
	Issuer         string       `json:"issuer"`
	Subject        string       `json:"subject"`
	ValidFrom      string       `json:"valid_from"`
	ValidTo        string       `json:"valid_to"`
	KeyAlg         string       `json:"key_alg"`
	KeySize        int          `json:"key_size"`
	Protocols      []string     `json:"protocols"`
	ChainDepth     int          `json:"chain_depth"`
	ChainValid     bool         `json:"chain_valid"`
	ChainCerts     []ChainCert  `json:"chain_certs,omitempty"`
	SANs           []string     `json:"sans"`
	Serial         string       `json:"serial"`
	Fingerprint    string       `json:"fingerprint"`
	ProbeMs        int          `json:"probe_ms"`
	Error          *string      `json:"error"`
	// SSL expansion fields
	Ciphers        []CipherInfo `json:"ciphers"`
	OCSPStapling   bool         `json:"ocsp_stapling"`
	SCTCount       int          `json:"sct_count"`
	HasSCTs        bool         `json:"has_scts"`
	ForwardSecrecy bool         `json:"forward_secrecy"`
	KeyExchange    string       `json:"key_exchange"`
}

func probeSSL(domain string) SSLResult {
	start := time.Now()

	// Try TLS 1.3 first, then fall back to 1.2
	protocols := []string{}
	var connState *tls.ConnectionState
	var connectErr error

	// Attempt connection with TLS 1.2+ (Go's default)
	conn, err := safeTLSDial(domain, 8*time.Second, &tls.Config{
		ServerName:         domain,
		InsecureSkipVerify: false,
	})
	if err != nil {
		// Try with InsecureSkipVerify to still get cert info for expired/self-signed
		conn, err = safeTLSDial(domain, 8*time.Second, &tls.Config{
			ServerName:         domain,
			InsecureSkipVerify: true,
		})
		if err != nil {
			connectErr = err
		}
	}

	if connectErr != nil {
		elapsed := int(time.Since(start).Milliseconds())
		errStr := connectErr.Error()
		return SSLResult{
			Grade:   "T",
			ProbeMs: elapsed,
			Error:   &errStr,
		}
	}
	defer conn.Close()

	state := conn.ConnectionState()
	connState = &state

	// Detect supported protocols by the negotiated version
	switch connState.Version {
	case tls.VersionTLS13:
		protocols = append(protocols, "TLS 1.3")
		// Also test TLS 1.2 support
		conn12, err := safeTLSDial(domain, 8*time.Second, &tls.Config{
			ServerName:         domain,
			InsecureSkipVerify: true,
			MaxVersion:         tls.VersionTLS12,
		})
		if err == nil {
			if conn12.ConnectionState().Version == tls.VersionTLS12 {
				protocols = append(protocols, "TLS 1.2")
			}
			conn12.Close()
		}
	case tls.VersionTLS12:
		protocols = append(protocols, "TLS 1.2")
	case tls.VersionTLS11:
		protocols = append(protocols, "TLS 1.1")
	case tls.VersionTLS10:
		protocols = append(protocols, "TLS 1.0")
	}

	elapsed := int(time.Since(start).Milliseconds())

	if len(connState.PeerCertificates) == 0 {
		errStr := "No peer certificates returned"
		return SSLResult{
			Grade:     "T",
			Protocols: protocols,
			ProbeMs:   elapsed,
			Error:     &errStr,
		}
	}

	leaf := connState.PeerCertificates[0]

	// Extract key info
	keyAlg := ""
	keySize := 0
	switch pub := leaf.PublicKey.(type) {
	case *ecdsa.PublicKey:
		keySize = pub.Curve.Params().BitSize
	case *ed25519.PublicKey:
		keySize = 256
	case interface{ Size() int }:
		keySize = pub.Size() * 8
	}
	switch leaf.PublicKeyAlgorithm {
	case x509.RSA:
		keyAlg = "RSA"
	case x509.ECDSA:
		keyAlg = "ECDSA"
	case x509.Ed25519:
		keyAlg = "Ed25519"
	default:
		keyAlg = leaf.PublicKeyAlgorithm.String()
	}

	// SHA-256 fingerprint of the leaf certificate
	fpRaw := sha256.Sum256(leaf.Raw)
	fingerprint := fmt.Sprintf("%X", fpRaw[:])

	// Validate chain
	chainValid := true
	opts := x509.VerifyOptions{
		DNSName: domain,
	}
	// Add intermediate certificates to the pool
	if len(connState.PeerCertificates) > 1 {
		intermediates := x509.NewCertPool()
		for _, cert := range connState.PeerCertificates[1:] {
			intermediates.AddCert(cert)
		}
		opts.Intermediates = intermediates
	}
	_, verifyErr := leaf.Verify(opts)
	if verifyErr != nil {
		chainValid = false
	}

	// SANs (limit to 20)
	sans := leaf.DNSNames
	if len(sans) > 20 {
		sans = sans[:20]
	}

	// Compute grade
	grade := computeGrade(connState, leaf, chainValid, protocols)

	// Serial as hex string
	serial := ""
	if leaf.SerialNumber != nil {
		serial = fmt.Sprintf("%X", leaf.SerialNumber)
	}

	// ─── SSL Expansion: OCSP, SCTs, Forward Secrecy, Ciphers ────────
	ocspStapling := len(connState.OCSPResponse) > 0
	scts := connState.SignedCertificateTimestamps
	sctCount := len(scts)
	hasSCTs := sctCount > 0
	forwardSecrecy, keyExchange := extractForwardSecrecy(connState)

	// Cipher enumeration (runs in parallel-ish, ~3s per cipher)
	ciphers := enumerateCiphers(domain)

	// Extract full certificate chain
	chainCerts := make([]ChainCert, 0, len(connState.PeerCertificates))
	for _, cert := range connState.PeerCertificates {
		certKeyAlg := ""
		certKeySize := 0
		switch pub := cert.PublicKey.(type) {
		case *ecdsa.PublicKey:
			certKeySize = pub.Curve.Params().BitSize
		case *ed25519.PublicKey:
			certKeySize = 256
		case interface{ Size() int }:
			certKeySize = pub.Size() * 8
		}
		switch cert.PublicKeyAlgorithm {
		case x509.RSA:
			certKeyAlg = "RSA"
		case x509.ECDSA:
			certKeyAlg = "ECDSA"
		case x509.Ed25519:
			certKeyAlg = "Ed25519"
		default:
			certKeyAlg = cert.PublicKeyAlgorithm.String()
		}

		certSerial := ""
		if cert.SerialNumber != nil {
			certSerial = fmt.Sprintf("%X", cert.SerialNumber)
		}

		// SANs only for leaf
		var certSANs []string
		if cert == leaf {
			certSANs = cert.DNSNames
			if len(certSANs) > 20 {
				certSANs = certSANs[:20]
			}
		}

		isSelfSigned := cert.Issuer.String() == cert.Subject.String()

		cc := ChainCert{
			Subject:      cert.Subject.String(),
			Issuer:       cert.Issuer.String(),
			ValidFrom:    cert.NotBefore.UTC().Format(time.RFC3339),
			ValidTo:      cert.NotAfter.UTC().Format(time.RFC3339),
			KeyAlg:       certKeyAlg,
			KeySize:      certKeySize,
			Serial:       certSerial,
			SANs:         certSANs,
			IsSelfSigned: isSelfSigned,
			SignatureAlg: cert.SignatureAlgorithm.String(),
		}
		chainCerts = append(chainCerts, cc)
	}

	return SSLResult{
		Grade:          grade,
		Issuer:         leaf.Issuer.String(),
		Subject:        leaf.Subject.String(),
		ValidFrom:      leaf.NotBefore.UTC().Format(time.RFC3339),
		ValidTo:        leaf.NotAfter.UTC().Format(time.RFC3339),
		KeyAlg:         keyAlg,
		KeySize:        keySize,
		Fingerprint:    fingerprint,
		Protocols:      protocols,
		ChainDepth:     len(connState.PeerCertificates),
		ChainValid:     chainValid,
		ChainCerts:     chainCerts,
		SANs:           sans,
		Serial:         serial,
		ProbeMs:        int(time.Since(start).Milliseconds()),
		Error:          nil,
		Ciphers:        ciphers,
		OCSPStapling:   ocspStapling,
		SCTCount:       sctCount,
		HasSCTs:        hasSCTs,
		ForwardSecrecy: forwardSecrecy,
		KeyExchange:    keyExchange,
	}
}

// classifyCipher returns a strength rating for a TLS cipher suite.
func classifyCipher(cs *tls.CipherSuite) string {
	if cs == nil {
		return "unknown"
	}
	// Insecure ciphers are in tls.InsecureCipherSuites()
	for _, ic := range tls.InsecureCipherSuites() {
		if ic.ID == cs.ID {
			return "insecure"
		}
	}
	name := cs.Name
	// Weak: CBC mode ciphers (vulnerable to padding oracles), non-ECDHE, 3DES
	if strings.Contains(name, "3DES") {
		return "weak"
	}
	if strings.Contains(name, "CBC") && !strings.Contains(name, "ECDHE") {
		return "weak"
	}
	// Strong: TLS 1.3 suites or ECDHE+AESGCM/CHACHA
	for _, v := range cs.SupportedVersions {
		if v == tls.VersionTLS13 {
			return "strong"
		}
	}
	if strings.Contains(name, "ECDHE") && (strings.Contains(name, "GCM") || strings.Contains(name, "CHACHA")) {
		return "strong"
	}
	return "acceptable"
}

// enumerateCiphers probes a domain to find which cipher suites it supports.
func enumerateCiphers(domain string) []CipherInfo {
	var supported []CipherInfo

	// Test TLS 1.3 ciphers (always offered by the client, negotiated by server)
	conn13, err := safeTLSDial(domain, 5*time.Second, &tls.Config{
		ServerName:         domain,
		InsecureSkipVerify: true,
		MinVersion:         tls.VersionTLS13,
		MaxVersion:         tls.VersionTLS13,
	})
	if err == nil {
		state := conn13.ConnectionState()
		cs := tls.CipherSuiteName(state.CipherSuite)
		supported = append(supported, CipherInfo{
			Name:     cs,
			ID:       state.CipherSuite,
			Strength: "strong", // all TLS 1.3 ciphers are strong
		})
		conn13.Close()
	}

	// Test TLS 1.2 ciphers one-by-one
	allSuites := append(tls.CipherSuites(), tls.InsecureCipherSuites()...)
	for _, cs := range allSuites {
		// Skip TLS 1.3-only suites (already tested above)
		tls13Only := true
		for _, v := range cs.SupportedVersions {
			if v != tls.VersionTLS13 {
				tls13Only = false
				break
			}
		}
		if tls13Only {
			continue
		}

		conn, err := safeTLSDial(domain, 3*time.Second, &tls.Config{
			ServerName:         domain,
			InsecureSkipVerify: true,
			MaxVersion:         tls.VersionTLS12,
			MinVersion:         tls.VersionTLS10,
			CipherSuites:       []uint16{cs.ID},
		})
		if err == nil {
			supported = append(supported, CipherInfo{
				Name:     cs.Name,
				ID:       cs.ID,
				Strength: classifyCipher(cs),
			})
			conn.Close()
		}
	}

	return supported
}

// extractForwardSecrecy checks if the negotiated cipher uses ECDHE key exchange.
func extractForwardSecrecy(state *tls.ConnectionState) (bool, string) {
	name := tls.CipherSuiteName(state.CipherSuite)
	// TLS 1.3 always uses forward secrecy
	if state.Version == tls.VersionTLS13 {
		return true, "ECDHE (TLS 1.3)"
	}
	if strings.Contains(name, "ECDHE") {
		return true, "ECDHE"
	}
	if strings.Contains(name, "DHE") && !strings.Contains(name, "ECDHE") {
		return true, "DHE"
	}
	return false, "RSA (no forward secrecy)"
}

func computeGrade(state *tls.ConnectionState, leaf *x509.Certificate, chainValid bool, protocols []string) string {
	if !chainValid {
		return "T" // Trust issues (expired, self-signed, wrong hostname)
	}

	now := time.Now()
	if now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
		return "T"
	}

	hasTLS13 := false
	hasTLS10or11 := false
	for _, p := range protocols {
		if p == "TLS 1.3" {
			hasTLS13 = true
		}
		if p == "TLS 1.0" || p == "TLS 1.1" {
			hasTLS10or11 = true
		}
	}

	// Key strength check
	weakKey := false
	switch leaf.PublicKeyAlgorithm {
	case x509.RSA:
		if k, ok := leaf.PublicKey.(interface{ Size() int }); ok {
			if k.Size()*8 < 2048 {
				weakKey = true
			}
		}
	}

	if hasTLS10or11 {
		return "B"
	}
	if weakKey {
		return "B"
	}
	if hasTLS13 {
		return "A+"
	}
	return "A"
}

// ─── HTTP Status Probe ──────────────────────────────────────────────

type StatusResult struct {
	IsUp           bool    `json:"is_up"`
	StatusCode     *int    `json:"status_code"`
	ResponseTimeMs int     `json:"response_time_ms"`
	Error          *string `json:"error"`
	StatusLabel    string  `json:"status_label"`
	HttpBlocked    bool    `json:"http_blocked"`
	HTTP2          bool    `json:"http2"`
	HTTP3          bool    `json:"http3"`
	AltSvc         *string `json:"alt_svc"`
}

func probeStatus(domain string) StatusResult {
	start := time.Now()

	currentURL := "https://" + domain
	var finalStatus int
	var lastErr error
	var http2Detected bool
	var http3Detected bool
	var altSvcPtr *string

	noRedirectClient := &http.Client{
		Timeout:   10 * time.Second,
		Transport: safeTransport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	for i := 0; i < 5; i++ {
		req, err := http.NewRequest("GET", currentURL, nil)
		if err != nil {
			lastErr = err
			break
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

		resp, err := noRedirectClient.Do(req)
		if err != nil {
			lastErr = err
			break
		}
		resp.Body.Close()
		finalStatus = resp.StatusCode

		// Detect HTTP/2 from the final response (not redirects)
		if resp.StatusCode < 300 || resp.StatusCode >= 400 {
			http2Detected = resp.ProtoMajor == 2
			altSvc := resp.Header.Get("Alt-Svc")
			if altSvc != "" {
				altSvcPtr = &altSvc
				if strings.Contains(altSvc, "h3=") || strings.Contains(altSvc, "h3-") {
					http3Detected = true
				}
			}
		}

		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			loc := resp.Header.Get("Location")
			if loc != "" {
				if strings.HasPrefix(loc, "http") {
					currentURL = loc
				} else {
					currentURL = "https://" + domain + loc
				}
				continue
			}
		}
		break
	}

	elapsed := int(time.Since(start).Milliseconds())

	if lastErr != nil {
		errStr := lastErr.Error()
		return StatusResult{
			IsUp:           false,
			StatusCode:     nil,
			ResponseTimeMs: elapsed,
			Error:          &errStr,
			StatusLabel:    "DOWN",
			HttpBlocked:    false,
			HTTP2:          false,
			HTTP3:          false,
			AltSvc:         nil,
		}
	}

	isUp := finalStatus >= 200 && finalStatus < 400
	isBlocked := finalStatus == 403 || finalStatus == 503 || finalStatus == 502 || finalStatus == 429

	var errMsg *string
	if isBlocked {
		msg := fmt.Sprintf("Site returned HTTP %d — may be blocking automated requests", finalStatus)
		errMsg = &msg
	}

	label := "DOWN"
	if isUp {
		label = "UP"
	} else if isBlocked {
		label = "RESTRICTED"
	}

	return StatusResult{
		IsUp:           isUp || isBlocked,
		StatusCode:     &finalStatus,
		ResponseTimeMs: elapsed,
		Error:          errMsg,
		StatusLabel:    label,
		HttpBlocked:    isBlocked,
		HTTP2:          http2Detected,
		HTTP3:          http3Detected,
		AltSvc:         altSvcPtr,
	}
}

// ─── HTTP Protocol Probe ────────────────────────────────────────────

type ProtocolResult struct {
	HTTP2  bool    `json:"http2"`
	HTTP3  bool    `json:"http3"`
	AltSvc *string `json:"alt_svc"`
	Error  *string `json:"error"`
}

func probeProtocols(domain string) ProtocolResult {
	// Make an HTTP/2 request and check alt-svc header for h3
	client := &http.Client{
		Timeout:   8 * time.Second,
		Transport: safeTransport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	req, err := http.NewRequest("HEAD", "https://"+domain, nil)
	if err != nil {
		errStr := err.Error()
		return ProtocolResult{Error: &errStr}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	resp, err := client.Do(req)
	if err != nil {
		errStr := err.Error()
		return ProtocolResult{Error: &errStr}
	}
	defer resp.Body.Close()

	// Go's default HTTP client negotiates HTTP/2 via ALPN when available
	http2 := resp.ProtoMajor == 2

	// Check alt-svc header for HTTP/3 advertisement
	altSvc := resp.Header.Get("Alt-Svc")
	var altSvcPtr *string
	http3 := false
	if altSvc != "" {
		altSvcPtr = &altSvc
		// h3= or h3-29= etc indicates HTTP/3 support
		if strings.Contains(altSvc, "h3=") || strings.Contains(altSvc, "h3-") {
			http3 = true
		}
	}

	return ProtocolResult{
		HTTP2:  http2,
		HTTP3:  http3,
		AltSvc: altSvcPtr,
	}
}

// ─── Connection Timing Probe ────────────────────────────────────────

type TimingResult struct {
	DnsMs      float64 `json:"dns_ms"`
	TcpMs      float64 `json:"tcp_ms"`
	TlsMs      float64 `json:"tls_ms"`
	TotalMs    float64 `json:"total_ms"`
	IP         *string `json:"ip"`
	TLSVersion *string `json:"tls_version"`
	Error      *string `json:"error"`
}

func probeTiming(host string) TimingResult {
	var result TimingResult

	// Phase 1: DNS lookup
	resolver := &net.Resolver{}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dnsStart := time.Now()
	ips, err := resolver.LookupHost(ctx, host)
	result.DnsMs = float64(time.Since(dnsStart).Microseconds()) / 1000.0

	if err != nil {
		errStr := fmt.Sprintf("DNS lookup failed: %s", err.Error())
		result.Error = &errStr
		result.TotalMs = result.DnsMs
		return result
	}

	// Find first non-private IP
	var chosenIP string
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip != nil && !isPrivateIP(ip) {
			chosenIP = ipStr
			break
		}
	}
	if chosenIP == "" {
		errStr := "no valid IPs found (SSRF protection)"
		result.Error = &errStr
		result.TotalMs = result.DnsMs
		return result
	}
	result.IP = &chosenIP

	// Phase 2: TCP handshake
	addr := net.JoinHostPort(chosenIP, "443")
	tcpStart := time.Now()
	tcpConn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	result.TcpMs = float64(time.Since(tcpStart).Microseconds()) / 1000.0

	if err != nil {
		errStr := fmt.Sprintf("TCP connect failed: %s", err.Error())
		result.Error = &errStr
		result.TotalMs = result.DnsMs + result.TcpMs
		return result
	}
	defer tcpConn.Close()

	// Phase 3: TLS handshake
	tlsConn := tls.Client(tcpConn, &tls.Config{ServerName: host})
	tlsStart := time.Now()
	err = tlsConn.Handshake()
	result.TlsMs = float64(time.Since(tlsStart).Microseconds()) / 1000.0

	if err != nil {
		errStr := fmt.Sprintf("TLS handshake failed: %s", err.Error())
		result.Error = &errStr
		result.TotalMs = result.DnsMs + result.TcpMs + result.TlsMs
		return result
	}
	defer tlsConn.Close()

	// Extract TLS version
	state := tlsConn.ConnectionState()
	var tlsVersion string
	switch state.Version {
	case tls.VersionTLS10:
		tlsVersion = "TLS 1.0"
	case tls.VersionTLS11:
		tlsVersion = "TLS 1.1"
	case tls.VersionTLS12:
		tlsVersion = "TLS 1.2"
	case tls.VersionTLS13:
		tlsVersion = "TLS 1.3"
	default:
		tlsVersion = fmt.Sprintf("unknown (0x%04x)", state.Version)
	}
	result.TLSVersion = &tlsVersion

	result.TotalMs = result.DnsMs + result.TcpMs + result.TlsMs
	return result
}

// ─── HTTP Content Fallback Probe ─────────────────────────────────────

type HTTPProbeResult struct {
	StatusCode    int               `json:"status_code"`
	Headers       map[string]string `json:"headers"`
	BodyPreview   string            `json:"body_preview"`
	ResponseMs    int               `json:"response_time_ms"`
	RedirectChain []string          `json:"redirect_chain"`
	FinalURL      string            `json:"final_url"`
	Error         *string           `json:"error"`
}

func probeHTTP(domain string) HTTPProbeResult {
	start := time.Now()
	chain := []string{}
	currentURL := "https://" + domain

	client := &http.Client{
		Timeout:   15 * time.Second,
		Transport: safeTransport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			chain = append(chain, req.URL.String())
			return nil
		},
	}

	req, err := http.NewRequest("GET", currentURL, nil)
	if err != nil {
		elapsed := int(time.Since(start).Milliseconds())
		errStr := err.Error()
		return HTTPProbeResult{ResponseMs: elapsed, Error: &errStr, RedirectChain: chain}
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	resp, err := client.Do(req)
	if err != nil {
		elapsed := int(time.Since(start).Milliseconds())
		errStr := err.Error()
		return HTTPProbeResult{ResponseMs: elapsed, Error: &errStr, RedirectChain: chain}
	}
	defer resp.Body.Close()

	// Collect headers (lowercase keys)
	headers := make(map[string]string)
	for k := range resp.Header {
		headers[strings.ToLower(k)] = resp.Header.Get(k)
	}

	// Read body preview (first 32KB)
	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	bodyPreview := string(bodyBytes)

	elapsed := int(time.Since(start).Milliseconds())

	return HTTPProbeResult{
		StatusCode:    resp.StatusCode,
		Headers:       headers,
		BodyPreview:   bodyPreview,
		ResponseMs:    elapsed,
		RedirectChain: chain,
		FinalURL:      resp.Request.URL.String(),
		Error:         nil,
	}
}

// ─── PageSpeed Insights Proxy ────────────────────────────────────────

type PageSpeedResult struct {
	Score      *int     `json:"score"`
	FCP        *float64 `json:"fcp"`
	LCP        *float64 `json:"lcp"`
	TBT        *float64 `json:"tbt"`
	CLS        *float64 `json:"cls"`
	SI         *float64 `json:"si"`
	TTFB       *float64 `json:"ttfb"`
	Strategy   string   `json:"strategy"`
	Error      *string  `json:"error"`
	Screenshot *string  `json:"screenshot"`
}

func proxyPageSpeed(domain string, apiKey string, strategy string) PageSpeedResult {
	keyParam := ""
	if apiKey != "" {
		keyParam = "&key=" + apiKey
	}
	
	url := fmt.Sprintf("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://%s&strategy=%s&category=performance%s", domain, strategy, keyParam)
	
	client := &http.Client{Timeout: 60 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		errStr := fmt.Sprintf("request failed: %s", err.Error())
		return PageSpeedResult{Error: &errStr, Strategy: strategy}
	}
	
	resp, err := client.Do(req)
	if err != nil {
		errStr := fmt.Sprintf("API request failed: %s", err.Error())
		return PageSpeedResult{Error: &errStr, Strategy: strategy}
	}
	defer resp.Body.Close()
	
	body, err := io.ReadAll(io.LimitReader(resp.Body, 5<<20)) // 5MB limit
	if err != nil {
		errStr := fmt.Sprintf("read failed: %s", err.Error())
		return PageSpeedResult{Error: &errStr, Strategy: strategy}
	}
	
	if resp.StatusCode == 429 {
		errStr := "Rate limited — try again later"
		return PageSpeedResult{Error: &errStr, Strategy: strategy}
	}
	
	if resp.StatusCode != 200 {
		errStr := fmt.Sprintf("API error (%d)", resp.StatusCode)
		return PageSpeedResult{Error: &errStr, Strategy: strategy}
	}
	
	var data struct {
		LighthouseResult struct {
			Categories struct {
				Performance struct {
					Score *float64 `json:"score"`
				} `json:"performance"`
			} `json:"categories"`
			Audits map[string]struct {
				NumericValue *float64 `json:"numericValue"`
				Details struct {
					Data string `json:"data"`
				} `json:"details"`
			} `json:"audits"`
		} `json:"lighthouseResult"`
	}
	
	if err := json.Unmarshal(body, &data); err != nil {
		errStr := fmt.Sprintf("parse failed: %s", err.Error())
		return PageSpeedResult{Error: &errStr, Strategy: strategy}
	}
	
	lr := data.LighthouseResult
	audits := lr.Audits

	var score *int
	if lr.Categories.Performance.Score != nil {
		s := int(*lr.Categories.Performance.Score * 100)
		score = &s
	}

	var screenshot *string
	if audits != nil {
		if details, ok := audits["final-screenshot"]; ok {
			if details.Details.Data != "" {
				screenshot = &details.Details.Data
			}
		}
	}

	// Helper to safely extract a metric from the audits map.
	auditMetric := func(key string) *float64 {
		if audits == nil {
			return nil
		}
		if a, ok := audits[key]; ok {
			return a.NumericValue
		}
		return nil
	}

	return PageSpeedResult{
		Score:      score,
		FCP:        auditMetric("first-contentful-paint"),
		LCP:        auditMetric("largest-contentful-paint"),
		TBT:        auditMetric("total-blocking-time"),
		CLS:        auditMetric("cumulative-layout-shift"),
		SI:         auditMetric("speed-index"),
		TTFB:       auditMetric("server-response-time"),
		Strategy:   strategy,
		Error:      nil,
		Screenshot: screenshot,
	}
}
