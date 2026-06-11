import { logApiError } from "../api-errors";
import { AI_CACHE_TTL_MS, getAnalysisCacheTtlMs } from "../config/cache";
import { CORS_HEADERS, type Env, fetchWithTimeout, getFromCache, normalizeDomain, setCache } from "../helpers";
import { logError, logWarn } from "../logger";

// ─── Content-based cache key ────────────────────────────────────────
// Hash the analysis input so AI cache invalidates when signals change.
async function hashAnalysisInput(data: unknown): Promise<string> {
  const json = JSON.stringify(data);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < 8; i++) hex += arr[i].toString(16).padStart(2, "0"); // 16-char prefix
  return hex;
}

// ─── SSE streaming headers ──────────────────────────────────────────
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  ...CORS_HEADERS,
};

// ─── System Prompt ──────────────────────────────────────────────────

import { SIGNAL_REGISTRY } from "../config/signal-registry";
// AI analysis prompt — dynamically built from prompt fragments + signal calibration.
// Legacy static prompt (prompts/ai-analysis.txt) is replaced by the prompt builder.
import { buildSystemPrompt } from "../prompts/prompt-builder";

// ─── Data Sanitizer ─────────────────────────────────────────────────
// Strip verbose fields to keep token count low, and sanitize against prompt injection

const MAX_STRING_LENGTH = 500;

/** Truncate long string values and strip HTML/XML tags to prevent prompt injection */
function sanitizeStringValue(value: string): string {
  // Strip HTML/XML-like tags — handles malformed tags like <foo bar=">
  let cleaned = value.replace(/<[^>]*>|<[^>]*$/g, "");
  // Truncate and mark
  if (cleaned.length > MAX_STRING_LENGTH) {
    cleaned = `${cleaned.slice(0, MAX_STRING_LENGTH)} [truncated]`;
  }
  return cleaned;
}

/** Recursively sanitize all string values in an object */
function deepSanitizeStrings(obj: unknown): unknown {
  if (typeof obj === "string") return sanitizeStringValue(obj);
  if (Array.isArray(obj)) return obj.map(deepSanitizeStrings);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = deepSanitizeStrings(val);
    }
    return result;
  }
  return obj;
}

function sanitizeForLLM(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...data };

  // Strip raw headers (security_audit already summarizes them)
  if (sanitized.headers && typeof sanitized.headers === "object") {
    const h = { ...(sanitized.headers as Record<string, unknown>) };
    delete h.raw;
    sanitized.headers = h;
  }

  // Strip verbose robots parsed blocks
  if (sanitized.robots_parsed && typeof sanitized.robots_parsed === "object") {
    const rp = { ...(sanitized.robots_parsed as Record<string, unknown>) };
    delete rp.blocks;
    sanitized.robots_parsed = rp;
  }

  // Strip llms_txt full content (can be huge)
  if (sanitized.llms_txt && typeof sanitized.llms_txt === "object") {
    const lt = { ...(sanitized.llms_txt as Record<string, unknown>) };
    delete lt.content;
    delete lt.full_content;
    sanitized.llms_txt = lt;
  }

  // Strip json_ld raw fields
  if (Array.isArray(sanitized.json_ld)) {
    sanitized.json_ld = (sanitized.json_ld as Array<Record<string, unknown>>).map((item) => {
      const clean = { ...item };
      delete clean.raw;
      return clean;
    });
  }

  // Strip performance screenshot
  if (sanitized.performance && typeof sanitized.performance === "object") {
    const p = { ...(sanitized.performance as Record<string, unknown>) };
    delete p.screenshot;
    sanitized.performance = p;
  }

  // Remove meta fields that aren't useful for analysis
  if (sanitized.meta && typeof sanitized.meta === "object") {
    const m = { ...(sanitized.meta as Record<string, unknown>) };
    delete m.robots_txt; // raw text, already parsed in robots_parsed
    sanitized.meta = m;
  }

  // Strip verbose third-party script URLs — keep counts, categories, and flags
  if (sanitized.third_party_scripts && typeof sanitized.third_party_scripts === "object") {
    const tps = { ...(sanitized.third_party_scripts as Record<string, unknown>) };
    if (tps.categories && typeof tps.categories === "object") {
      const cats: Record<string, unknown> = {};
      for (const [cat, val] of Object.entries(tps.categories as Record<string, unknown>)) {
        if (val && typeof val === "object" && "count" in (val as Record<string, unknown>)) {
          cats[cat] = { count: (val as Record<string, unknown>).count };
        }
      }
      tps.categories = cats;
    }
    sanitized.third_party_scripts = tps;
  }

  // Strip verbose accessibility check details — keep name, status, and impact
  if (sanitized.accessibility && typeof sanitized.accessibility === "object") {
    const a11y = { ...(sanitized.accessibility as Record<string, unknown>) };
    if (Array.isArray(a11y.checks)) {
      a11y.checks = (a11y.checks as Array<Record<string, unknown>>).map((check) => ({
        name: check.name,
        status: check.status,
        impact: check.impact,
      }));
    }
    sanitized.accessibility = a11y;
  }

  // Strip verbose cookie details — keep category counts and compliance flags
  if (sanitized.cookie_consent && typeof sanitized.cookie_consent === "object") {
    const cc = { ...(sanitized.cookie_consent as Record<string, unknown>) };
    if (Array.isArray(cc.cookies_set)) {
      const cookies = cc.cookies_set as Array<Record<string, unknown>>;
      cc.cookie_count = cookies.length;
      cc.cookie_categories = cookies.reduce(
        (acc: Record<string, number>, c) => {
          const cat = String(c.category || "unknown");
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      cc.insecure_cookies = cookies.filter((c) => !c.secure).length;
      delete cc.cookies_set;
    }
    sanitized.cookie_consent = cc;
  }

  // Strip per-resolver IPs from DNS propagation — keep consistency summary
  if (sanitized.network_health && typeof sanitized.network_health === "object") {
    const nh = { ...(sanitized.network_health as Record<string, unknown>) };
    if (nh.dns_propagation && typeof nh.dns_propagation === "object") {
      const dns = { ...(nh.dns_propagation as Record<string, unknown>) };
      if (Array.isArray(dns.resolvers)) {
        dns.resolvers = (dns.resolvers as Array<Record<string, unknown>>).map((r) => ({
          name: r.name,
          status: r.status,
          response_time_ms: r.response_time_ms,
          ip_count: Array.isArray(r.ips) ? (r.ips as string[]).length : 0,
        }));
      }
      nh.dns_propagation = dns;
    }
    sanitized.network_health = nh;
  }

  // Deep sanitize all remaining string values against prompt injection
  return deepSanitizeStrings(sanitized) as Record<string, unknown>;
}

// ─── Prompt Builder (shared by AI call and DIY copy) ────────────────

/** Extract archetype and signal IDs from analysis data for dynamic prompt building */
function extractPromptContext(data: Record<string, unknown>): {
  archetype: import("../actions/analyze/contextual-scoring").ArchetypeResult | null;
  signalIds: string[];
} {
  const domainScore = data.domain_score as Record<string, unknown> | null;
  let archetype = null;
  const signalIds: string[] = [];

  if (domainScore) {
    // Extract archetype
    if (domainScore.archetype && typeof domainScore.archetype === "object") {
      archetype = domainScore.archetype as import("../actions/analyze/contextual-scoring").ArchetypeResult;
    }

    // Extract signal IDs from findings across all axes
    if (domainScore.axes && typeof domainScore.axes === "object") {
      for (const axisData of Object.values(domainScore.axes as Record<string, unknown>)) {
        if (axisData && typeof axisData === "object" && "findings" in (axisData as Record<string, unknown>)) {
          const findings = (axisData as Record<string, unknown>).findings;
          if (Array.isArray(findings)) {
            for (const f of findings) {
              if (f && typeof f === "object" && "signal" in f) {
                signalIds.push(String(f.signal));
              }
            }
          }
        }
      }
    }
  }

  // If no signal IDs from findings, use all registered signals as fallback
  if (signalIds.length === 0) {
    signalIds.push(...Object.keys(SIGNAL_REGISTRY));
  }

  return { archetype, signalIds };
}

export function buildAIPrompt(analysisData: Record<string, unknown>): { system: string; user: string } {
  const sanitized = sanitizeForLLM(analysisData);

  const { archetype, signalIds } = extractPromptContext(analysisData);

  let system: string;
  if (archetype) {
    system = buildSystemPrompt(archetype, signalIds);
  } else {
    // Fallback: use all signals with a default general archetype
    const defaultArchetype: import("../actions/analyze/contextual-scoring").ArchetypeResult = {
      detected: "general",
      confidence: 0.5,
      secondary: null,
      signals: [],
      platform: null,
      weights: { security: 0.24, speed: 0.18, foundations: 0.18, reputation: 0.15, discoverability: 0.13, email: 0.12 },
    };
    system = buildSystemPrompt(defaultArchetype, Object.keys(SIGNAL_REGISTRY));
  }

  const userMessage = `<domain_data>\n${JSON.stringify(sanitized, null, 0)}\n</domain_data>\n\nAnalyze this domain and provide your structured assessment.`;
  return { system, user: userMessage };
}

// ─── OpenRouter API Call ────────────────────────────────────────────

// DeepSeek V3 via OpenRouter — much cheaper than Claude Sonnet while producing
// excellent structured JSON output for our cross-signal insight use case.
// Claude Sonnet 4: ~$3/$15 per 1M tokens; DeepSeek V3: ~$0.27/$1.10.
// Quality is comparable for structured extraction / correlation tasks.
const DEFAULT_MODEL = "deepseek/deepseek-chat-v3-0324";

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function callOpenRouter(
  apiKey: string,
  analysisData: Record<string, unknown>,
  referer?: string,
  model?: string,
): Promise<AIAnalysisResult> {
  const { system, user } = buildAIPrompt(analysisData);
  const useModel = model || DEFAULT_MODEL;

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }

    try {
      // CF Workers Unbound: 30s CPU limit but 6-min wall clock for I/O-bound waits.
      // LLM response streaming is I/O, not CPU, so 90s is safe.
      const response = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        timeout: 90000,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": referer || "https://github.com/yokedotlol/yoke",
          "X-Title": "Yoke Domain Intelligence",
        },
        body: JSON.stringify({
          model: useModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });

      // Don't retry on 4xx (auth errors, bad request) — only on 5xx/network
      if (!response.ok) {
        const errText = await response.text();
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`OpenRouter API error ${response.status}: ${errText.slice(0, 200)}`);
        }
        lastError = new Error(`OpenRouter API error ${response.status}: ${errText.slice(0, 200)}`);
        logWarn("OpenRouter attempt failed", { attempt: attempt + 1, maxRetries, status: response.status });
        continue;
      }

      const data = (await response.json()) as OpenRouterResponse;

      if (!data.choices?.[0]?.message?.content) {
        throw new Error("Empty response from LLM");
      }

      const content = data.choices[0].message.content.trim();

      // Use shared parser (handles markdown fences, truncated JSON, BOM)
      const parsed = parseAIContent(content);
      if (!parsed) {
        throw new Error(`Failed to parse LLM response as JSON: ${content.slice(0, 200)}`);
      }

      // Attach token usage for transparency
      if (data.usage) {
        parsed._usage = {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          total_tokens: data.usage.total_tokens,
        };
      }

      return parsed;
    } catch (err) {
      // 4xx and parse errors bubble up immediately (already thrown above)
      if (lastError === null) throw err;
      logWarn("OpenRouter attempt error", {
        attempt: attempt + 1,
        maxRetries,
        error: err instanceof Error ? err.message : String(err),
      });
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error("AI analysis failed after retries");
}

// ─── Types ──────────────────────────────────────────────────────────

interface KeyFinding {
  category: string;
  finding: string;
  severity: string;
  action: string;
}

interface Recommendation {
  priority: number;
  action: string;
  impact: string;
  effort: string;
  tool?: string;
}

interface CrossSignalInsight {
  insight: string;
  signals_cited: string[];
  severity: "info" | "low" | "medium" | "high";
  actionable: boolean;
}

interface AIAnalysisResult {
  summary: string;
  posture: string;
  key_findings: KeyFinding[];
  cross_signal_insights: CrossSignalInsight[];
  attack_surface: string[];
  recommendations: Recommendation[];
  _usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface CachedAIResult {
  result: AIAnalysisResult;
  analyzed_at: string;
  domain: string;
}

// ─── Rate Limiting ──────────────────────────────────────────────────

const AI_HOURLY_LIMIT = 10;
const AI_DOMAIN_HOURLY_LIMIT = 3; // max 3 AI analyses per domain per hour

async function ensureRateLimitTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS ai_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0)",
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_rate_ip_ts ON ai_rate_limits(ip, ts)").run();
}

async function getRateLimitCount(db: D1Database, ip: string): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - 3600;
  const row = await db
    .prepare("SELECT COUNT(*) as cnt FROM ai_rate_limits WHERE ip = ? AND ts > ?")
    .bind(ip, cutoff)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// recordRateLimitHit removed — rate limit insertion is done inline in getAIAnalysis

async function cleanupOldRateLimits(db: D1Database): Promise<void> {
  // Probabilistic cleanup: 5% chance per request, delete entries older than 2 hours
  if (Math.random() > 0.05) return;
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 7200;
    await db.prepare("DELETE FROM ai_rate_limits WHERE ts < ?").bind(cutoff).run();
    await db.prepare("DELETE FROM ai_domain_rate_limits WHERE ts < ?").bind(cutoff).run();
  } catch {
    /* cleanup failure is non-critical */
  }
}

// ─── Domain-level rate limiting ─────────────────────────────────────

async function ensureDomainRateLimitTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS ai_domain_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0)",
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_ai_domain_rate_domain_ts ON ai_domain_rate_limits(domain, ts)")
    .run();
}

async function getDomainRateLimitCount(db: D1Database, domain: string): Promise<number> {
  try {
    await ensureDomainRateLimitTable(db);
    const cutoff = Math.floor(Date.now() / 1000) - 3600;
    const row = await db
      .prepare("SELECT COUNT(*) as cnt FROM ai_domain_rate_limits WHERE domain = ? AND ts > ?")
      .bind(domain, cutoff)
      .first<{ cnt: number }>();
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

async function recordDomainRateLimitHit(db: D1Database, domain: string): Promise<void> {
  try {
    await ensureDomainRateLimitTable(db);
    await db
      .prepare("INSERT INTO ai_domain_rate_limits (domain, ts) VALUES (?, ?)")
      .bind(domain, Math.floor(Date.now() / 1000))
      .run();
  } catch {
    /* non-critical */
  }
}

// ─── Streaming OpenRouter Call ──────────────────────────────────────
// Returns a ReadableStream that yields SSE events with content chunks.
// After the stream completes, the full assembled response is cached.

function streamOpenRouter(
  apiKey: string,
  analysisData: Record<string, unknown>,
  referer?: string,
  model?: string,
): { stream: ReadableStream; fullContent: Promise<string> } {
  const { system, user } = buildAIPrompt(analysisData);
  const useModel = model || DEFAULT_MODEL;
  let resolveContent: (v: string) => void;
  let rejectContent: (e: Error) => void;
  const fullContent = new Promise<string>((res, rej) => {
    resolveContent = res;
    rejectContent = rej;
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          // CF Workers Unbound: 30s CPU limit but 6-min wall clock for I/O-bound waits.
          // LLM streaming is I/O, not CPU, so 55s is safe and matches the non-streaming retry path.
          signal: AbortSignal.timeout(90000), // CF Workers Unbound: 30s CPU limit but 6-min wall clock for I/O
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": referer || "https://github.com/yokedotlol/yoke",
            "X-Title": "Yoke Domain Intelligence",
          },
          body: JSON.stringify({
            model: useModel,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            temperature: 0.3,
            max_tokens: 4000,
            stream: true,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          const errMsg = `OpenRouter API error ${response.status}: ${errText.slice(0, 200)}`;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`));
          controller.close();
          rejectContent?.(new Error(errMsg));
          return;
        }

        if (!response.body) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "No response body" })}\n\n`));
          controller.close();
          rejectContent?.(new Error("No response body"));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const json = JSON.parse(trimmed.slice(6));
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                accumulated += content;
                // Forward chunk to client
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`));
              }
            } catch {
              // Skip malformed SSE lines
            }
          }
        }

        // Send completion event
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
        resolveContent?.(accumulated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        } catch {
          /* controller already closed */
        }
        rejectContent?.(err instanceof Error ? err : new Error(msg));
      }
    },
  });

  return { stream, fullContent };
}

// ─── Parse and cache streamed result ────────────────────────────────

function parseAIContent(content: string): AIAnalysisResult | null {
  let jsonStr = content.trim();
  // Try standard markdown fence extraction
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  // Fallback: if output was truncated and closing ``` is missing, strip opening fence
  else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").trim();
  }
  jsonStr = jsonStr.replace(/^\uFEFF/, "").trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(jsonStr) as AIAnalysisResult;
    if (parsed.summary && parsed.posture && Array.isArray(parsed.key_findings)) {
      return parsed;
    }
  } catch {
    /* invalid JSON — try salvage */
  }

  // Fallback: try to salvage truncated JSON by closing open structures
  try {
    let salvaged = jsonStr;
    // Close any unclosed strings
    const quoteCount = (salvaged.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) salvaged += '"';
    // Close arrays and objects
    const openBraces = (salvaged.match(/{/g) || []).length;
    const closeBraces = (salvaged.match(/}/g) || []).length;
    const openBrackets = (salvaged.match(/\[/g) || []).length;
    const closeBrackets = (salvaged.match(/]/g) || []).length;
    // Remove trailing comma before closing
    salvaged = salvaged.replace(/,\s*$/, "");
    for (let i = 0; i < openBrackets - closeBrackets; i++) salvaged += "]";
    for (let i = 0; i < openBraces - closeBraces; i++) salvaged += "}";
    const parsed = JSON.parse(salvaged) as AIAnalysisResult;
    if (parsed.summary && parsed.posture && Array.isArray(parsed.key_findings)) {
      return parsed;
    }
  } catch {
    /* salvage failed */
  }

  return null;
}

// ─── Main Export ────────────────────────────────────────────────────

export async function getAIAnalysis(
  domain: string,
  env: Env,
  options?: { clientIP?: string; stream?: boolean; ctx?: ExecutionContext; byoKey?: string; byoModel?: string },
): Promise<Response> {
  const normalized = normalizeDomain(domain);
  const clientIP = options?.clientIP || "unknown";
  const wantStream = options?.stream ?? false;
  // BYO key passthrough — use client's key when provided, fall back to platform key
  const apiKey = options?.byoKey || env.OPENROUTER_API_KEY;
  const model = options?.byoModel || DEFAULT_MODEL;
  const isByoKey = !!options?.byoKey;

  // Must have either platform key or BYO key
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "AI analysis not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Get the analysis data for this domain (from cache or fresh)
  if (!env.REFERENCE_DATA) {
    return new Response(JSON.stringify({ error: "AI analysis temporarily unavailable — cache service offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  const analysisCache = (await getFromCache(
    env.REFERENCE_DATA,
    normalized,
    "analysis",
    getAnalysisCacheTtlMs(env),
  )) as Record<string, unknown> | null;

  if (!analysisCache) {
    return new Response(JSON.stringify({ error: "Domain not yet analyzed. Run a standard analysis first." }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Content-keyed AI cache: hash the analysis input so cache auto-invalidates when signals change
  const inputHash = await hashAnalysisInput(analysisCache);
  const aiCacheType = `ai_analysis:${inputHash}`;

  // Check cache — serve if signals haven't changed (TTL is just a safety net)
  const cached = (await getFromCache(
    env.REFERENCE_DATA,
    normalized,
    aiCacheType,
    AI_CACHE_TTL_MS,
  )) as CachedAIResult | null;
  if (cached?.result?.cross_signal_insights) {
    return new Response(JSON.stringify({ ...cached, cached: true }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Rate limiting — skip for BYO key users (they're using their own credits)
  let rateLimitRowId: number | undefined;
  if (!isByoKey) {
    try {
      if (!env.STATS_DB) throw new Error("STATS_DB not available (self-hosted)");
      await ensureRateLimitTable(env.STATS_DB);
      const count = await getRateLimitCount(env.STATS_DB, clientIP);
      if (count >= AI_HOURLY_LIMIT) {
        const { system, user } = buildAIPrompt(analysisCache);
        const diyPrompt = `${system}\n\n---\n\n${user}`;
        return new Response(
          JSON.stringify({
            rate_limited: true,
            limit: AI_HOURLY_LIMIT,
            used: count,
            reset: "~1 hour",
            diy_prompt: diyPrompt,
            model_suggestion: "deepseek/deepseek-chat-v3-0324",
            instructions: "Copy the prompt below and paste it into ChatGPT, Claude, Gemini, or any AI assistant.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              ...CORS_HEADERS,
              "X-RateLimit-Limit": String(AI_HOURLY_LIMIT),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 3600),
              "Retry-After": "3600",
            },
          },
        );
      }
      // Domain-level rate limit — prevent hammering the same domain
      const domainCount = await getDomainRateLimitCount(env.STATS_DB, normalized);
      if (domainCount >= AI_DOMAIN_HOURLY_LIMIT) {
        return new Response(
          JSON.stringify({
            rate_limited: true,
            limit: AI_DOMAIN_HOURLY_LIMIT,
            used: domainCount,
            reset: "~1 hour",
            message: `This domain has been analyzed ${domainCount} times in the last hour. Results are cached — the analysis doesn't change that fast.`,
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS, "Retry-After": "3600" },
          },
        );
      }
      const rlResult = await env.STATS_DB.prepare("INSERT INTO ai_rate_limits (ip, ts) VALUES (?, ?)")
        .bind(clientIP, Math.floor(Date.now() / 1000))
        .run();
      rateLimitRowId = rlResult.meta?.last_row_id as number | undefined;
      await recordDomainRateLimitHit(env.STATS_DB, normalized);
    } catch (rateLimitErr) {
      logError("AI rate-limit DB error", {
        error: rateLimitErr instanceof Error ? rateLimitErr.message : String(rateLimitErr),
      });
      // KV fallback: if D1 is unreachable but KV is available, use it for rate limiting (I13)
      if (env.REFERENCE_DATA) {
        try {
          const window = Math.floor(Date.now() / 3600000); // hourly window
          const kvKey = `ratelimit:${clientIP}:ai:${window}`;
          const existing = await env.REFERENCE_DATA.get(kvKey);
          const count = existing ? parseInt(existing, 10) : 0;
          if (count >= AI_HOURLY_LIMIT) {
            const { system, user } = buildAIPrompt(analysisCache);
            const diyPrompt = `${system}\n\n---\n\n${user}`;
            return new Response(
              JSON.stringify({
                rate_limited: true,
                limit: AI_HOURLY_LIMIT,
                used: count,
                reset: "~1 hour",
                diy_prompt: diyPrompt,
                model_suggestion: "deepseek/deepseek-chat-v3-0324",
                instructions: "Copy the prompt below and paste it into ChatGPT, Claude, Gemini, or any AI assistant.",
              }),
              {
                status: 429,
                headers: { "Content-Type": "application/json", ...CORS_HEADERS, "Retry-After": "3600" },
              },
            );
          }
          // Domain-level KV rate limit
          const domainKvKey = `ratelimit:domain:${normalized}:ai:${window}`;
          const domainExisting = await env.REFERENCE_DATA.get(domainKvKey);
          const domainCount = domainExisting ? parseInt(domainExisting, 10) : 0;
          if (domainCount >= AI_DOMAIN_HOURLY_LIMIT) {
            return new Response(
              JSON.stringify({
                rate_limited: true,
                limit: AI_DOMAIN_HOURLY_LIMIT,
                used: domainCount,
                reset: "~1 hour",
                message: `This domain has been analyzed ${domainCount} times in the last hour. Results are cached.`,
              }),
              {
                status: 429,
                headers: { "Content-Type": "application/json", ...CORS_HEADERS, "Retry-After": "3600" },
              },
            );
          }
          // Increment counters with 2hr TTL
          await env.REFERENCE_DATA.put(kvKey, String(count + 1), { expirationTtl: 7200 });
          await env.REFERENCE_DATA.put(domainKvKey, String(domainCount + 1), { expirationTtl: 7200 });
          logWarn("AI rate-limit: using KV fallback (D1 unavailable)");
        } catch (kvErr) {
          logError("AI rate-limit KV fallback also failed", {
            error: kvErr instanceof Error ? kvErr.message : String(kvErr),
          });
          // Both D1 and KV failed — fail closed
          return new Response(
            JSON.stringify({ error: "AI analysis temporarily unavailable — rate limit service error" }),
            {
              status: 503,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            },
          );
        }
      } else {
        // Fail closed on DB error — return 503 instead of allowing unlimited requests
        return new Response(
          JSON.stringify({ error: "AI analysis temporarily unavailable — rate limit service error" }),
          {
            status: 503,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          },
        );
      }
    }
  } // end BYO key rate-limit skip

  // ─── Streaming path ────────────────────────────────────────────────
  if (wantStream) {
    const { stream, fullContent } = streamOpenRouter(apiKey!, analysisCache, env.BASE_URL, model);

    // Cache the assembled result after stream completes (fire-and-forget)
    const cachePromise = fullContent
      .then(async (content) => {
        const parsed = parseAIContent(content);
        if (parsed) {
          const responseData: CachedAIResult = {
            result: parsed,
            analyzed_at: new Date().toISOString(),
            domain: normalized,
          };
          if (env.REFERENCE_DATA) {
            if (env.REFERENCE_DATA) {
              await setCache(env.REFERENCE_DATA, normalized, aiCacheType, responseData);
            }
          }
        }
        try {
          await cleanupOldRateLimits(env.STATS_DB);
        } catch {
          /* non-critical */
        }
      })
      .catch(async (err) => {
        // Stream failed — release rate limit slot
        if (rateLimitRowId) {
          try {
            await env.STATS_DB.prepare("DELETE FROM ai_rate_limits WHERE id = ?").bind(rateLimitRowId).run();
          } catch {
            /* non-critical */
          }
        }
        logApiError(env.STATS_DB, {
          api: "openrouter",
          status: 0,
          message: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          domain: normalized,
        });
      });

    // Use waitUntil to keep the worker alive for caching after response is sent
    if (options?.ctx) {
      options.ctx.waitUntil(cachePromise);
    }

    return new Response(stream, { headers: SSE_HEADERS });
  }

  // ─── Non-streaming path (fallback) ─────────────────────────────────
  try {
    const result = await callOpenRouter(apiKey!, analysisCache, env.BASE_URL, model);

    const responseData: CachedAIResult = {
      result,
      analyzed_at: new Date().toISOString(),
      domain: normalized,
    };

    await setCache(env.REFERENCE_DATA, normalized, aiCacheType, responseData);

    try {
      await cleanupOldRateLimits(env.STATS_DB);
    } catch {
      /* non-critical */
    }

    return new Response(JSON.stringify({ ...responseData, cached: false }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    if (rateLimitRowId) {
      try {
        await env.STATS_DB.prepare("DELETE FROM ai_rate_limits WHERE id = ?").bind(rateLimitRowId).run();
      } catch {
        /* decrement failure is non-critical */
      }
    }
    const msg = err instanceof Error ? err.message : "AI analysis failed";
    logApiError(env.STATS_DB, { api: "openrouter", status: 0, message: msg.slice(0, 200), domain: normalized });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
}
