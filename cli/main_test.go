package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// ─── Config ─────────────────────────────────────────────────────────

func TestConfigRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	want := Config{
		OpenRouterKey:  "sk-or-test-1234567890",
		SuppressAIHint: true,
		DefaultModel:   "openai/gpt-4o",
	}
	saveConfig(want)

	got := loadConfig()
	if got.OpenRouterKey != want.OpenRouterKey {
		t.Errorf("OpenRouterKey = %q, want %q", got.OpenRouterKey, want.OpenRouterKey)
	}
	if got.SuppressAIHint != want.SuppressAIHint {
		t.Errorf("SuppressAIHint = %v, want %v", got.SuppressAIHint, want.SuppressAIHint)
	}
	if got.DefaultModel != want.DefaultModel {
		t.Errorf("DefaultModel = %q, want %q", got.DefaultModel, want.DefaultModel)
	}
}

func TestConfigPath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	want := filepath.Join(dir, ".yoke.toml")
	if got := configPath(); got != want {
		t.Errorf("configPath() = %q, want %q", got, want)
	}
}

func TestSaveConfigPermissions(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	saveConfig(Config{OpenRouterKey: "secret"})

	info, err := os.Stat(configPath())
	if err != nil {
		t.Fatalf("stat failed: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("config perms = %o, want 0600", perm)
	}
}

func TestLoadConfigMissingFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	got := loadConfig()
	if got.OpenRouterKey != "" || got.SuppressAIHint || got.DefaultModel != "" {
		t.Errorf("expected zero-value config for missing file, got %+v", got)
	}
}

func TestLoadConfigCorruptFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	os.WriteFile(filepath.Join(dir, ".yoke.toml"), []byte("not valid toml [[["), 0600)
	// Should not panic; returns best-effort zero config.
	got := loadConfig()
	if got.OpenRouterKey != "" {
		t.Errorf("expected empty key on corrupt config, got %q", got.OpenRouterKey)
	}
}

func TestDefaultModelOmitEmpty(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	saveConfig(Config{OpenRouterKey: "k"})
	data, _ := os.ReadFile(configPath())
	if strings.Contains(string(data), "default_model") {
		t.Errorf("empty default_model should be omitted, got %s", data)
	}
}

// ─── wrapText ───────────────────────────────────────────────────────

func TestWrapText(t *testing.T) {
	tests := []struct {
		name  string
		text  string
		width int
		check func(t *testing.T, lines []string)
	}{
		{
			name:  "basic wrap respects width",
			text:  "the quick brown fox jumps over the lazy dog",
			width: 15,
			check: func(t *testing.T, lines []string) {
				for _, l := range lines {
					if len(l) > 15 && !strings.Contains(l, " ") {
						return // single long word allowed to overflow
					}
					if len(l) > 15 {
						t.Errorf("line exceeds width: %q (%d)", l, len(l))
					}
				}
			},
		},
		{
			name:  "word boundaries preserved",
			text:  "hello world",
			width: 100,
			check: func(t *testing.T, lines []string) {
				if len(lines) != 1 || lines[0] != "hello world" {
					t.Errorf("expected single line 'hello world', got %#v", lines)
				}
			},
		},
		{
			name:  "empty string",
			text:  "",
			width: 10,
			check: func(t *testing.T, lines []string) {
				if len(lines) != 1 || lines[0] != "" {
					t.Errorf("expected one empty line, got %#v", lines)
				}
			},
		},
		{
			name:  "newlines split paragraphs",
			text:  "first line\nsecond line",
			width: 100,
			check: func(t *testing.T, lines []string) {
				if len(lines) != 2 {
					t.Errorf("expected 2 lines, got %d: %#v", len(lines), lines)
				}
			},
		},
		{
			name:  "single word longer than width",
			text:  "supercalifragilisticexpialidocious",
			width: 10,
			check: func(t *testing.T, lines []string) {
				if len(lines) != 1 {
					t.Errorf("expected 1 line for unbreakable word, got %#v", lines)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.check(t, wrapText(tt.text, tt.width))
		})
	}
}

// ─── sortedAxes ─────────────────────────────────────────────────────

func TestSortedAxesCanonicalOrder(t *testing.T) {
	axes := map[string]AxisVal{
		"reputation":      {},
		"security":        {},
		"discoverability": {},
		"speed":           {},
		"foundations":     {},
		"email":           {},
	}
	got := sortedAxes(axes)
	want := []string{"security", "speed", "foundations", "reputation", "discoverability", "email"}
	if len(got) != len(want) {
		t.Fatalf("got %d axes, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("axis[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestSortedAxesUnknownAppended(t *testing.T) {
	axes := map[string]AxisVal{
		"security": {},
		"mystery":  {},
	}
	got := sortedAxes(axes)
	if got[0] != "security" {
		t.Errorf("expected security first, got %q", got[0])
	}
	found := false
	for _, a := range got {
		if a == "mystery" {
			found = true
		}
	}
	if !found {
		t.Errorf("unknown axis 'mystery' not present in %#v", got)
	}
}

func TestSortedAxesEmpty(t *testing.T) {
	if got := sortedAxes(map[string]AxisVal{}); len(got) != 0 {
		t.Errorf("expected empty slice, got %#v", got)
	}
}

func TestSortedAxesPartial(t *testing.T) {
	axes := map[string]AxisVal{"speed": {}, "email": {}}
	got := sortedAxes(axes)
	want := []string{"speed", "email"}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("got %#v, want %#v", got, want)
	}
}

// ─── tierStyle ──────────────────────────────────────────────────────

func TestTierStyle(t *testing.T) {
	// tierStyle never panics and returns a usable style for every tier.
	for _, tier := range []string{"Excellent", "Strong", "Moderate", "Weak", "Critical", "", "Unknown"} {
		style := tierStyle(tier)
		if got := style.Render("x"); got == "" {
			t.Errorf("tierStyle(%q) rendered empty string", tier)
		}
	}
}

// ─── severityIcon ───────────────────────────────────────────────────

func TestSeverityIcon(t *testing.T) {
	for _, s := range []string{"good", "critical", "high", "medium", "low", "unknown", ""} {
		if icon := severityIcon(s); icon == "" {
			t.Errorf("severityIcon(%q) returned empty", s)
		}
	}
}

// ─── renderBar ──────────────────────────────────────────────────────

func stripANSI(s string) string {
	var b strings.Builder
	inEsc := false
	for _, r := range s {
		if r == '\x1b' {
			inEsc = true
			continue
		}
		if inEsc {
			if r == 'm' {
				inEsc = false
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func TestRenderBarFill(t *testing.T) {
	tests := []struct {
		score       int
		width       int
		wantFilled  int
	}{
		{0, 20, 0},
		{50, 20, 10},
		{100, 20, 20},
		{150, 20, 20}, // clamps to width
	}
	for _, tt := range tests {
		bar := stripANSI(renderBar(tt.score, tt.width))
		filled := strings.Count(bar, "█")
		if filled != tt.wantFilled {
			t.Errorf("renderBar(%d,%d): filled=%d, want %d", tt.score, tt.width, filled, tt.wantFilled)
		}
		total := len([]rune(bar))
		if total != tt.width {
			t.Errorf("renderBar(%d,%d): total runes=%d, want %d", tt.score, tt.width, total, tt.width)
		}
	}
}

// ─── Command structure ──────────────────────────────────────────────

func buildRoot() *cobra.Command {
	root := &cobra.Command{
		Use:     "yoke <domain>",
		Version: version,
		Args:    cobra.ExactArgs(1),
		RunE:    runAnalyze,
	}
	root.PersistentFlags().BoolVar(&jsonOutput, "json", false, "raw JSON output")
	root.PersistentFlags().BoolVar(&rawOutput, "raw", false, "minimal output")

	score := &cobra.Command{Use: "score <domain>", Args: cobra.MaximumNArgs(1), RunE: runScore}
	compare := &cobra.Command{Use: "compare <domain1> <domain2>", Args: cobra.ExactArgs(2), RunE: runCompare}
	ai := &cobra.Command{Use: "ai <domain>", Args: cobra.MaximumNArgs(1), RunE: runAI}
	ai.Flags().Bool("setup", false, "")
	ai.Flags().String("model", "", "")
	configCmd := &cobra.Command{Use: "config", RunE: runConfig}
	configCmd.Flags().String("set-key", "", "")
	configCmd.Flags().Bool("suppress-ai-hint", false, "")
	configCmd.Flags().Bool("show-ai-hint", false, "")

	root.AddCommand(score, compare, ai, configCmd,
		newFastCmd(), newDNSCmd(), newHeadersCmd(), newTLSCmd(), newCheckCmd())
	return root
}

func TestRootHasSubcommands(t *testing.T) {
	root := buildRoot()
	want := map[string]bool{
		"score": false, "compare": false, "ai": false, "config": false,
		"fast": false, "dns": false, "headers": false, "tls": false, "check": false,
	}
	for _, c := range root.Commands() {
		if _, ok := want[c.Name()]; ok {
			want[c.Name()] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("subcommand %q not registered", name)
		}
	}
}

func TestArgValidators(t *testing.T) {
	tests := []struct {
		name    string
		args    cobra.PositionalArgs
		n       int
		wantErr bool
	}{
		{"root 0 args", cobra.ExactArgs(1), 0, true},
		{"root 1 arg", cobra.ExactArgs(1), 1, false},
		{"compare 1 arg", cobra.ExactArgs(2), 1, true},
		{"compare 2 args", cobra.ExactArgs(2), 2, false},
		{"ai 0 args", cobra.MaximumNArgs(1), 0, false},
		{"ai 1 arg", cobra.MaximumNArgs(1), 1, false},
		{"ai 2 args", cobra.MaximumNArgs(1), 2, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := make([]string, tt.n)
			err := tt.args(&cobra.Command{}, args)
			if (err != nil) != tt.wantErr {
				t.Errorf("err = %v, wantErr = %v", err, tt.wantErr)
			}
		})
	}
}

func TestJSONFlagExists(t *testing.T) {
	root := buildRoot()
	if root.PersistentFlags().Lookup("json") == nil {
		t.Error("--json persistent flag not found")
	}
}

func TestRawFlagExists(t *testing.T) {
	root := buildRoot()
	if root.PersistentFlags().Lookup("raw") == nil {
		t.Error("--raw persistent flag not found")
	}
}

func TestAIFlagsExist(t *testing.T) {
	root := buildRoot()
	var ai *cobra.Command
	for _, c := range root.Commands() {
		if c.Name() == "ai" {
			ai = c
		}
	}
	if ai == nil {
		t.Fatal("ai command not found")
	}
	if ai.Flags().Lookup("setup") == nil {
		t.Error("ai --setup flag not found")
	}
	if ai.Flags().Lookup("model") == nil {
		t.Error("ai --model flag not found")
	}
}

// ─── Legacy Migration ───────────────────────────────────────────────

func TestLegacyMigration(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)

	// Write a legacy .yokerc JSON file
	legacy := filepath.Join(dir, ".yokerc")
	os.WriteFile(legacy, []byte(`{"openrouter_key":"sk-old","suppress_ai_hint":true}`), 0600)

	// loadConfig should read it and migrate
	cfg := loadConfig()
	if cfg.OpenRouterKey != "sk-old" {
		t.Errorf("legacy migration: key = %q, want %q", cfg.OpenRouterKey, "sk-old")
	}
	if !cfg.SuppressAIHint {
		t.Error("legacy migration: suppress_ai_hint should be true")
	}

	// Legacy file should be removed
	if _, err := os.Stat(legacy); err == nil {
		t.Error("legacy .yokerc should have been removed after migration")
	}

	// New .yoke.toml should exist
	if _, err := os.Stat(filepath.Join(dir, ".yoke.toml")); err != nil {
		t.Error(".yoke.toml should exist after migration")
	}
}

// ─── normalizeDomain ────────────────────────────────────────────────

func TestNormalizeDomain(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"example.com", "example.com"},
		{"  EXAMPLE.COM  ", "example.com"},
		{"https://example.com", "example.com"},
		{"http://example.com", "example.com"},
		{"https://example.com/", "example.com"},
		{"https://example.com/path?q=1", "example.com"},
		{"https://example.com/path#frag", "example.com"},
		{"HTTPS://Example.COM/Path", "example.com"},
		{"example.com.", "example.com"},
		{"example.com/", "example.com"},
		{"example.com:8080", "example.com"},
		{"https://example.com:443/path", "example.com"},
	}
	for _, tt := range tests {
		if got := normalizeDomain(tt.input); got != tt.want {
			t.Errorf("normalizeDomain(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
