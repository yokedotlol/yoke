# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Yoke, please report it responsibly.

**Email:** [hello@yoke.lol](mailto:hello@yoke.lol)

Include as much detail as you can:
- Description of the vulnerability
- Steps to reproduce
- Affected component (worker, CLI, extension, Fly proxy, etc.)
- Potential impact

**Please do not** open a public GitHub issue for security vulnerabilities.

## What Counts

- Authentication or authorization bypasses
- Server-Side Request Forgery (SSRF) — especially bypasses of the existing blocklist
- Injection vulnerabilities (SQL injection in D1 queries, XSS in rendered output)
- Exposure of API keys, secrets, or credentials
- Data exfiltration from the D1 database or KV store
- Bypasses of rate limiting that enable abuse at scale
- Vulnerabilities in the Chrome extension (CSP bypass, privilege escalation)
- Significant information disclosure beyond what the tool intentionally surfaces

## Out of Scope

- Rate limit thresholds being too generous or too strict (that's tuning, not a vulnerability)
- Social engineering or phishing
- Denial of service via high volume of legitimate requests
- Findings from automated scanners without a demonstrated exploit
- Vulnerabilities in third-party services Yoke calls (report those to the service directly)
- Missing security headers on third-party domains Yoke analyzes (that's the point of the tool)

## Response

This is a solo open-source project, not a company with a security team. That said:

- I'll acknowledge your report within **72 hours**
- I'll provide an initial assessment within **1 week**
- Critical issues will be patched as fast as possible
- You'll be credited in the fix commit and CHANGELOG unless you prefer otherwise

## Bug Bounty

There is no formal bug bounty program. If you find something significant, you'll get credit and my genuine gratitude.

## Data Handling

Yoke takes a privacy-first approach to user data:

- **No raw IP storage.** User IP addresses are hashed before any service-owned persistence. Rate-limit keys use a secret-salted stable SHA-256 hash so sliding windows survive day boundaries and are pruned within hours. Anonymous visitor analytics use a separate secret-salted daily-rotating hash. Neither hash is reversible, and raw IPs are not written to Yoke's databases.
- **No accounts or sessions.** There are no user accounts, login cookies, session tokens, or tracking pixels.
- **No client-side tracking.** No analytics scripts, no fingerprinting, no third-party trackers.
- **BYO API keys are ephemeral.** Keys stored in `localStorage` on the client. On the server, they exist in memory for a single request, then are discarded. Never logged or persisted.
- **Domain data is public.** Everything Yoke stores about analyzed domains (DNS, WHOIS, SSL, headers) is publicly available information.

See our [Privacy Policy](https://yoke.lol/privacy) for the full picture.
