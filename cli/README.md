# Yoke CLI

Domain intelligence from your terminal — scores, findings, comparisons, and AI analysis in one command.

Part of [Yoke](https://github.com/yokedotlol/yoke), the open-source domain intelligence tool.

## Install

```bash
# Homebrew (macOS / Linux)
brew install yokedotlol/tap/yoke

# Shell script (macOS / Linux)
curl -sSL https://yoke.lol/install.sh | bash

# Go
go install github.com/yokedotlol/yoke/cli@latest

# Binary download
# See https://github.com/yokedotlol/yoke/releases for prebuilt binaries
# (linux/darwin, amd64/arm64)
```

## Usage

### Full Analysis

```bash
# Rich terminal card with score, axis breakdown, and findings
yoke stripe.com

# Bypass cache, force fresh scan
yoke stripe.com --fresh

# Raw JSON output — pipe to jq for scripting
yoke stripe.com --json
yoke stripe.com --json | jq '.domain_score'

# Minimal output — just the score number
yoke stripe.com --raw
```

### Quick Scan

```bash
# Lightweight analysis — skips heavy probes like PageSpeed
yoke fast stripe.com

# Score-only one-liner
yoke score google.com
```

### Satellite Commands

Query individual satellite APIs directly for focused analysis:

```bash
# DNS records, DNSSEC, propagation via ns.lol
yoke dns stripe.com

# Security headers, redirects, CORS via xhttp.lol
yoke headers stripe.com

# TLS certificate, protocols, chain via certs.lol
yoke tls stripe.com
```

All satellite commands support `--json` (full API response) and `--raw` (minimal output):

```bash
yoke dns stripe.com --json              # full ns.lol JSON
yoke dns stripe.com --raw               # record data values, one per line
yoke headers stripe.com --raw           # grade letter only
yoke tls stripe.com --raw               # grade letter only
```

### Comparison

```bash
# Side-by-side with parallel progress bars
yoke compare github.com gitlab.com
```

### AI Analysis

```bash
# AI-powered analysis (requires OpenRouter key)
yoke ai stripe.com
yoke ai stripe.com --model openai/gpt-4o
```

### CI/CD Gate

Use `yoke check` to enforce minimum domain scores in CI pipelines:

```bash
# Exit 1 if domain score is below B (78)
yoke check stripe.com --min-grade B

# Exit 1 if below A (90)
yoke check stripe.com --min-grade A

# JSON output for CI parsing
yoke check stripe.com --min-grade B --json

# Minimal output: "pass" or "fail"
yoke check stripe.com --min-grade B --raw
```

Grade thresholds: **A** (90+), **B** (78+), **C** (60+), **D** (40+), **F** (0+)

#### GitHub Actions Example

```yaml
- name: Domain health check
  run: |
    brew install yokedotlol/tap/yoke
    yoke check myapp.example.com --min-grade B
```

### Batch Processing

Pipe domain names via stdin to process multiple domains. One domain per line, comments (`#`) and blank lines are skipped.

```bash
# Quick scan all domains
cat domains.txt | yoke fast

# Batch JSON output (one JSON object per line)
cat domains.txt | yoke fast --json

# Batch security header grades
cat domains.txt | yoke headers --raw

# CI gate across multiple domains
cat domains.txt | yoke check --min-grade B

# DNS records for a list
cat domains.txt | yoke dns --json

# Score all domains
cat domains.txt | yoke score --raw
```

Example `domains.txt`:
```
# Production
myapp.com
api.myapp.com

# Staging
staging.myapp.com
```

### Shell Completions

```bash
# Bash
yoke completion bash > /etc/bash_completion.d/yoke

# Zsh (add to fpath)
yoke completion zsh > "${fpath[1]}/_yoke"

# Fish
yoke completion fish > ~/.config/fish/completions/yoke.fish

# PowerShell
yoke completion powershell > yoke.ps1
```

## Output Modes

Every command supports three output modes:

| Flag | Description | Use Case |
|------|-------------|----------|
| *(none)* | Rich terminal output with colors and formatting | Interactive use |
| `--json` | Full JSON response from the API | Scripting, jq, JSONL batch |
| `--raw` | Minimal pipe-friendly value (score number, grade letter, etc.) | Shell scripting, `awk`/`grep` |

When stdout is not a TTY (e.g., piped), `--json` behavior is used automatically for the root `yoke` command.

`--json` and `--raw` are mutually exclusive.

## Configuration

Config is stored in `~/.yoke.toml`. Manage it with `yoke config`:

```bash
# View current config
yoke config

# Set OpenRouter API key for AI analysis
yoke config --set-key sk-or-v1-...

# Set default AI model
yoke config --set-model openai/gpt-4o

# Point CLI at a self-hosted Yoke instance
yoke config --set-base-url https://yoke.example.com

# Custom AI prompt (file or inline)
yoke config --set-prompt ~/my-prompt.txt
yoke config --set-prompt-inline "You are a security auditor..."
yoke config --clear-prompt

# Suppress/restore the AI setup hint
yoke config --suppress-ai-hint
yoke config --show-ai-hint
```

### Environment Variables

| Variable | Description |
|---|---|
| `YOKE_BASE_URL` | Override the Yoke instance URL (takes precedence over config file) |

### Config File Options

| Key | Description |
|---|---|
| `openrouter_key` | OpenRouter API key for AI analysis |
| `default_model` | Default AI model (e.g. `openai/gpt-4o`, `google/gemini-2.5-pro`) |
| `base_url` | Yoke instance URL for self-hosted deployments |
| `prompt_file` | Path to a custom AI prompt file |
| `prompt` | Inline custom AI prompt text |
| `suppress_ai_hint` | Hide the "AI analysis available" hint |

## Commands Reference

| Command | Description | Satellite |
|---------|-------------|-----------|
| `yoke <domain>` | Full domain analysis | yoke.lol |
| `yoke fast <domain>` | Quick lightweight scan | yoke.lol/api/quick |
| `yoke score <domain>` | Score and tier one-liner | yoke.lol |
| `yoke dns <domain>` | DNS records and DNSSEC | ns.lol |
| `yoke headers <domain>` | Security headers and redirects | xhttp.lol |
| `yoke tls <domain>` | TLS certificate and protocols | certs.lol |
| `yoke check <domain>` | CI gate (exit code) | yoke.lol |
| `yoke compare <d1> <d2>` | Side-by-side comparison | yoke.lol |
| `yoke ai <domain>` | AI-powered analysis | yoke.lol + OpenRouter |
| `yoke config` | Show/edit configuration | — |
| `yoke completion <shell>` | Shell completion scripts | — |

## Features

- **Satellite integration** — direct access to ns.lol, xhttp.lol, and certs.lol APIs
- **Live streaming progress** — real-time progress bars as checks complete (via SSE)
- **Rich terminal output** — styled with [Lip Gloss](https://github.com/charmbracelet/lipgloss), auto-detects TTY for clean piped output
- **Batch processing** — pipe domain lists via stdin, process sequentially
- **CI/CD gates** — `yoke check` with exit codes for pipeline integration
- **Three output modes** — human, JSON, and raw for every command
- **Version checking** — warns when a newer CLI version is required via `X-Yoke-Min-Client` header
- **Self-hosting support** — point at any Yoke instance with `YOKE_BASE_URL` or config
- **BYO AI key** — use your own OpenRouter key with configurable model and prompt
- **Shell completions** — Bash, Zsh, Fish, and PowerShell

## Development

```bash
cd cli
go test ./...
go run . stripe.com
go run . fast stripe.com
go run . dns stripe.com
go run . headers stripe.com
go run . tls stripe.com
go run . check stripe.com --min-grade B
```

## License

MIT — see [LICENSE](../LICENSE).
