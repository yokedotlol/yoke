package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/mattn/go-isatty"
	toml "github.com/pelletier/go-toml/v2"
	"github.com/spf13/cobra"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

var apiBase string

// isTTY is true when stdout is an interactive terminal (not piped).
// When false, spinners, progress bars, and raw ANSI escape codes are suppressed.
var isTTY = isatty.IsTerminal(os.Stdout.Fd()) || isatty.IsCygwinTerminal(os.Stdout.Fd())

// ─── Version Check ──────────────────────────────────────────────────

var versionCheckDone bool

// checkServerMinVersion reads X-Yoke-Min-Client from a response and
// warns on stderr if the CLI version is older than required.
// Safe to call multiple times — only prints once per invocation.
func checkServerMinVersion(resp *http.Response) {
	if versionCheckDone || version == "dev" {
		return
	}
	versionCheckDone = true
	minClient := resp.Header.Get("X-Yoke-Min-Client")
	if minClient == "" {
		return
	}
	if semverLessThan(version, minClient) {
		fmt.Fprintf(os.Stderr, "⚠ Update available: your CLI is v%s, server requires v%s. Run: brew upgrade yokedotlol/tap/yoke\n", version, minClient)
	}
}

// semverLessThan returns true if a < b using simple major.minor.patch comparison.
func semverLessThan(a, b string) bool {
	aParts := parseSemver(a)
	bParts := parseSemver(b)
	for i := 0; i < 3; i++ {
		if aParts[i] < bParts[i] {
			return true
		}
		if aParts[i] > bParts[i] {
			return false
		}
	}
	return false
}

func parseSemver(v string) [3]int {
	v = strings.TrimPrefix(v, "v")
	parts := strings.SplitN(v, ".", 3)
	var result [3]int
	for i := 0; i < 3 && i < len(parts); i++ {
		n, _ := strconv.Atoi(parts[i])
		result[i] = n
	}
	return result
}

// ─── Config ─────────────────────────────────────────────────────────

type Config struct {
	OpenRouterKey  string `toml:"openrouter_key,omitempty"`
	SuppressAIHint bool   `toml:"suppress_ai_hint,omitempty"`
	DefaultModel   string `toml:"default_model,omitempty"`
	BaseURL        string `toml:"base_url,omitempty"`
	PromptFile     string `toml:"prompt_file,omitempty"`
	Prompt         string `toml:"prompt,omitempty"`
}

const defaultBaseURL = "https://yoke.lol"

// resolveCustomPrompt returns the effective custom prompt from config, or "" for server default.
// Priority: prompt_file (read from disk) > prompt (inline in config) > "" (use server default).
// If both are set, prompt_file wins.
func resolveCustomPrompt(cfg Config) (string, error) {
	if cfg.PromptFile != "" {
		p := cfg.PromptFile
		if strings.HasPrefix(p, "~/") {
			home, _ := os.UserHomeDir()
			p = filepath.Join(home, p[2:])
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return "", fmt.Errorf("reading prompt file %s: %w", cfg.PromptFile, err)
		}
		return strings.TrimSpace(string(data)), nil
	}
	if cfg.Prompt != "" {
		return strings.TrimSpace(cfg.Prompt), nil
	}
	return "", nil
}

// maxResponseBytes caps the maximum API response body size (10 MB).
const maxResponseBytes = 10 << 20

// resolveBaseURL determines which Yoke instance the CLI talks to.
// Precedence: YOKE_BASE_URL env var > config file base_url > yoke.lol.
// Always returned without a trailing slash.
func resolveBaseURL(cfg Config) string {
	url := defaultBaseURL
	if cfg.BaseURL != "" {
		url = cfg.BaseURL
	}
	if env := strings.TrimSpace(os.Getenv("YOKE_BASE_URL")); env != "" {
		url = env
	}
	return strings.TrimRight(strings.TrimSpace(url), "/")
}

func configPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".yoke.toml")
}

func loadConfig() Config {
	var cfg Config
	data, err := os.ReadFile(configPath())
	if err != nil {
		// Try legacy .yokerc (JSON) and migrate if found
		home, _ := os.UserHomeDir()
		legacy := filepath.Join(home, ".yokerc")
		data, err = os.ReadFile(legacy)
		if err != nil {
			return cfg
		}
		// Parse legacy JSON config using a JSON-tagged struct
		var legacyCfg struct {
			OpenRouterKey  string `json:"openrouter_key"`
			SuppressAIHint bool   `json:"suppress_ai_hint"`
			DefaultModel   string `json:"default_model"`
			BaseURL        string `json:"base_url"`
		}
		if json.Unmarshal(data, &legacyCfg) == nil && legacyCfg.OpenRouterKey != "" {
			cfg = Config{
				OpenRouterKey:  legacyCfg.OpenRouterKey,
				SuppressAIHint: legacyCfg.SuppressAIHint,
				DefaultModel:   legacyCfg.DefaultModel,
				BaseURL:        legacyCfg.BaseURL,
			}
			// Migrate to TOML
			saveConfig(cfg)
			os.Remove(legacy)
		}
		return cfg
	}
	toml.Unmarshal(data, &cfg)
	return cfg
}

func saveConfig(cfg Config) {
	data, _ := toml.Marshal(cfg)
	os.WriteFile(configPath(), data, 0600)
}

// ─── Styles ─────────────────────────────────────────────────────────

var (
	title    = lipgloss.NewStyle().Bold(true)
	dim      = lipgloss.NewStyle().Faint(true)
	good     = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	warn     = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	bad      = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
	info     = lipgloss.NewStyle().Foreground(lipgloss.Color("4"))
	accent   = lipgloss.NewStyle().Foreground(lipgloss.Color("6"))
	axisName = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Width(14)

	cardBox = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("8")).
		Padding(0, 1)
)

func tierStyle(tier string) lipgloss.Style {
	switch tier {
	case "Excellent":
		return good
	case "Strong":
		return info
	case "Moderate":
		return warn
	default:
		return bad
	}
}

// ─── API Types ──────────────────────────────────────────────────────

type AnalysisResult struct {
	Domain        string          `json:"domain"`
	Score         *ScoreBlock     `json:"domain_score"`
	SSL           *SSLInfo        `json:"ssl"`
	Hosting       *HostInfo       `json:"hosting"`
	TechStack     json.RawMessage `json:"tech_stack"`
	Performance   *PerfInfo       `json:"performance"`
	AnalyzedAt    string          `json:"analyzed_at"`
	Cached        bool            `json:"cached"`
	CachedAt      *int64          `json:"cached_at,omitempty"`
	HTTPProtocols *HTTPProto      `json:"http_protocols"`
}

type ScoreBlock struct {
	Composite int                `json:"composite"`
	Tier      string             `json:"tier"`
	Axes      map[string]AxisVal `json:"axes"`
	Archetype *Archetype         `json:"archetype"`
}

type AxisVal struct {
	Score    int       `json:"score"`
	Weight   float64   `json:"weight"`
	Findings []Finding `json:"findings"`
}

type Finding struct {
	Signal   string `json:"signal"`
	Axis     string `json:"axis"`
	Severity string `json:"severity"`
	Label    string `json:"label"`
	Weight   int    `json:"weight"`
}

type Archetype struct {
	Detected   string  `json:"detected"`
	Confidence float64 `json:"confidence"`
}

type SSLInfo struct {
	Grade   string `json:"grade"`
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
	ValidTo string `json:"valid_to"`
}

type HostInfo struct {
	Provider string `json:"provider"`
	CDN      string `json:"cdn"`
	WAF      string `json:"waf"`
}

type PerfInfo struct {
	Score float64 `json:"score"`
	LCP   float64 `json:"lcp"`
	CLS   float64 `json:"cls"`
	TTFB  float64 `json:"ttfb"`
	FCP   float64 `json:"fcp"`
}

type HTTPProto struct {
	HTTP2 bool `json:"http2"`
	HTTP3 bool `json:"http3"`
}

// ─── API Client ─────────────────────────────────────────────────────

func fetchJSON(url string) ([]byte, error) {
	client := &http.Client{Timeout: 90 * time.Second}
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
	checkServerMinVersion(resp)

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read failed: %w", err)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}
	return body, nil
}

// ─── Spinner ────────────────────────────────────────────────────────

// spinner shows an animated spinner with a message on a single line.
// Call stop() to clear the line and stop the animation.
type spinner struct {
	msg    string
	stopCh chan struct{}
	wg     sync.WaitGroup
}

var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

func startSpinner(message string) *spinner {
	s := &spinner{msg: message, stopCh: make(chan struct{})}
	if !isTTY {
		// No animation when piped — just return a no-op spinner
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			<-s.stopCh
		}()
		return s
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		i := 0
		ticker := time.NewTicker(80 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-s.stopCh:
				fmt.Print("\033[2K\r") // clear the spinner line
				return
			case <-ticker.C:
				frame := accent.Render(spinnerFrames[i%len(spinnerFrames)])
				fmt.Printf("\033[2K\r  %s %s", frame, dim.Render(s.msg))
				i++
			}
		}
	}()
	return s
}

func (s *spinner) stop() {
	close(s.stopCh)
	s.wg.Wait()
}

func fetchAnalysis(domain string) (*AnalysisResult, error) {
	body, err := fetchJSON(apiBase + "/" + domain)
	if err != nil {
		return nil, err
	}
	var result AnalysisResult
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse failed: %w", err)
	}
	return &result, nil
}

// ─── SSE Streaming Analysis ─────────────────────────────────────────

// sseCheck tracks one in-flight check during streaming.
type sseCheck struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Done  bool
	Error bool
}

// fetchAnalysisStream connects to the SSE streaming endpoint and shows
// live terminal progress as each check completes.  Falls back to the
// plain JSON endpoint when the server doesn't support streaming.
func fetchAnalysisStream(domain string, force ...bool) (*AnalysisResult, error) {
	client := &http.Client{Timeout: 120 * time.Second}

	// Use POST /api/analyze which supports SSE streaming
	forceVal := len(force) > 0 && force[0]
	payload := fmt.Sprintf(`{"domain":%q,"force":%t}`, domain, forceVal)
	req, err := http.NewRequest("POST", apiBase+"/api/analyze", strings.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "yoke-cli/"+version)

	resp, err := client.Do(req)
	if err != nil {
		return fetchAnalysis(domain) // fallback
	}
	defer resp.Body.Close()
	checkServerMinVersion(resp)

	// If server returned JSON instead of SSE, parse it directly.
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if err != nil {
			return nil, fmt.Errorf("read failed: %w", err)
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
		}
		var result AnalysisResult
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("parse failed: %w", err)
		}
		return &result, nil
	}

	// ── Parse SSE stream ────────────────────────────────────────────
	var (
		checks    []sseCheck
		completed int
		total     int
		eventType string
		lines     int // how many progress lines we printed (for clearing)
	)

	scanner := bufio.NewScanner(resp.Body)
	// Increase scanner buffer for the large "done" event payload.
	scanner.Buffer(make([]byte, 0, 512*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue // blank line or comment
		}
		data := strings.TrimPrefix(line, "data:")
		data = strings.TrimSpace(data)

		switch eventType {
		case "phase":
			var p struct {
				Total  int        `json:"total"`
				Checks []sseCheck `json:"checks"`
			}
			if json.Unmarshal([]byte(data), &p) == nil {
				if p.Total > 0 {
					total = p.Total
				}
				if len(p.Checks) > 0 {
					checks = p.Checks
				}
			}

		case "result":
			var r struct {
				Key       string `json:"key"`
				Label     string `json:"label"`
				Completed *int   `json:"completed"`
				Total     *int   `json:"total"`
				Error     bool   `json:"error"`
			}
			if json.Unmarshal([]byte(data), &r) == nil {
				if r.Completed != nil {
					completed = *r.Completed
				}
				if r.Total != nil {
					total = *r.Total
				}
				// Update our check list.
				found := false
				for i := range checks {
					if checks[i].Key == r.Key {
						checks[i].Done = true
						checks[i].Error = r.Error
						if r.Label != "" {
							checks[i].Label = r.Label
						}
						found = true
						break
					}
				}
				if !found && r.Key != "" {
					label := r.Label
					if label == "" {
						label = r.Key
					}
					checks = append(checks, sseCheck{Key: r.Key, Label: label, Done: true, Error: r.Error})
				}
			}
			lines = renderProgress(domain, checks, completed, total, lines)

		case "done":
			clearProgress(lines)
			var result AnalysisResult
			if err := json.Unmarshal([]byte(data), &result); err != nil {
				return nil, fmt.Errorf("parse failed: %w", err)
			}
			return &result, nil

		case "error":
			clearProgress(lines)
			var e struct {
				Message string `json:"message"`
			}
			if json.Unmarshal([]byte(data), &e) == nil {
				return nil, fmt.Errorf("analysis failed: %s", e.Message)
			}
			return nil, fmt.Errorf("analysis failed")
		}
		eventType = "" // reset for next event
	}
	if err := scanner.Err(); err != nil {
		clearProgress(lines)
		return nil, fmt.Errorf("stream read error: %w", err)
	}

	clearProgress(lines)
	return nil, fmt.Errorf("stream ended without results")
}

// fetchAnalysisStreamWithProgress is like fetchAnalysisStream but calls a
// progress callback instead of rendering to the terminal directly. Used by
// compare to run two progress bars in parallel.
func fetchAnalysisStreamWithProgress(domain string, onProgress func(checks []sseCheck, completed, total int), force ...bool) (*AnalysisResult, error) {
	client := &http.Client{Timeout: 120 * time.Second}
	forceVal := len(force) > 0 && force[0]
	payload := fmt.Sprintf(`{"domain":%q,"force":%t}`, domain, forceVal)
	req, err := http.NewRequest("POST", apiBase+"/api/analyze", strings.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "yoke-cli/"+version)

	resp, err := client.Do(req)
	if err != nil {
		return fetchAnalysis(domain)
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/event-stream") {
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if err != nil {
			return nil, fmt.Errorf("read failed: %w", err)
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
		}
		var result AnalysisResult
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("parse failed: %w", err)
		}
		return &result, nil
	}

	var (
		checks    []sseCheck
		completed int
		total     int
		eventType string
	)

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 512*1024), 10*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimPrefix(line, "data:")
		data = strings.TrimSpace(data)

		switch eventType {
		case "phase":
			var p struct {
				Total  int        `json:"total"`
				Checks []sseCheck `json:"checks"`
			}
			if json.Unmarshal([]byte(data), &p) == nil {
				if p.Total > 0 { total = p.Total }
				if len(p.Checks) > 0 { checks = p.Checks }
			}

		case "result":
			var r struct {
				Key       string `json:"key"`
				Label     string `json:"label"`
				Completed *int   `json:"completed"`
				Total     *int   `json:"total"`
				Error     bool   `json:"error"`
			}
			if json.Unmarshal([]byte(data), &r) == nil {
				if r.Completed != nil { completed = *r.Completed }
				if r.Total != nil { total = *r.Total }
				found := false
				for i := range checks {
					if checks[i].Key == r.Key {
						checks[i].Done = true
						checks[i].Error = r.Error
						if r.Label != "" { checks[i].Label = r.Label }
						found = true
						break
					}
				}
				if !found && r.Key != "" {
					label := r.Label
					if label == "" { label = r.Key }
					checks = append(checks, sseCheck{Key: r.Key, Label: label, Done: true, Error: r.Error})
				}
			}
			onProgress(checks, completed, total)

		case "done":
			var result AnalysisResult
			if err := json.Unmarshal([]byte(data), &result); err != nil {
				return nil, fmt.Errorf("parse failed: %w", err)
			}
			onProgress(checks, total, total) // final update
			return &result, nil

		case "error":
			var e struct { Message string `json:"message"` }
			if json.Unmarshal([]byte(data), &e) == nil {
				return nil, fmt.Errorf("analysis failed: %s", e.Message)
			}
			return nil, fmt.Errorf("analysis failed")
		}
		eventType = ""
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("stream read error: %w", err)
	}
	return nil, fmt.Errorf("stream ended without results")
}

// runCompareJSON handles compare in --json mode (no progress, plain request).
func runCompareJSON(d1, d2 string) error {
	client := &http.Client{Timeout: 120 * time.Second}
	payloadBytes, _ := json.Marshal(map[string]string{"domain1": d1, "domain2": d2})
	req, err := http.NewRequest("POST", apiBase+"/api/compare", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return fmt.Errorf("request setup failed: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "yoke-cli/"+version)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("read failed: %w", err)
	}
	os.Stdout.Write(body)
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("API error %d", resp.StatusCode)
	}
	return nil
}

// renderProgress draws the live progress display and returns the number
// of lines printed (so we can clear them on the next update).
func renderProgress(domain string, checks []sseCheck, completed, total int, prevLines int) int {
	if !isTTY {
		return 0
	}
	clearProgress(prevLines)

	if total == 0 {
		line := fmt.Sprintf("  %s %s", accent.Render("⚡"), dim.Render("Analyzing "+domain+"..."))
		fmt.Print(line)
		return 1
	}

	// Progress bar: ████████░░░░░░░░░░░░ 12/26
	barWidth := 20
	filled := 0
	if total > 0 {
		filled = completed * barWidth / total
	}
	if filled > barWidth {
		filled = barWidth
	}
	bar := good.Render(strings.Repeat("█", filled)) + dim.Render(strings.Repeat("░", barWidth-filled))
	header := fmt.Sprintf("  %s %s %s %s",
		accent.Render("⚡"),
		dim.Render("Analyzing "+domain+"..."),
		bar,
		dim.Render(fmt.Sprintf("%d/%d", completed, total)))
	fmt.Println(header)

	// Check status line: show completed checks with ✓/✗, pending with ·
	var parts []string
	maxShow := 12 // limit how many checks to show on one line
	shown := 0
	for _, c := range checks {
		if shown >= maxShow {
			remaining := len(checks) - shown
			if remaining > 0 {
				parts = append(parts, dim.Render(fmt.Sprintf("+%d more", remaining)))
			}
			break
		}
		shortLabel := c.Label
		if len(shortLabel) > 12 {
			shortLabel = shortLabel[:12]
		}
		if c.Done && c.Error {
			parts = append(parts, bad.Render("✗")+dim.Render(" "+shortLabel))
		} else if c.Done {
			parts = append(parts, good.Render("✓")+dim.Render(" "+shortLabel))
		} else {
			parts = append(parts, dim.Render("· "+shortLabel))
		}
		shown++
	}
	if len(parts) > 0 {
		fmt.Println("  " + strings.Join(parts, "  "))
		return 2
	}

	return 1
}

// clearProgress moves the cursor up and clears the lines we previously printed.
// After Println, the cursor is on the line *below* the last printed content.
func clearProgress(lines int) {
	if !isTTY {
		return
	}
	for i := 0; i < lines; i++ {
		fmt.Print("\033[A")  // cursor up one line
		fmt.Print("\033[2K") // clear entire line
	}
	fmt.Print("\r") // return to column 0
}

// ─── Rendering ──────────────────────────────────────────────────────

func severityIcon(s string) string {
	switch s {
	case "good":
		return good.Render("✓")
	case "critical":
		return bad.Render("✗")
	case "high":
		return bad.Render("!")
	case "medium":
		return warn.Render("~")
	case "low":
		return warn.Render("·")
	case "info":
		return info.Render("ℹ")
	default:
		return dim.Render("·")
	}
}

func renderBar(score int, width int) string {
	filled := score * width / 100
	if filled > width {
		filled = width
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
	style := good
	if score < 70 {
		style = bad
	} else if score < 85 {
		style = warn
	}
	return style.Render(bar)
}

func printAnalysis(r *AnalysisResult) {
	if r.Score == nil {
		fmt.Println(warn.Render("No score data available"))
		return
	}

	var lines []string

	// Cached results banner
	if r.Cached {
		ts := r.AnalyzedAt
		if r.CachedAt != nil {
			t := time.UnixMilli(*r.CachedAt)
			ts = t.Format("Jan 2 3:04 PM")
		}
		lines = append(lines, dim.Render(fmt.Sprintf("⚡ Cached results from %s", ts)))
		lines = append(lines, "")
	}

	// Header: domain + score + tier
	tier := tierStyle(r.Score.Tier).Bold(true).Render(r.Score.Tier)
	lines = append(lines, fmt.Sprintf(
		"%s  %s %s",
		title.Render(r.Domain),
		title.Render(fmt.Sprintf("%d/100", r.Score.Composite)),
		tier,
	))

	if r.Score.Archetype != nil && r.Score.Archetype.Detected != "" {
		lines = append(lines, dim.Render(r.Score.Archetype.Detected))
	}
	lines = append(lines, "")

	// Axis scores with bars
	for _, name := range sortedAxes(r.Score.Axes) {
		ax := r.Score.Axes[name]
		label := axisName.Render(strings.ToUpper(name))
		bar := renderBar(ax.Score, 20)
		lines = append(lines, fmt.Sprintf("%s %s %s", label, bar, dim.Render(fmt.Sprintf("%d", ax.Score))))
	}
	lines = append(lines, "")

	// Quick facts row
	var facts []string
	if r.SSL != nil && r.SSL.Grade != "" {
		facts = append(facts, fmt.Sprintf("SSL %s", r.SSL.Grade))
	}
	if r.HTTPProtocols != nil {
		if r.HTTPProtocols.HTTP3 {
			facts = append(facts, "HTTP/3")
		} else if r.HTTPProtocols.HTTP2 {
			facts = append(facts, "HTTP/2")
		}
	}
	if r.Hosting != nil && r.Hosting.Provider != "" {
		facts = append(facts, r.Hosting.Provider)
	}
	if r.Hosting != nil && r.Hosting.CDN != "" {
		facts = append(facts, r.Hosting.CDN)
	}
	if r.Performance != nil && r.Performance.LCP > 0 {
		lcpSec := r.Performance.LCP / 1000
		if lcpSec >= 1 {
			facts = append(facts, fmt.Sprintf("LCP %.1fs", lcpSec))
		} else {
			facts = append(facts, fmt.Sprintf("LCP %dms", int(r.Performance.LCP)))
		}
	}
	if len(facts) > 0 {
		lines = append(lines, dim.Render(strings.Join(facts, " · ")))
		lines = append(lines, "")
	}

	// Key findings
	var goods, issues, infos []Finding
	for _, name := range sortedAxes(r.Score.Axes) {
		for _, f := range r.Score.Axes[name].Findings {
			switch f.Severity {
			case "good":
				goods = append(goods, f)
			case "critical", "high", "medium":
				issues = append(issues, f)
			case "low", "info":
				infos = append(infos, f)
			}
		}
	}

	if len(issues) > 0 || len(infos) > 0 || len(goods) > 0 {
		lines = append(lines, title.Render("Findings"))
		for _, f := range issues {
			lines = append(lines, fmt.Sprintf("%s %s", severityIcon(f.Severity), f.Label))
		}
		for _, f := range infos {
			lines = append(lines, fmt.Sprintf("%s %s", severityIcon(f.Severity), f.Label))
		}
		maxGood := 5
		for i, f := range goods {
			if i >= maxGood {
				remaining := len(goods) - maxGood
				lines = append(lines, dim.Render(fmt.Sprintf("  +%d more passing", remaining)))
				break
			}
			lines = append(lines, fmt.Sprintf("%s %s", severityIcon(f.Severity), f.Label))
		}
	}

	// Render as card
	content := strings.Join(lines, "\n")
	fmt.Println()
	fmt.Println(cardBox.Render(content))
	fmt.Println()

	// Footer outside the card
	fmt.Printf("  %s\n\n", dim.Render(apiBase+"/"+r.Domain))

	// AI hint (one-time, dismissable)
	cfg := loadConfig()
	if cfg.OpenRouterKey == "" && !cfg.SuppressAIHint {
		fmt.Printf("  %s\n", dim.Render("💡 AI analysis available — run: yoke ai "+r.Domain))
		fmt.Printf("  %s\n\n", dim.Render("   Requires an OpenRouter key. See: yoke ai --setup"))
	}
}

func sortedAxes(axes map[string]AxisVal) []string {
	order := []string{"security", "speed", "foundations", "reputation", "discoverability", "email"}
	var result []string
	for _, name := range order {
		if _, ok := axes[name]; ok {
			result = append(result, name)
		}
	}
	for name := range axes {
		found := false
		for _, r := range result {
			if r == name {
				found = true
				break
			}
		}
		if !found {
			result = append(result, name)
		}
	}
	return result
}

// ─── Text Helpers ───────────────────────────────────────────────────

// normalizeDomain extracts a clean domain from user input, stripping
// schemes (http/https), paths, port numbers, and whitespace.
func normalizeDomain(raw string) string {
	d := strings.ToLower(strings.TrimSpace(raw))
	// Strip common URL schemes
	d = strings.TrimPrefix(d, "https://")
	d = strings.TrimPrefix(d, "http://")
	// Strip paths and fragments
	if i := strings.IndexAny(d, "/?#"); i != -1 {
		d = d[:i]
	}
	// Strip port numbers (e.g., example.com:8080)
	if host, _, found := strings.Cut(d, ":"); found {
		d = host
	}
	// Strip trailing dots and slashes
	d = strings.TrimRight(d, "./")
	// Strip www. prefix — www.github.com and github.com are the same site
	d = strings.TrimPrefix(d, "www.")
	return d
}

func wrapText(text string, width int) []string {
	var lines []string
	for _, para := range strings.Split(text, "\n") {
		words := strings.Fields(para)
		if len(words) == 0 {
			lines = append(lines, "")
			continue
		}
		line := words[0]
		for _, w := range words[1:] {
			if len(line)+1+len(w) > width {
				lines = append(lines, line)
				line = w
			} else {
				line += " " + w
			}
		}
		lines = append(lines, line)
	}
	return lines
}

// ─── Commands ───────────────────────────────────────────────────────

var jsonOutput bool
var freshScan bool

func main() {
	// Initialize API base URL from config/env (supports self-hosting)
	cfg := loadConfig()
	apiBase = resolveBaseURL(cfg)

	root := &cobra.Command{
		Use:   "yoke <domain>",
		Short: "Domain intelligence from your terminal",
		Long: accent.Render("Yoke") + " — domain intelligence from your terminal\n\n" +
			"Analyze any domain instantly: DNS, SSL, WHOIS, security headers,\n" +
			"tech stack, performance, breaches, and more.\n\n" +
			dim.Render("https://yoke.lol"),
		Version: version,
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				cmd.Help()
				os.Exit(0)
			}
			return cobra.ExactArgs(1)(cmd, args)
		},
		RunE:    runAnalyze,
		SilenceUsage: true,
		Example: `  yoke stripe.com                        # full analysis
  yoke stripe.com --fresh                  # bypass cache, force fresh scan
  yoke stripe.com --json                 # raw JSON output
  yoke stripe.com --json | jq .ssl       # extract specific fields
  yoke score google.com                  # quick score check
  yoke compare github.com gitlab.com     # side-by-side comparison
  yoke ai stripe.com                     # AI-powered analysis`,
	}
	// Show help instead of bare error when no args provided
	root.SetFlagErrorFunc(func(cmd *cobra.Command, err error) error {
		cmd.Help()
		return err
	})
	root.PersistentFlags().BoolVar(&jsonOutput, "json", false, "raw JSON output")
	root.PersistentFlags().BoolVar(&freshScan, "fresh", false, "bypass cache and force a fresh scan")

	score := &cobra.Command{
		Use:   "score <domain>",
		Short: "Quick score and rating",
		Args:  cobra.ExactArgs(1),
		RunE:  runScore,
	}

	compare := &cobra.Command{
		Use:   "compare <domain1> <domain2>",
		Short: "Side-by-side domain comparison",
		Args:  cobra.ExactArgs(2),
		RunE:  runCompare,
	}

	ai := &cobra.Command{
		Use:   "ai <domain>",
		Short: "AI-powered domain analysis (requires OpenRouter key)",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runAI,
	}
	ai.Flags().Bool("setup", false, "configure your OpenRouter API key")
	ai.Flags().String("model", "", "model override (e.g. openai/gpt-4o, google/gemini-2.5-pro)")

	configCmd := &cobra.Command{
		Use:   "config",
		Short: "Show or edit configuration",
		RunE:  runConfig,
	}
	configCmd.Flags().String("set-key", "", "set OpenRouter API key")
	configCmd.Flags().String("set-model", "", "set default AI model (e.g. openai/gpt-4o, google/gemini-2.5-pro)")
	configCmd.Flags().String("set-base-url", "", "set Yoke instance URL for self-hosting (default: https://yoke.lol)")
	configCmd.Flags().String("set-prompt", "", "set custom AI prompt file path (see: github.com/yokedotlol/yoke/blob/main/prompts/ai-analysis.txt)")
	configCmd.Flags().String("set-prompt-inline", "", "set custom AI prompt as inline text in config")
	configCmd.Flags().Bool("clear-prompt", false, "remove custom prompt, revert to server default")
	configCmd.Flags().Bool("suppress-ai-hint", false, "hide the AI hint from analyze output")
	configCmd.Flags().Bool("show-ai-hint", false, "re-enable the AI hint")

	root.AddCommand(score, compare, ai, configCmd)
	root.CompletionOptions.DisableDefaultCmd = true
	versionTmpl := "yoke {{.Version}}"
	if commit != "none" {
		versionTmpl += " (" + commit + ")"
	}
	if date != "unknown" {
		versionTmpl += " built " + date
	}
	versionTmpl += "\n"
	root.SetVersionTemplate(versionTmpl)

	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

func runAnalyze(cmd *cobra.Command, args []string) error {
	domain := normalizeDomain(args[0])

	if jsonOutput {
		return printRawJSON(domain, freshScan)
	}

	result, err := fetchAnalysisStream(domain, freshScan)
	if err != nil {
		return err
	}
	printAnalysis(result)
	return nil
}

func runScore(cmd *cobra.Command, args []string) error {
	domain := normalizeDomain(args[0])

	if jsonOutput {
		// Fetch full analysis but output only minimal score JSON
		result, err := fetchAnalysisStream(domain, freshScan)
		if err != nil {
			return err
		}
		if result.Score == nil {
			return fmt.Errorf("no score data for %s", domain)
		}
		minimal := struct {
			Domain    string `json:"domain"`
			Score     int    `json:"score"`
			Tier      string `json:"tier"`
		}{
			Domain:    result.Domain,
			Score:     result.Score.Composite,
			Tier:      result.Score.Tier,
		}
		out, _ := json.MarshalIndent(minimal, "", "  ")
		fmt.Println(string(out))
		return nil
	}

	result, err := fetchAnalysisStream(domain, freshScan)
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

func runCompare(cmd *cobra.Command, args []string) error {
	d1 := normalizeDomain(args[0])
	d2 := normalizeDomain(args[1])

	if jsonOutput {
		// JSON mode: plain request, no progress
		return runCompareJSON(d1, d2)
	}

	// Run both analyses in parallel via SSE for progress bars
	type streamResult struct {
		result *AnalysisResult
		err    error
	}
	ch1 := make(chan streamResult, 1)
	ch2 := make(chan streamResult, 1)

	// We render two progress rows: line 1 for d1, line 2 for d2
	// Protected by a mutex since both goroutines update the display
	var mu sync.Mutex
	var d1done, d2done bool
	var d1completed, d1total int
	var d2completed, d2total int
	printedLines := 0

	renderDomainLine := func(domain string, completed, total int, done bool) {
		barWidth := 20
		label := fmt.Sprintf("%-22s", domain)
		if done {
			bar := good.Render(strings.Repeat("█", barWidth))
			// Use "✓ " (with trailing space) to match the rendered width of "⚡"
			fmt.Printf("  %s %s %s %s\n", good.Render("✓ "), dim.Render(label),
				bar, good.Render("done"))
		} else if total == 0 {
			bar := dim.Render(strings.Repeat("░", barWidth))
			fmt.Printf("  %s %s %s\n", accent.Render("⚡"), dim.Render(label), bar)
		} else {
			filled := completed * barWidth / total
			if filled > barWidth { filled = barWidth }
			bar := good.Render(strings.Repeat("█", filled)) + dim.Render(strings.Repeat("░", barWidth-filled))
			fmt.Printf("  %s %s %s %s\n", accent.Render("⚡"), dim.Render(label),
				bar, dim.Render(fmt.Sprintf("%d/%d", completed, total)))
		}
	}

	renderCompareProgress := func() {
		clearProgress(printedLines)
		renderDomainLine(d1, d1completed, d1total, d1done)
		renderDomainLine(d2, d2completed, d2total, d2done)
		printedLines = 2
	}

	// Initial render
	renderCompareProgress()

	// Stream domain 1
	go func() {
		result, err := fetchAnalysisStreamWithProgress(d1, func(checks []sseCheck, completed, total int) {
			mu.Lock()
			d1completed = completed
			d1total = total
			renderCompareProgress()
			mu.Unlock()
		}, freshScan)
		mu.Lock()
		d1done = true
		renderCompareProgress()
		mu.Unlock()
		ch1 <- streamResult{result, err}
	}()

	// Stream domain 2
	go func() {
		result, err := fetchAnalysisStreamWithProgress(d2, func(checks []sseCheck, completed, total int) {
			mu.Lock()
			d2completed = completed
			d2total = total
			renderCompareProgress()
			mu.Unlock()
		}, freshScan)
		mu.Lock()
		d2done = true
		renderCompareProgress()
		mu.Unlock()
		ch2 <- streamResult{result, err}
	}()

	r1 := <-ch1
	r2 := <-ch2

	mu.Lock()
	clearProgress(printedLines)
	mu.Unlock()

	if r1.err != nil {
		return fmt.Errorf("analysis of %s failed: %w", d1, r1.err)
	}
	if r2.err != nil {
		return fmt.Errorf("analysis of %s failed: %w", d2, r2.err)
	}

	// Now POST to /api/compare — both domains were just analyzed via SSE above,
	// so their results are fresh in the server's D1 cache. The compare endpoint
	// calls analyzeDomain() internally, which checks cache first (ANALYSIS_CACHE_TTL_MS),
	// so this should return near-instantly without re-running any checks.
	spin := startSpinner("Comparing...")
	client := &http.Client{Timeout: 30 * time.Second}
	payloadBytes, _ := json.Marshal(map[string]string{"domain1": d1, "domain2": d2})
	req, err := http.NewRequest("POST", apiBase+"/api/compare", strings.NewReader(string(payloadBytes)))
	if err != nil {
		spin.stop()
		return fmt.Errorf("request setup failed: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "yoke-cli/"+version)

	resp, err := client.Do(req)
	if err != nil {
		spin.stop()
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	spin.stop()
	if err != nil {
		return fmt.Errorf("read failed: %w", err)
	}

	if resp.StatusCode != 200 {
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var data struct {
		Domain1 struct {
			Domain string      `json:"domain"`
			Score  *ScoreBlock `json:"domain_score"`
		} `json:"domain1"`
		Domain2 struct {
			Domain string      `json:"domain"`
			Score  *ScoreBlock `json:"domain_score"`
		} `json:"domain2"`
		Comparison struct {
			Axes []struct {
				Axis   string `json:"axis"`
				Score1 int    `json:"score1"`
				Score2 int    `json:"score2"`
				Delta  int    `json:"delta"`
			} `json:"axes"`
		} `json:"comparison"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}

	fmt.Println()
	if data.Domain1.Score != nil {
		g1 := tierStyle(data.Domain1.Score.Tier).Bold(true).Render(data.Domain1.Score.Tier)
		fmt.Printf("  %s  %d/100 %s\n", title.Render(fmt.Sprintf("%-30s", data.Domain1.Domain)),
			data.Domain1.Score.Composite, g1)
	} else {
		fmt.Printf("  %s  %s\n", title.Render(fmt.Sprintf("%-30s", data.Domain1.Domain)),
			bad.Render("Error — analysis failed"))
	}
	if data.Domain2.Score != nil {
		g2 := tierStyle(data.Domain2.Score.Tier).Bold(true).Render(data.Domain2.Score.Tier)
		fmt.Printf("  %s  %d/100 %s\n", title.Render(fmt.Sprintf("%-30s", data.Domain2.Domain)),
			data.Domain2.Score.Composite, g2)
	} else {
		fmt.Printf("  %s  %s\n", title.Render(fmt.Sprintf("%-30s", data.Domain2.Domain)),
			bad.Render("Error — analysis failed"))
	}
	fmt.Println()

	for _, ax := range data.Comparison.Axes {
		deltaStr := fmt.Sprintf("%+d", ax.Delta)
		style := dim
		if ax.Delta > 0 {
			style = good
		} else if ax.Delta < 0 {
			style = bad
		}
		fmt.Printf("  %s  %3d vs %-3d  %s\n",
			axisName.Render(strings.ToUpper(ax.Axis)),
			ax.Score1, ax.Score2, style.Render(deltaStr))
	}

	fmt.Println()
	fmt.Printf("  %s\n\n", dim.Render(fmt.Sprintf("%s/compare/%s/%s", apiBase, d1, d2)))
	return nil
}

func runAI(cmd *cobra.Command, args []string) error {
	setup, _ := cmd.Flags().GetBool("setup")
	if setup {
		return runAISetup()
	}

	if len(args) == 0 {
		return fmt.Errorf("domain required: yoke ai <domain>")
	}

	domain := normalizeDomain(args[0])
	cfg := loadConfig()

	if cfg.OpenRouterKey == "" {
		fmt.Println()
		fmt.Println(warn.Render("  AI analysis requires an OpenRouter API key."))
		fmt.Println()
		fmt.Println("  1. Get a key at " + accent.Render("https://openrouter.ai/keys"))
		fmt.Println("  2. Run: " + title.Render("yoke ai --setup"))
		fmt.Println()
		fmt.Println(dim.Render("  Free tier includes 10 analyses/hour on yoke.lol without a key."))
		fmt.Println()
		return nil
	}

	model, _ := cmd.Flags().GetString("model")
	if model == "" {
		model = cfg.DefaultModel
	}

	// Resolve custom prompt from config (prompt_file > prompt > server default)
	customPrompt, err := resolveCustomPrompt(cfg)
	if err != nil {
		return err
	}

	// Phase 1: Ensure domain is analyzed (progress bar for fresh, instant for cached)
	// This populates the server cache so the AI endpoint can read signals without re-analyzing.
	if !jsonOutput {
		printedLines := 0
		_, _ = fetchAnalysisStreamWithProgress(domain, func(checks []sseCheck, completed, total int) {
			clearProgress(printedLines)
			barWidth := 20
			label := fmt.Sprintf("%-22s", domain)
			if total == 0 {
				bar := dim.Render(strings.Repeat("░", barWidth))
				fmt.Printf("  %s %s %s\n", accent.Render("⚡"), dim.Render(label), bar)
			} else {
				filled := completed * barWidth / total
				if filled > barWidth { filled = barWidth }
				bar := good.Render(strings.Repeat("█", filled)) + dim.Render(strings.Repeat("░", barWidth-filled))
				fmt.Printf("  %s %s %s %s\n", accent.Render("⚡"), dim.Render(label),
					bar, dim.Render(fmt.Sprintf("%d/%d", completed, total)))
			}
			printedLines = 1
		}, freshScan)
		clearProgress(printedLines)
	}

	// Phase 2: AI analysis (LLM call)
	client := &http.Client{Timeout: 120 * time.Second}
	payload := map[string]string{"domain": domain}
	if model != "" {
		payload["model"] = model
	}
	if customPrompt != "" {
		payload["custom_prompt"] = customPrompt
	}
	payloadBytes, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", apiBase+"/api/ai-analysis", strings.NewReader(string(payloadBytes)))
	if err != nil {
		return fmt.Errorf("request setup failed: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "yoke-cli/"+version)
	req.Header.Set("X-OpenRouter-Key", cfg.OpenRouterKey)

	if jsonOutput {
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		if err != nil {
			return fmt.Errorf("read failed: %w", err)
		}
		os.Stdout.Write(body)
		if len(body) > 0 && body[len(body)-1] != '\n' {
			fmt.Println()
		}
		if resp.StatusCode != 200 {
			return fmt.Errorf("API error %d", resp.StatusCode)
		}
		return nil
	}

	spin := startSpinner("Running AI analysis on " + domain + "...")

	resp, err := client.Do(req)
	if err != nil {
		spin.stop()
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	spin.stop()
	if err != nil {
		return fmt.Errorf("read failed: %w", err)
	}

	if resp.StatusCode == 429 {
		var rl struct {
			Limit int    `json:"limit"`
			Used  int    `json:"used"`
			Reset string `json:"reset"`
		}
		json.Unmarshal(body, &rl)
		fmt.Println()
		fmt.Println(warn.Render(fmt.Sprintf("  Rate limited: %d/%d used. Resets in %s.", rl.Used, rl.Limit, rl.Reset)))
		fmt.Println(dim.Render("  Add your own key with: yoke ai --setup"))
		fmt.Println()
		return nil
	}

	if resp.StatusCode != 200 {
		return fmt.Errorf("AI API error %d: %s", resp.StatusCode, string(body))
	}

	// Parse the AI response
	var aiResp struct {
		Result struct {
			Summary        string            `json:"summary"`
			Posture        string            `json:"posture"`
			KeyFindings    []json.RawMessage `json:"key_findings"`
			Recommendations []json.RawMessage `json:"recommendations"`
			PersonaInsights map[string]string `json:"persona_insights"`
		} `json:"result"`
		AnalyzedAt string `json:"analyzed_at"`
		Cached     bool   `json:"cached"`
	}
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return fmt.Errorf("parse failed: %w", err)
	}

	r := aiResp.Result

	// Posture badge
	postureStyle := good
	switch r.Posture {
	case "poor":
		postureStyle = warn
	case "critical":
		postureStyle = bad
	case "fair":
		postureStyle = info
	}

	fmt.Println()
	fmt.Printf("  %s  %s\n", title.Render(domain), postureStyle.Bold(true).Render(strings.ToUpper(r.Posture)))
	fmt.Println()

	// Summary
	if r.Summary != "" {
		for _, line := range wrapText(r.Summary, 72) {
			fmt.Printf("  %s\n", line)
		}
		fmt.Println()
	}

	// Key findings
	if len(r.KeyFindings) > 0 {
		fmt.Println("  " + title.Render("Key Findings"))
		for _, raw := range r.KeyFindings {
			var f struct {
				Category string `json:"category"`
				Finding  string `json:"finding"`
				Severity string `json:"severity"`
				Action   string `json:"action"`
			}
			json.Unmarshal(raw, &f)
			icon := severityIcon(f.Severity)
			fmt.Printf("  %s %s\n", icon, f.Finding)
			if f.Action != "" {
				fmt.Printf("    %s\n", dim.Render("→ "+f.Action))
			}
		}
		fmt.Println()
	}

	// Recommendations
	if len(r.Recommendations) > 0 {
		fmt.Println("  " + title.Render("Recommendations"))
		for _, raw := range r.Recommendations {
			var rec struct {
				Priority int    `json:"priority"`
				Action   string `json:"action"`
				Impact   string `json:"impact"`
				Effort   string `json:"effort"`
			}
			json.Unmarshal(raw, &rec)
			effortBadge := dim.Render("[" + rec.Effort + "]")
			fmt.Printf("  %s. %s %s\n", accent.Render(fmt.Sprintf("%d", rec.Priority)), rec.Action, effortBadge)
			if rec.Impact != "" {
				fmt.Printf("     %s\n", dim.Render(rec.Impact))
			}
		}
		fmt.Println()
	}

	if aiResp.Cached {
		fmt.Printf("  %s\n", dim.Render("(cached result)"))
	}
	if model != "" {
		fmt.Printf("  %s\n", dim.Render("Model: "+model))
	}
	fmt.Printf("  %s\n\n", dim.Render(apiBase+"/"+domain))

	// Suppress the hint now that they've used AI
	if !cfg.SuppressAIHint {
		cfg.SuppressAIHint = true
		saveConfig(cfg)
	}

	return nil
}

func runAISetup() error {
	cfg := loadConfig()

	fmt.Println()
	fmt.Println(title.Render("  AI Analysis Setup"))
	fmt.Println()
	fmt.Println("  Yoke uses OpenRouter to power AI domain analysis.")
	fmt.Println("  Your key is stored locally in " + dim.Render(configPath()))
	fmt.Println()
	fmt.Println("  1. Get a key at " + accent.Render("https://openrouter.ai/keys"))
	fmt.Print("  2. Paste your key: ")

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
	key := strings.TrimSpace(scanner.Text())

	if key == "" {
		fmt.Println(warn.Render("  No key provided. Setup cancelled."))
		return nil
	}

	cfg.OpenRouterKey = key
	cfg.SuppressAIHint = true
	saveConfig(cfg)

	fmt.Println()
	fmt.Println(good.Render("  ✓ Key saved. Try: yoke ai stripe.com"))
	fmt.Println()
	return nil
}

func runConfig(cmd *cobra.Command, args []string) error {
	cfg := loadConfig()

	setKey, _ := cmd.Flags().GetString("set-key")
	setModel, _ := cmd.Flags().GetString("set-model")
	setBaseURL, _ := cmd.Flags().GetString("set-base-url")
	setPrompt, _ := cmd.Flags().GetString("set-prompt")
	setPromptInline, _ := cmd.Flags().GetString("set-prompt-inline")
	clearPrompt, _ := cmd.Flags().GetBool("clear-prompt")
	suppressHint, _ := cmd.Flags().GetBool("suppress-ai-hint")
	showHint, _ := cmd.Flags().GetBool("show-ai-hint")

	changed := false

	if setKey != "" {
		cfg.OpenRouterKey = setKey
		cfg.SuppressAIHint = true
		changed = true
		fmt.Println(good.Render("✓ OpenRouter key saved"))
	}
	if setModel != "" {
		cfg.DefaultModel = setModel
		changed = true
		fmt.Println(good.Render("✓ Default model set to " + setModel))
	}
	if setBaseURL != "" {
		cfg.BaseURL = strings.TrimRight(strings.TrimSpace(setBaseURL), "/")
		changed = true
		fmt.Println(good.Render("✓ Base URL set to " + cfg.BaseURL))
		fmt.Println(dim.Render("  Restart CLI or set YOKE_BASE_URL env var to apply immediately"))
	}
	if setPrompt != "" {
		// Verify the file exists
		absPath := setPrompt
		if strings.HasPrefix(absPath, "~/") {
			home, _ := os.UserHomeDir()
			absPath = filepath.Join(home, absPath[2:])
		}
		if _, err := os.Stat(absPath); err != nil {
			return fmt.Errorf("prompt file not found: %s", absPath)
		}
		cfg.PromptFile = setPrompt
		cfg.Prompt = "" // file takes precedence, clear inline
		changed = true
		fmt.Println(good.Render("✓ Prompt file set to " + setPrompt))
	}
	if setPromptInline != "" {
		cfg.Prompt = setPromptInline
		cfg.PromptFile = "" // inline takes precedence when explicitly set, clear file
		changed = true
		fmt.Println(good.Render("✓ Custom inline prompt saved"))
	}
	if clearPrompt {
		cfg.PromptFile = ""
		cfg.Prompt = ""
		changed = true
		fmt.Println(good.Render("✓ Custom prompt cleared, using server default"))
	}
	if suppressHint {
		cfg.SuppressAIHint = true
		changed = true
		fmt.Println(good.Render("✓ AI hint suppressed"))
	}
	if showHint {
		cfg.SuppressAIHint = false
		changed = true
		fmt.Println(good.Render("✓ AI hint re-enabled"))
	}

	if changed {
		saveConfig(cfg)
		return nil
	}

	// Show current config
	fmt.Println()
	fmt.Println(title.Render("  Configuration") + "  " + dim.Render(configPath()))
	fmt.Println()
	if cfg.OpenRouterKey != "" {
		masked := cfg.OpenRouterKey
		if len(masked) > 12 {
			masked = masked[:8] + "..." + masked[len(masked)-4:]
		}
		fmt.Printf("  OpenRouter key:  %s\n", masked)
	} else {
		fmt.Printf("  OpenRouter key:  %s\n", dim.Render("not set"))
	}
	if cfg.DefaultModel != "" {
		fmt.Printf("  Default model:   %s\n", cfg.DefaultModel)
	} else {
		fmt.Printf("  Default model:   %s\n", dim.Render("not set"))
	}
	if cfg.BaseURL != "" {
		fmt.Printf("  Base URL:        %s\n", cfg.BaseURL)
	} else {
		fmt.Printf("  Base URL:        %s\n", dim.Render("https://yoke.lol (default)"))
	}
	if envURL := os.Getenv("YOKE_BASE_URL"); envURL != "" {
		fmt.Printf("  (env override:  %s)\n", envURL)
	}
	fmt.Printf("  AI hint:         %s\n", map[bool]string{true: "suppressed", false: "shown"}[cfg.SuppressAIHint])
	if cfg.PromptFile != "" {
		fmt.Printf("  Prompt:          %s %s\n", cfg.PromptFile, dim.Render("(file)"))
	} else if cfg.Prompt != "" {
		preview := cfg.Prompt
		if len(preview) > 60 {
			preview = preview[:57] + "..."
		}
		fmt.Printf("  Prompt:          %s %s\n", preview, dim.Render("(inline)"))
	} else {
		fmt.Printf("  Prompt:          %s\n", dim.Render("built-in (default)"))
	}
	fmt.Println()
	fmt.Println(dim.Render("  # Default prompt: https://github.com/yokedotlol/yoke/blob/main/prompts/ai-analysis.txt"))
	fmt.Println(dim.Render("  # Customize via file or inline:"))
	fmt.Println(dim.Render("  #   yoke config --set-prompt ~/my-prompt.txt"))
	fmt.Println(dim.Render("  #   yoke config --set-prompt-inline \"You are a security auditor...\""))
	fmt.Println(dim.Render("  #   yoke config --clear-prompt"))
	fmt.Println()
	return nil
}

func printRawJSON(domain string, force bool) error {
	client := &http.Client{Timeout: 90 * time.Second}

	var req *http.Request
	var err error
	if force {
		// Use POST /api/analyze with force:true to bypass cache
		payload := fmt.Sprintf(`{"domain":%q,"force":true}`, domain)
		req, err = http.NewRequest("POST", apiBase+"/api/analyze", strings.NewReader(payload))
		if err != nil {
			return fmt.Errorf("request setup failed: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
	} else {
		req, err = http.NewRequest("GET", apiBase+"/"+domain, nil)
		if err != nil {
			return fmt.Errorf("request setup failed: %w", err)
		}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "yoke-cli/"+version)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return err
	}
	os.Stdout.Write(body)
	// Ensure output ends with newline
	if len(body) > 0 && body[len(body)-1] != '\n' {
		fmt.Println()
	}
	if resp.StatusCode != 200 {
		return fmt.Errorf("API error %d", resp.StatusCode)
	}
	return nil
}
