import { useCallback, useEffect, useRef, useState } from "react";

type Theme =
  | "dark"
  | "light"
  | "arcade"
  | "deep-blue"
  | "enterprise"
  | "newsprint"
  | "lcars"
  | "synthwave"
  | "botanical"
  | "slate"
  | "rose"
  | "high-contrast";

const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "arcade", label: "Arcade" },
  { id: "deep-blue", label: "Deep Blue" },
  { id: "enterprise", label: "Enterprise" },
  { id: "newsprint", label: "Newsprint" },
  { id: "lcars", label: "LCARS" },
  { id: "synthwave", label: "Synthwave" },
  { id: "botanical", label: "Botanical" },
  { id: "slate", label: "Slate" },
  { id: "rose", label: "Rosé" },
  { id: "high-contrast", label: "High Contrast" },
];

const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));
const STORAGE_KEY = "yoke-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_THEMES.has(stored)) return stored as Theme;
  } catch {
    /* localStorage blocked (e.g. iframe/extension context) */
  }
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus the active theme item when dropdown opens
  useEffect(() => {
    if (open) {
      const idx = THEMES.findIndex((t) => t.id === theme);
      setFocusIdx(idx);
      requestAnimationFrame(() => {
        itemRefs.current[idx]?.focus();
      });
    }
  }, [open, theme]);

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  const select = useCallback((id: Theme) => {
    setTheme(id);
    applyTheme(id);
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  const handleToggleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      } else if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open) {
        e.preventDefault();
        setOpen(true);
      }
    },
    [open],
  );

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = (focusIdx + 1) % THEMES.length;
          setFocusIdx(next);
          itemRefs.current[next]?.focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = (focusIdx - 1 + THEMES.length) % THEMES.length;
          setFocusIdx(prev);
          itemRefs.current[prev]?.focus();
          break;
        }
        case "Home": {
          e.preventDefault();
          setFocusIdx(0);
          itemRefs.current[0]?.focus();
          break;
        }
        case "End": {
          e.preventDefault();
          const last = THEMES.length - 1;
          setFocusIdx(last);
          itemRefs.current[last]?.focus();
          break;
        }
        case "Escape": {
          e.preventDefault();
          setOpen(false);
          toggleRef.current?.focus();
          break;
        }
        case "Tab": {
          setOpen(false);
          break;
        }
      }
    },
    [focusIdx],
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        onKeyDown={handleToggleKeyDown}
        className="theme-toggle"
        title="Change theme"
        aria-label="Change theme"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {current.label}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme selection"
          onKeyDown={handleMenuKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: "160px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "4px",
            zIndex: 999,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {THEMES.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === theme}
              onClick={() => select(t.id)}
              tabIndex={i === focusIdx ? 0 : -1}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "8px 10px",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: t.id === theme ? "var(--accent-subtle)" : "transparent",
                color: t.id === theme ? "var(--accent)" : "var(--text)",
                fontFamily: "var(--font-ui)",
                fontSize: "13px",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                if (t.id !== theme) e.currentTarget.style.background = "var(--surface-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = t.id === theme ? "var(--accent-subtle)" : "transparent";
              }}
            >
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
