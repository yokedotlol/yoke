# @yokedotlol/mcp-server

MCP server for [Yoke](https://yoke.lol) — the free, open-source domain intelligence tool. Analyze any domain's security, speed, DNS, SSL, email authentication, and tech stack from any MCP-compatible AI client.

No API keys required. No configuration needed.

## Install

```bash
npx @yokedotlol/mcp-server
```

## Configure Your AI Client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "yoke": {
      "command": "npx",
      "args": ["-y", "@yokedotlol/mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "yoke": {
      "command": "npx",
      "args": ["-y", "@yokedotlol/mcp-server"]
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "yoke": {
      "command": "npx",
      "args": ["-y", "@yokedotlol/mcp-server"]
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "yoke": {
      "command": "npx",
      "args": ["-y", "@yokedotlol/mcp-server"]
    }
  }
}
```

## Available Tools

### `yoke_analyze`

Full domain analysis with 190+ signals across 6 scoring axes. Returns comprehensive structured JSON.

```
Input: { "domain": "stripe.com", "force": false }
```

### `yoke_score_summary`

Concise score overview: overall tier, per-axis scores, top issues by severity, and positive signals. Much smaller response than `yoke_analyze` — use this when you need the headlines, not the raw data.

```
Input: { "domain": "stripe.com" }
```

### `yoke_compare`

Side-by-side comparison of two domains across all scoring categories.

```
Input: { "domain1": "stripe.com", "domain2": "square.com" }
```

## Scoring Axes

| Axis | Weight | What it measures |
|------|--------|------------------|
| Security | 24% | SSL, headers, CSP, HSTS, WAF, DNSSEC |
| Speed | 18% | Core Web Vitals, compression, caching, HTTP/2+ |
| Foundations | 18% | DNS, hosting, uptime, infrastructure |
| Reputation | 15% | Domain age, trust signals, blocklists, breaches |
| Discoverability | 13% | SEO, structured data, social meta, robots.txt |
| Email | 12% | SPF, DKIM, DMARC, MX configuration |

## Tiers

| Tier | Score Range |
|------|-------------|
| Excellent | 90–100 |
| Strong | 78–89 |
| Moderate | 60–77 |
| Weak | 40–59 |
| Critical | 0–39 |

## Self-Hosting

Point the MCP server at your own Yoke instance:

```bash
YOKE_API_URL=https://your-instance.example.com npx @yokedotlol/mcp-server
```

Or in your client config:

```json
{
  "mcpServers": {
    "yoke": {
      "command": "npx",
      "args": ["-y", "@yokedotlol/mcp-server"],
      "env": {
        "YOKE_API_URL": "https://your-instance.example.com"
      }
    }
  }
}
```

## License

MIT — [yoke.lol](https://yoke.lol)
