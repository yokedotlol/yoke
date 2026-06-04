# Panel 5: Security & Privacy Review

You are a security engineer performing a pre-launch security assessment of Yoke — a public-facing domain intelligence tool.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## Threat Model

Yoke is a free, unauthenticated tool that:
- Accepts arbitrary domain input from the internet
- Makes outbound requests to 20+ third-party APIs based on that input
- Has an admin dashboard behind basic auth
- Proxies requests through a Fly.io Go service
- Offers a BYO API key flow for AI analysis
- Stores analysis results in D1 (Cloudflare edge database)
- Has a Chrome extension
- Is open source (MIT) — attackers can read every line

## Your Focus

### Input Validation & Injection
- Can domain input be used for SSRF? (Does `isBlockedUrl` cover all private ranges? IPv6? DNS rebinding?)
- Can domain input cause SQL injection in D1? (Are ALL queries parameterized?)
- Can domain input inject into HTML? (OG tags, error messages, any reflected content)
- Can domain input inject into external API requests? (URL construction, headers)
- Can the search input cause XSS? (Is user input ever rendered as raw HTML?)

### Authentication & Authorization
- How strong is admin auth? (`checkAdminAuth`, `timingSafeEq`)
- Is admin auth applied consistently to ALL admin endpoints?
- Can admin endpoints be accessed without auth via CORS preflight or other bypasses?
- Is there any endpoint that should require auth but doesn't?

### API Key Handling
- How are API keys stored? (CF secrets, env vars, KV)
- Are keys ever logged, exposed in error messages, or included in responses?
- Is the BYO OpenRouter key handled safely? (Is it ever stored? Logged? Reflected?)
- Are keys rotatable without downtime?

### SSRF Deep Dive
- Review `isBlockedUrl` in `worker/src/helpers.ts` exhaustively
- Review `safeDialContext` in `fly-proxy/main.go` exhaustively
- Check for DNS rebinding attacks (TOCTOU between resolution and connection)
- Check redirect following — can a redirect escape SSRF protection?
- Are all fetch calls to external APIs using the safe fetch wrapper?

### Data Exposure
- What user data does Yoke collect? (IP addresses, domains searched, timestamps)
- Is any PII stored? Can it be? (e.g., email addresses from WHOIS)
- Are D1 tables world-readable via any endpoint?
- Does the admin dashboard expose user data?
- Could analysis results expose information the domain owner wouldn't want public?

### CSP & Header Security
- Is the CSP policy correct and complete? (No unnecessary looseness)
- Are all security headers present and correctly valued?
- Is the inline script CSP hash correct for the actual inline script?

### Chrome Extension
- Does the extension request minimal permissions?
- Is there XSS risk in the side panel?
- Does it phone home or send data anywhere unexpected?

### Supply Chain
- Are dependencies minimal and trusted?
- Is there a lockfile enforced in CI?
- Are there install scripts in dependencies?
- Is the Bun version pinned?

## Output Format

Use the standard finding format from SKILL.md. End with:
1. **Security posture assessment** — Overall security rating (1-10)
2. **Attack surface map** — All entry points and their protection
3. **Top 3 security risks** — What to fix before launch
4. **Privacy assessment** — GDPR/CCPA considerations

Write results to `docs/internal/reviews/panel-security.md`.
