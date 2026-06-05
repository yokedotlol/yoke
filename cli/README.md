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

```bash
# Analyze a domain — rich terminal card with score, axis breakdown, and findings
yoke stripe.com

# Raw JSON output — pipe to jq for scripting
yoke stripe.com --json
yoke stripe.com --json | jq '.domain_score'

# Quick score check — one-liner output
yoke score google.com

# Minimal JSON score
yoke score google.com --json

# Side-by-side comparison with parallel progress bars
yoke compare github.com gitlab.com

# AI-powered analysis (requires OpenRouter key)
yoke ai stripe.com
yoke ai stripe.com --model openai/gpt-4o
```

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

## Features

- **Live streaming progress** — real-time progress bars as checks complete (via SSE)
- **Rich terminal output** — styled with [Lip Gloss](https://github.com/charmbracelet/lipgloss), auto-detects TTY for clean piped output
- **Version checking** — warns when a newer CLI version is required via `X-Yoke-Min-Client` header
- **Self-hosting support** — point at any Yoke instance with `YOKE_BASE_URL` or config
- **BYO AI key** — use your own OpenRouter key with configurable model and prompt

## Development

```bash
cd cli
go test ./...
go run . stripe.com
```

## License

MIT — see [LICENSE](../LICENSE).
