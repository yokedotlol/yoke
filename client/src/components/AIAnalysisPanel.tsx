import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Loader2,
  RotateCcw,
  Settings,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { severityColor, severityIcon } from "../utils/severity";
import type { AnalysisResult } from "../utils/types";
import { ScoreWaterfall } from "./ScoreWaterfall";

// ─── Types ──────────────────────────────────────────────────────────

interface CrossSignalInsight {
  insight: string;
  signals_cited: string[];
  severity: "info" | "low" | "medium" | "high";
  actionable: boolean;
}

interface AIAnalysisResult {
  summary: string;
  posture: string;
  key_findings: Array<{ category: string; finding: string; severity: string; action: string }>;
  cross_signal_insights: CrossSignalInsight[];
  attack_surface: string[];
  recommendations: Array<{ priority: number; action: string; impact: string; effort: string; tool?: string }>;
  _usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface AIAnalysisResponse {
  result: AIAnalysisResult;
  analyzed_at: string;
  domain: string;
  cached: boolean;
  error?: string;
}

interface RateLimitResponse {
  rate_limited: true;
  limit: number;
  used: number;
  reset: string;
  diy_prompt: string;
  model_suggestion: string;
  instructions: string;
}

// ─── BYO Key helpers ────────────────────────────────────────────────

const STORAGE_KEY = "yoke_openrouter_key";
const MODEL_STORAGE_KEY = "yoke_openrouter_model";
const CUSTOM_PROMPT_KEY = "yoke_custom_prompt";
const SETTINGS_OPEN_KEY = "yoke_settings_open";

const AVAILABLE_MODELS = [
  { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3", provider: "DeepSeek" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4", label: "Claude Opus 4", provider: "Anthropic" },
  { id: "openai/gpt-4o", label: "GPT-4o", provider: "OpenAI" },
  { id: "openai/o3", label: "o3", provider: "OpenAI" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "Meta" },
];

function getSavedKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}
function saveKey(key: string) {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
function getSavedModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || "deepseek/deepseek-chat-v3-0324";
  } catch {
    return "deepseek/deepseek-chat-v3-0324";
  }
}
function saveModel(model: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    /* noop */
  }
}
function getCustomPrompt(): string {
  try {
    return localStorage.getItem(CUSTOM_PROMPT_KEY) || "";
  } catch {
    return "";
  }
}
function saveCustomPrompt(prompt: string) {
  try {
    if (prompt) localStorage.setItem(CUSTOM_PROMPT_KEY, prompt);
    else localStorage.removeItem(CUSTOM_PROMPT_KEY);
  } catch {
    /* noop */
  }
}
function getSettingsOpen(): boolean {
  try {
    return localStorage.getItem(SETTINGS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}
function saveSettingsOpen(open: boolean) {
  try {
    localStorage.setItem(SETTINGS_OPEN_KEY, String(open));
  } catch {
    /* noop */
  }
}

// ─── Advanced Settings Panel ────────────────────────────────────────

function AdvancedSettings({
  domain,
  onKeyChange,
  onModelChange,
}: {
  domain: string;
  onKeyChange: (key: string) => void;
  onModelChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(getSettingsOpen);
  const [keyValue, setKeyValue] = useState(getSavedKey);
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [model, setModel] = useState(getSavedModel);
  const [promptText, setPromptText] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptEdited, setPromptEdited] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const hasKey = !!getSavedKey();

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    saveSettingsOpen(next);
    if (next && !promptText && domain) {
      loadPrompt();
    }
  };

  // Load prompt when panel starts open (e.g. persisted in localStorage)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only re-run on domain change to avoid infinite loops
  useEffect(() => {
    if (open && !promptText && domain) {
      loadPrompt();
    }
  }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPrompt = async () => {
    setPromptLoading(true);
    try {
      const res = await fetch("/api/ai-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (res.ok) {
        const data = (await res.json()) as { system: string; user: string };
        const fullPrompt = `${data.system}\n\n---\n\n${data.user}`;
        setDefaultPrompt(fullPrompt);
        const custom = getCustomPrompt();
        setPromptText(custom || fullPrompt);
        setPromptEdited(!!custom);
      }
    } catch {
      /* noop */
    }
    setPromptLoading(false);
  };

  const handleKeySave = () => {
    const trimmed = keyValue.trim();
    saveKey(trimmed);
    onKeyChange(trimmed);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const handleKeyRemove = () => {
    setKeyValue("");
    saveKey("");
    onKeyChange("");
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    saveModel(newModel);
    onModelChange(newModel);
  };

  const handlePromptChange = (newText: string) => {
    setPromptText(newText);
    setPromptEdited(newText !== defaultPrompt);
    saveCustomPrompt(newText === defaultPrompt ? "" : newText);
  };

  const handlePromptReset = () => {
    setPromptText(defaultPrompt);
    setPromptEdited(false);
    saveCustomPrompt("");
  };

  const handlePromptCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  return (
    <div style={{ width: open ? "100%" : "auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={toggleOpen}
          title="Advanced AI settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 10px",
            borderRadius: "6px",
            border: `1px solid ${hasKey ? "var(--success)" : "var(--border)"}`,
            background: hasKey ? "rgba(46,160,67,0.08)" : open ? "rgba(88,166,255,0.08)" : "transparent",
            color: hasKey ? "var(--success)" : open ? "var(--accent)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "11px",
            transition: "all 0.15s",
          }}
        >
          <Settings size={12} style={{ transition: "transform 0.3s", transform: open ? "rotate(90deg)" : "none" }} />
          {hasKey ? "BYO Key ✓" : "Advanced"}
          {hasKey && (
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--success)",
                display: "inline-block",
              }}
            />
          )}
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: "10px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {/* API Key Section */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <Key size={12} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>OpenRouter API Key</span>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  fontSize: "10px",
                  color: "var(--muted)",
                  textDecoration: "none",
                }}
              >
                Get a free key <ExternalLink size={9} />
              </a>
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 8px 0", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 6px 0" }}>
                <strong style={{ color: "var(--text)" }}>Why?</strong> Yoke's AI analysis uses{" "}
                <a
                  href="https://openrouter.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  OpenRouter
                </a>{" "}
                to access models like DeepSeek, Claude, GPT-4o, and Gemini. Without a key, you get 10 analyses/hr on our
                shared key. With your own, you get unlimited access, model selection, and prompt editing.
              </p>
              <p style={{ margin: "0" }}>
                <strong style={{ color: "var(--text)" }}>Privacy:</strong> Your key is stored in your browser's
                localStorage and sent to Yoke's server when you request an AI analysis. We don't log or store your key —
                it's used only for that single API call to OpenRouter and then discarded.{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  Privacy policy →
                </a>
              </p>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type={showKey ? "text" : "password"}
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleKeySave();
                  }}
                  placeholder="sk-or-v1-..."
                  style={{
                    width: "100%",
                    padding: "7px 32px 7px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: "12px",
                    outline: "none",
                    fontFamily: "monospace",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? "Hide key" : "Show key"}
                  style={{
                    position: "absolute",
                    right: "6px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--muted)",
                    padding: "2px",
                    display: "flex",
                  }}
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleKeySave}
                style={{
                  padding: "7px 14px",
                  borderRadius: "6px",
                  border: "1px solid var(--accent)",
                  background: "rgba(88,166,255,0.1)",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {keySaved ? "Saved!" : "Save"}
              </button>
            </div>
            {hasKey && (
              <button
                type="button"
                onClick={handleKeyRemove}
                style={{
                  marginTop: "6px",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  border: "none",
                  background: "transparent",
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontSize: "11px",
                }}
              >
                Remove key
              </button>
            )}
          </div>

          {/* Model Selector */}
          <div style={{ opacity: hasKey ? 1 : 0.45, pointerEvents: hasKey ? "auto" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <Sparkles size={12} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>Model</span>
              {!hasKey && (
                <span style={{ fontSize: "10px", color: "var(--muted)", fontStyle: "italic" }}>requires API key</span>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {AVAILABLE_MODELS.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => handleModelChange(m.id)}
                  disabled={!hasKey}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "6px",
                    border: `1px solid ${model === m.id ? "var(--accent)" : "var(--border)"}`,
                    background: model === m.id ? "rgba(88,166,255,0.12)" : "var(--bg)",
                    color: model === m.id ? "var(--accent)" : "var(--muted)",
                    cursor: hasKey ? "pointer" : "default",
                    fontSize: "11px",
                    fontWeight: model === m.id ? 600 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  {m.label}
                  <span style={{ fontSize: "9px", opacity: 0.6, marginLeft: "4px" }}>{m.provider}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Editor */}
          <div style={{ opacity: hasKey ? 1 : 0.45, pointerEvents: hasKey ? "auto" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <Sparkles size={12} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>Prompt</span>
              {!hasKey && (
                <span style={{ fontSize: "10px", color: "var(--muted)", fontStyle: "italic" }}>requires API key</span>
              )}
              {promptEdited && (
                <span
                  style={{
                    fontSize: "9px",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    background: "rgba(210,153,34,0.15)",
                    color: "var(--warning)",
                  }}
                >
                  edited
                </span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
                {promptEdited && (
                  <button
                    type="button"
                    onClick={handlePromptReset}
                    title="Reset to default"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "10px",
                    }}
                  >
                    <RotateCcw size={9} /> Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePromptCopy}
                  title="Copy prompt"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: "10px",
                  }}
                >
                  {promptCopied ? <Check size={9} /> : <Copy size={9} />}
                  {promptCopied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <p style={{ fontSize: "10px", color: "var(--muted)", margin: "0 0 6px 0", lineHeight: 1.4 }}>
              This is the exact prompt sent to the AI. Edit it to focus the analysis on what matters to you.
            </p>
            {promptLoading ? (
              <div
                style={{
                  height: "200px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  background: "var(--bg)",
                }}
              >
                <Loader2 size={14} style={{ color: "var(--muted)", animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "8px" }}>Loading prompt…</span>
              </div>
            ) : (
              <textarea
                value={promptText}
                onChange={(e) => handlePromptChange(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  height: "240px",
                  padding: "10px",
                  borderRadius: "6px",
                  border: `1px solid ${promptEdited ? "var(--warning)" : "var(--border)"}`,
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: "11px",
                  fontFamily: "'SF Mono', Monaco, Consolas, monospace",
                  lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            )}
          </div>

          {/* Status footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "8px",
              borderTop: "1px solid var(--border)",
              fontSize: "10px",
              color: "var(--muted)",
            }}
          >
            <span>
              {hasKey ? (
                <>
                  Using your key · <span style={{ color: "var(--success)" }}>Unlimited analysis</span>
                </>
              ) : (
                <>Platform key · 10 analyses/hr</>
              )}
            </span>
            <span style={{ opacity: 0.6 }}>
              {hasKey ? AVAILABLE_MODELS.find((m) => m.id === model)?.label || model : "DeepSeek V3"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rate Limit UI ──────────────────────────────────────────────────

function RateLimitView({ data, onKeySet }: { data: RateLimitResponse; onKeySet: (key: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [keyInput, setKeyInput] = useState("");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.diy_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* fallback */
    }
  };

  const handleKeySave = () => {
    const trimmed = keyInput.trim();
    if (trimmed) {
      saveKey(trimmed);
      onKeySet(trimmed);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "14px",
          background: "rgba(210,153,34,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <Zap size={24} style={{ color: "var(--warning)" }} />
      </div>
      <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)", marginBottom: "6px" }}>
        Daily AI limit reached ({data.used}/{data.limit})
      </h3>
      <p style={{ fontSize: "12px", color: "var(--muted)", maxWidth: "440px", lineHeight: 1.6, marginBottom: "20px" }}>
        Yoke is free and open source — we rate-limit AI calls to manage costs, not knowledge.
      </p>

      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "16px",
          marginBottom: "14px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "8px" }}>
          Run it yourself
        </div>
        <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
          Copy the analysis prompt and paste it into ChatGPT, Claude, Gemini, or any AI assistant.
        </p>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            margin: "0 auto",
            padding: "8px 18px",
            borderRadius: "8px",
            border: "1px solid var(--accent)",
            background: "rgba(88,166,255,0.1)",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied!" : "Copy analysis prompt"}
        </button>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            justifyContent: "center",
          }}
        >
          <Key size={14} /> Unlock unlimited analysis
        </div>
        <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
          Enter your own{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
          >
            OpenRouter API key
          </a>{" "}
          — stored locally in your browser.
        </p>
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-or-v1-..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleKeySave();
            }}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: "12px",
              outline: "none",
              fontFamily: "monospace",
            }}
          />
          <button
            type="button"
            onClick={handleKeySave}
            style={{
              padding: "7px 14px",
              borderRadius: "6px",
              border: "1px solid var(--accent)",
              background: "rgba(88,166,255,0.1)",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            Save & retry
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AI Loading Indicator ───────────────────────────────────────────

const ESTIMATED_SECONDS = 45;

const LOADING_PHASES = [
  { at: 0, msg: "Preparing analysis data…" },
  { at: 3, msg: "Sending to AI model…" },
  { at: 6, msg: "Finding cross-signal correlations…" },
  { at: 14, msg: "Synthesizing insights across data points…" },
  { at: 25, msg: "Formatting structured results…" },
  { at: 38, msg: "Still working — complex domains take longer…" },
  { at: 55, msg: "Almost there…" },
];

function AILoadingIndicator() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const progress = Math.min(elapsed / ESTIMATED_SECONDS, 0.95);
  const phase = [...LOADING_PHASES].reverse().find((p) => elapsed >= p.at) || LOADING_PHASES[0];

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Loader2 size={14} style={{ color: "var(--accent)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
        <span style={{ fontSize: "12px", color: "var(--text)" }}>{phase.msg}</span>
        <span
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            marginLeft: "auto",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {elapsed}s
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
      <div style={{ height: "3px", borderRadius: "2px", background: "var(--border)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            borderRadius: "2px",
            background: "var(--accent)",
            width: `${progress * 100}%`,
            transition: "width 1s linear",
          }}
        />
      </div>
      <span style={{ fontSize: "10px", color: "var(--muted)" }}>
        Cross-signal analysis typically takes 30–45s — feel free to explore other tabs while you wait
      </span>
    </div>
  );
}

// ─── Cross-Signal Insights UI ───────────────────────────────────────

function CrossSignalInsightsCard({ insights }: { insights: CrossSignalInsight[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // severityColor and severityIcon imported from ../utils/severity (single source of truth)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {insights.map((insight, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: expandable insight card
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard support handled by parent
        <div
          key={i}
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px",
            cursor: "pointer",
            borderLeftColor: severityColor(insight.severity),
            borderLeftWidth: "3px",
          }}
          onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <span style={{ fontSize: "11px", flexShrink: 0, paddingTop: "1px" }}>{severityIcon(insight.severity)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.5 }}>{insight.insight}</div>
              {(expandedIdx === i || true) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
                  {insight.signals_cited.map((sig, j) => (
                    <span
                      key={j}
                      style={{
                        fontSize: "9px",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        background: "rgba(88,166,255,0.1)",
                        color: "var(--accent)",
                        fontFamily: "monospace",
                      }}
                    >
                      {sig}
                    </span>
                  ))}
                  {insight.actionable && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        background: "rgba(46,160,67,0.1)",
                        color: "var(--success)",
                      }}
                    >
                      actionable
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

// Module-level cache so results survive tab switches
const _insightsCache: Record<string, AIAnalysisResult> = {};
const _metadataCache: Record<string, { analyzed_at: string; cached: boolean }> = {};

// Module-level stream state — survives component unmount/remount during tab switches.
// The fetch reader loop keeps running in the background; when the component remounts
// it picks up the current streaming state and re-subscribes to updates.
interface InFlightStream {
  domain: string;
  loading: boolean;
  isStreaming: boolean;
  streamingText: string;
  streamProgress: number;
  error: string | null;
  // Subscribers: the mounted component registers its state setters here.
  // When unmounted, subscribers is empty and updates go to the cache only.
  subscribers: Set<{
    setLoading: (v: boolean) => void;
    setIsStreaming: (v: boolean) => void;
    setStreamingText: (v: string) => void;
    setStreamProgress: (v: number) => void;
    setError: (v: string | null) => void;
    setInsightsResult: (v: AIAnalysisResult | null) => void;
    setAnalysisMetadata: (v: { analyzed_at: string; cached: boolean } | null) => void;
  }>;
}
const _inFlightStreams: Record<string, InFlightStream> = {};

function notifySubscribers(stream: InFlightStream) {
  for (const sub of stream.subscribers) {
    sub.setLoading(stream.loading);
    sub.setIsStreaming(stream.isStreaming);
    sub.setStreamingText(stream.streamingText);
    sub.setStreamProgress(stream.streamProgress);
    sub.setError(stream.error);
  }
}

export function AIAnalysisPanel({
  domain,
  analysisData,
  streaming,
}: {
  domain: string;
  analysisData?: AnalysisResult;
  streaming?: boolean;
}) {
  // Initialize state from module-level caches and in-flight streams
  const inFlight = _inFlightStreams[domain];
  const [insightsResult, setInsightsResult] = useState<AIAnalysisResult | null>(_insightsCache[domain] || null);
  const [loading, setLoading] = useState(inFlight?.loading || false);
  const [error, setError] = useState<string | null>(inFlight?.error || null);
  const [rateLimited, setRateLimited] = useState<RateLimitResponse | null>(null);
  const [analysisMetadata, setAnalysisMetadata] = useState<{ analyzed_at: string; cached: boolean } | null>(
    _metadataCache[domain] || null,
  );
  const [, setKeyVersion] = useState(0);
  const [selectedModel, setSelectedModel] = useState(getSavedModel);
  const [_prioritiesExpanded, _setPrioritiesExpanded] = useState(false);
  const [streamingText, setStreamingText] = useState(inFlight?.streamingText || "");
  const [isStreaming, setIsStreaming] = useState(inFlight?.isStreaming || false);
  const [streamProgress, setStreamProgress] = useState(inFlight?.streamProgress || 0);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const progressAnimRef = useRef<number | null>(null);
  const lastSignpostRef = useRef(-1);

  // Subscribe to in-flight stream updates on mount, unsubscribe on unmount
  useEffect(() => {
    const sub = {
      setLoading,
      setIsStreaming,
      setStreamingText,
      setStreamProgress,
      setError,
      setInsightsResult,
      setAnalysisMetadata,
    };
    const stream = _inFlightStreams[domain];
    if (stream) {
      stream.subscribers.add(sub);
      // Sync current state on subscribe (in case it changed between render and effect)
      setLoading(stream.loading);
      setIsStreaming(stream.isStreaming);
      setStreamingText(stream.streamingText);
      setError(stream.error);
      // Recalculate progress from streaming text signposts (animation was lost on unmount)
      if (stream.isStreaming && stream.streamingText) {
        const signposts: [string, number][] = [
          ['"summary"', 10],
          ['"posture"', 16],
          ['"key_findings"', 32],
          ['"cross_signal_insights"', 58],
          ['"attack_surface"', 80],
          ['"recommendations"', 92],
        ];
        let progress = stream.streamProgress;
        for (let i = signposts.length - 1; i >= 0; i--) {
          if (stream.streamingText.includes(signposts[i][0])) {
            progress = Math.max(progress, signposts[i][1]);
            lastSignpostRef.current = i;
            break;
          }
        }
        setStreamProgress(progress);
      } else {
        setStreamProgress(stream.streamProgress);
      }
    }
    return () => {
      const s = _inFlightStreams[domain];
      if (s) s.subscribers.delete(sub);
    };
  }, [domain]);

  // Signpost targets — when we see a JSON key, we know where we are
  const SIGNPOSTS: [string, number][] = useMemo(
    () => [
      ['"summary"', 10],
      ['"posture"', 16],
      ['"key_findings"', 32],
      ['"cross_signal_insights"', 58],
      ['"attack_surface"', 80],
      ['"recommendations"', 92],
    ],
    [],
  );

  // Animate progress smoothly between signposts using ease-out cubic
  const startProgressAnimation = useCallback(
    (base: number, target: number, durationMs = 12000) => {
      if (progressAnimRef.current) cancelAnimationFrame(progressAnimRef.current);
      const startTime = performance.now();

      const tick = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        // Ease-out cubic — fast start, slows near target so it never looks stuck
        const eased = 1 - (1 - t) ** 3;
        const current = Math.round(base + (target - base) * eased);
        setStreamProgress(current);
        // Keep module-level stream in sync so remount gets the right value
        const s = _inFlightStreams[domain];
        if (s) s.streamProgress = current;
        if (t < 1) {
          progressAnimRef.current = requestAnimationFrame(tick);
        }
      };
      progressAnimRef.current = requestAnimationFrame(tick);
    },
    [domain],
  );

  // When streaming text updates, check for signposts and advance animation
  const updateProgressFromText = useCallback(
    (text: string) => {
      let hitIdx = -1;
      for (let i = SIGNPOSTS.length - 1; i >= 0; i--) {
        if (text.includes(SIGNPOSTS[i][0])) {
          hitIdx = i;
          break;
        }
      }
      if (hitIdx > lastSignpostRef.current) {
        lastSignpostRef.current = hitIdx;
        const reached = SIGNPOSTS[hitIdx][1];
        const nextTarget = hitIdx < SIGNPOSTS.length - 1 ? SIGNPOSTS[hitIdx + 1][1] : 98;
        // Animate from the reached signpost toward the next one
        startProgressAnimation(reached, nextTarget, 12000);
      }
    },
    [SIGNPOSTS, startProgressAnimation],
  );

  // Clean up animation on unmount
  useEffect(() => {
    return () => {
      if (progressAnimRef.current) cancelAnimationFrame(progressAnimRef.current);
    };
  }, []);

  // Auto-scroll streaming container to bottom as new text arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamingText is an intentional trigger to re-scroll on each text update
  useEffect(() => {
    if (streamContainerRef.current && isStreaming) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
    }
  }, [isStreaming, streamingText]);

  const generateInsights = useCallback(async () => {
    if (insightsResult) return;
    if (loading) return;
    // Don't start a new stream if one is already in flight for this domain
    if (_inFlightStreams[domain]) return;

    setLoading(true);
    setError(null);
    setStreamingText("");
    setIsStreaming(false);
    setStreamProgress(0);

    // Register in-flight stream at module level
    const sub = {
      setLoading,
      setIsStreaming,
      setStreamingText,
      setStreamProgress,
      setError,
      setInsightsResult,
      setAnalysisMetadata,
    };
    const stream: InFlightStream = {
      domain,
      loading: true,
      isStreaming: false,
      streamingText: "",
      streamProgress: 0,
      error: null,
      subscribers: new Set([sub]),
    };
    _inFlightStreams[domain] = stream;

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const savedKey = getSavedKey();
      if (savedKey) headers["X-OpenRouter-Key"] = savedKey;

      const bodyObj: Record<string, unknown> = { domain, stream: true };
      if (savedKey && selectedModel) bodyObj.model = selectedModel;

      let res: Response | null = null;
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        res = await fetch("/api/ai-analysis", {
          method: "POST",
          headers,
          body: JSON.stringify(bodyObj),
        });
        if (res.status !== 503) break;
      }
      if (!res) throw new Error("No response from AI API");

      if (res.status === 429) {
        const rl = (await res.json()) as RateLimitResponse;
        if (rl.rate_limited) {
          setRateLimited(rl);
          stream.loading = false;
          notifySubscribers(stream);
          delete _inFlightStreams[domain];
          return;
        }
      }

      // If response is JSON (cached result or error), handle normally
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = (await res.json()) as AIAnalysisResponse;
        if (!res.ok || json.error) {
          stream.error = json.error || `API error ${res.status}`;
          stream.loading = false;
          notifySubscribers(stream);
        } else if (json.result) {
          if (json.result.cross_signal_insights && json.result.cross_signal_insights.length > 0) {
            _insightsCache[domain] = json.result;
            for (const s of stream.subscribers) s.setInsightsResult(json.result);
            if (json.analyzed_at) {
              const meta = { analyzed_at: json.analyzed_at, cached: !!json.cached };
              _metadataCache[domain] = meta;
              for (const s of stream.subscribers) s.setAnalysisMetadata(meta);
            }
          }
          stream.loading = false;
          notifySubscribers(stream);
        }
        delete _inFlightStreams[domain];
        return;
      }

      // SSE streaming response
      if (!res.body) throw new Error("No response body for streaming");

      stream.isStreaming = true;
      stream.streamProgress = 0;
      notifySubscribers(stream);
      lastSignpostRef.current = -1;
      startProgressAnimation(0, 8, 10000);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed?.startsWith("data: ")) continue;

          try {
            const evt = JSON.parse(trimmed.slice(6));
            if (evt.error) {
              stream.error = evt.error;
              stream.loading = false;
              stream.isStreaming = false;
              notifySubscribers(stream);
              delete _inFlightStreams[domain];
              return;
            }
            if (evt.chunk) {
              accumulated += evt.chunk;
              stream.streamingText = accumulated;
              for (const s of stream.subscribers) s.setStreamingText(accumulated);
              updateProgressFromText(accumulated);
            }
            if (evt.done) {
              // Parse the complete JSON
              let jsonStr = accumulated.trim();
              const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (jsonMatch) jsonStr = jsonMatch[1].trim();
              // Handle truncated output: strip opening fence if closing ``` is missing
              else if (jsonStr.startsWith("```")) {
                jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").trim();
              }
              jsonStr = jsonStr.replace(/^\uFEFF/, "").trim();

              // Try direct parse, then salvage truncated JSON
              let parsed: AIAnalysisResult | null = null;
              try {
                parsed = JSON.parse(jsonStr) as AIAnalysisResult;
              } catch {
                // Salvage truncated JSON by closing open structures
                try {
                  let salvaged = jsonStr;
                  const quoteCount = (salvaged.match(/(?<!\\)"/g) || []).length;
                  if (quoteCount % 2 !== 0) salvaged += '"';
                  const openBraces = (salvaged.match(/{/g) || []).length;
                  const closeBraces = (salvaged.match(/}/g) || []).length;
                  const openBrackets = (salvaged.match(/\[/g) || []).length;
                  const closeBrackets = (salvaged.match(/]/g) || []).length;
                  salvaged = salvaged.replace(/,\s*$/, "");
                  for (let i = 0; i < openBrackets - closeBrackets; i++) salvaged += "]";
                  for (let i = 0; i < openBraces - closeBraces; i++) salvaged += "}";
                  parsed = JSON.parse(salvaged) as AIAnalysisResult;
                } catch {
                  /* salvage failed */
                }
              }
              if (parsed?.cross_signal_insights && parsed.cross_signal_insights.length > 0) {
                _insightsCache[domain] = parsed;
                for (const s of stream.subscribers) s.setInsightsResult(parsed);
                const meta = { analyzed_at: new Date().toISOString(), cached: false };
                _metadataCache[domain] = meta;
                for (const s of stream.subscribers) s.setAnalysisMetadata(meta);
              } else if (!parsed) {
                stream.error = "Failed to parse AI response";
                for (const s of stream.subscribers) s.setError(stream.error);
              }
              if (progressAnimRef.current) cancelAnimationFrame(progressAnimRef.current);
              stream.streamProgress = 100;
              stream.streamingText = "";
              stream.isStreaming = false;
              notifySubscribers(stream);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      stream.error = err instanceof Error ? err.message : "Failed to generate analysis";
      for (const s of stream.subscribers) s.setError(stream.error);
    } finally {
      stream.loading = false;
      stream.isStreaming = false;
      notifySubscribers(stream);
      delete _inFlightStreams[domain];
    }
  }, [domain, insightsResult, selectedModel, loading, updateProgressFromText, startProgressAnimation]);

  const handleKeyChange = (key: string) => {
    setKeyVersion((v) => v + 1);
    if (key && rateLimited) {
      setRateLimited(null);
    }
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    setInsightsResult(null);
    setStreamingText("");
    setStreamProgress(0);
    delete _insightsCache[domain];
    delete _inFlightStreams[domain];
  };

  // Rate limited
  if (rateLimited) {
    return <RateLimitView data={rateLimited} onKeySet={handleKeyChange} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Advanced Settings */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <AdvancedSettings domain={domain} onKeyChange={handleKeyChange} onModelChange={handleModelChange} />
      </div>

      {/* 1. Score Breakdown (deterministic) */}
      {analysisData && <ScoreWaterfall data={analysisData} />}

      {/* 2. Cross-Signal Insights (LLM) */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <Sparkles size={14} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
            }}
          >
            Cross-Signal Insights
          </span>
          <span style={{ fontSize: "10px", color: "var(--muted)", marginLeft: "4px" }}>
            — AI-powered correlations across your data
          </span>
        </div>

        {/* Analysis timestamp */}
        {analysisMetadata && insightsResult && (
          <div
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {analysisMetadata.cached ? "Cached" : "Generated"}{" "}
            {new Date(analysisMetadata.analyzed_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        )}

        {/* Loading / Streaming state */}
        {loading && !isStreaming && <AILoadingIndicator />}
        {isStreaming && (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Loader2
                size={14}
                style={{ color: "var(--accent)", animation: "spin 1s linear infinite", flexShrink: 0 }}
              />
              <span style={{ fontSize: "12px", color: "var(--text)" }}>Generating insights…</span>
              <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "auto" }}>{streamProgress}%</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
            <div
              style={{
                height: "3px",
                borderRadius: "2px",
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: "2px",
                  background: "var(--accent)",
                  width: `${streamProgress}%`,
                }}
              />
            </div>
            <div
              ref={streamContainerRef}
              style={{
                maxHeight: "300px",
                overflow: "auto",
                fontFamily: "monospace",
                fontSize: "11px",
                lineHeight: 1.6,
                color: "var(--muted)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: "8px",
                borderRadius: "4px",
                background: "rgba(0,0,0,0.15)",
              }}
            >
              {streamingText}
              <span style={{ opacity: 0.5, animation: "blink 1s step-end infinite" }}>▊</span>
              <style>{`@keyframes blink { 0%,100% { opacity: 0.5 } 50% { opacity: 0 } }`}</style>
            </div>
          </div>
        )}

        {/* Results */}
        {insightsResult?.cross_signal_insights && (
          <CrossSignalInsightsCard insights={insightsResult.cross_signal_insights} />
        )}

        {/* Model attribution */}
        {insightsResult && (
          <span style={{ fontSize: "9px", color: "var(--dim)", fontStyle: "italic" }}>
            Analysis by DeepSeek V3 via{" "}
            <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" style={{ color: "var(--dim)" }}>
              OpenRouter
            </a>
          </span>
        )}

        {/* Error display */}
        {error && (
          <div
            style={{
              background: "rgba(248,81,73,0.1)",
              border: "1px solid rgba(248,81,73,0.3)",
              borderRadius: "8px",
              padding: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <XCircle size={14} style={{ color: "var(--danger)" }} />
            <span style={{ fontSize: "12px", color: "var(--danger)" }}>{error}</span>
            <button
              type="button"
              onClick={() => {
                setInsightsResult(null);
                setStreamingText("");
                setStreamProgress(0);
                delete _insightsCache[domain];
                delete _inFlightStreams[domain];
                generateInsights();
              }}
              style={{
                marginLeft: "auto",
                padding: "4px 10px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: "11px",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Generate button */}
        {!insightsResult && !loading && !error && (
          <div
            style={{
              textAlign: "center",
              padding: "20px",
              background: "var(--card)",
              border: "1px dashed var(--border)",
              borderRadius: "8px",
            }}
          >
            {streaming ? (
              <>
                <Loader2
                  size={20}
                  style={{
                    color: "var(--accent)",
                    opacity: 0.6,
                    margin: "0 auto 8px",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>
                  Waiting for analysis to complete before generating AI insights...
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                  AI finds non-obvious correlations between your signals — things like mismatched DMARC/DKIM configs,
                  SSL/HSTS conflicts, or redundant third-party scripts.
                </p>
                <button
                  type="button"
                  onClick={generateInsights}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "1px solid var(--accent)",
                    background: "rgba(88,166,255,0.1)",
                    color: "var(--accent)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  <Sparkles size={14} />
                  Generate Cross-Signal Insights
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
