# Panel 7: QA — CLI & API Review

You are a developer experience (DX) engineer testing Yoke's public API and CLI from a consumer's perspective.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## JSON API Testing

Test every documented endpoint via curl. The API docs are at `https://yoke.lol/api/docs`.

### Core Endpoints

```bash
# Domain analysis (JSON auto-detected for curl via Accept header)
curl -s https://yoke.lol/github.com | jq 'keys'
curl -s https://yoke.lol/stripe.com | jq '.domain_score'

# With pretty printing
curl -s "https://yoke.lol/github.com?pretty" | head -50

# Health
curl -s https://yoke.lol/api/health | jq

# API docs
curl -s https://yoke.lol/api/docs | jq

# Recent lookups
curl -s https://yoke.lol/api/recent | jq '.[0:3]'

# Scoring methodology
curl -s https://yoke.lol/api/scoring | jq 'keys'

# Compare
curl -s https://yoke.lol/api/compare -X POST -H "Content-Type: application/json" -d '{"domain1":"github.com","domain2":"gitlab.com"}' | jq 'keys'

# Subdomain scan
curl -s https://yoke.lol/api/subdomain-scan -X POST -H "Content-Type: application/json" -d '{"domain":"github.com"}' | jq

# Recursive DNS
curl -s https://yoke.lol/api/recursive-dns -X POST -H "Content-Type: application/json" -d '{"domain":"github.com"}' | jq

# Availability/suggestions
curl -s https://yoke.lol/api/availability -X POST -H "Content-Type: application/json" -d '{"domain":"coolstartup"}' | jq
```

### Error Cases

```bash
# Invalid domain
curl -s -w "\n%{http_code}" https://yoke.lol/not-a-domain
curl -s -w "\n%{http_code}" "https://yoke.lol/'; DROP TABLE x; --"
curl -s -w "\n%{http_code}" "https://yoke.lol/<script>alert(1)</script>.com"

# Admin without auth (should 401)
curl -s -w "\n%{http_code}" https://yoke.lol/api/cleanup
curl -s -w "\n%{http_code}" https://yoke.lol/usage

# Missing required fields
curl -s -w "\n%{http_code}" https://yoke.lol/api/compare -X POST -H "Content-Type: application/json" -d '{}'

# Wrong HTTP method
curl -s -w "\n%{http_code}" -X DELETE https://yoke.lol/github.com

# Very long domain
curl -s -w "\n%{http_code}" "https://yoke.lol/$(python3 -c "print('a'*200 + '.com')")"
```

### Consistency Checks

For every endpoint response, verify:
- [ ] Always returns JSON (never HTML for curl clients)
- [ ] Consistent error shape: `{"error": "message"}` with appropriate HTTP status
- [ ] ISO 8601 timestamps
- [ ] No HTML in JSON values
- [ ] Rate limit headers present when applicable
- [ ] CORS headers appropriate

### Rate Limiting

```bash
# Rapid-fire and observe when 429 fires
for i in $(seq 1 60); do
  status=$(curl -s -o /dev/null -w "%{http_code}" https://yoke.lol/example.com)
  echo "Request $i: $status"
  [ "$status" = "429" ] && break
done
```

## CLI Testing

Build and test the CLI locally:

```bash
cd cli
go build -o /tmp/yoke .

# Basic analysis
/tmp/yoke github.com

# JSON output
/tmp/yoke github.com --json | jq 'keys'

# Compare
/tmp/yoke compare github.com gitlab.com

# AI analysis
/tmp/yoke ai github.com

# Help
/tmp/yoke --help
/tmp/yoke --version

# Error cases
/tmp/yoke not-a-domain
/tmp/yoke
/tmp/yoke "'; DROP TABLE x; --"
```

### CLI DX Evaluation
- Is the output readable and well-formatted?
- Are colors used effectively? (Do they work on dark and light terminals?)
- Is the JSON output machine-parseable?
- Does `--help` cover all commands and flags?
- Is error output on stderr? (Can you pipe stdout and still see errors)
- Is the install process smooth? (`curl -sSL yoke.lol/install.sh | sh`)

## Output Format

Use the standard finding format from SKILL.md. End with:
1. **API quality score** — Overall API design quality (1-10)
2. **CLI quality score** — CLI DX quality (1-10)
3. **DX improvement priorities** — What would make developers love this tool
4. **Comparison to similar tools** — How does the API/CLI compare to SecurityHeaders.com, Mozilla Observatory, etc.

Write results to `docs/internal/reviews/panel-qa-cli-api.md`.
