import { SearchX } from "lucide-react";
import { RegisterLinks } from "./RegisterLinks";

/**
 * NXDOMAIN result view.
 *
 * When a domain doesn't exist, no analysis check produces data, so this is the
 * ONLY thing rendered for the result — there are no tabs, panels, score, or
 * share/curl bars (see the short-circuit in App.tsx). It is therefore designed
 * as a deliberate, centered empty-state / "finished answer" view, mirroring the
 * site's landing empty-state (centered icon chip + headline + subline) rather
 * than as an alert strip pinned atop content.
 *
 * Theme safety: every color comes from a semantic design token (--warning,
 * --warning-subtle, --surface, --border, --text, --dim, --bg). No hardcoded
 * colors and no hand-rolled color-mix — the warning tokens are defined for all
 * 12 themes, so the wash/accent track each theme automatically.
 */
export function NotRegisteredBanner({ domain }: { domain?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
      role="status"
      aria-live="polite"
      style={{ fontFamily: "var(--font-ui)" }}
    >
      {/* Icon chip — same w-16 h-16 rounded-xl motif as the landing empty-state,
          tinted with the warning token so it reads as "not found" not "error". */}
      <div
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-xl"
        style={{
          background: "var(--warning-subtle)",
          border: "1px solid var(--warning)",
        }}
      >
        <SearchX size={30} style={{ color: "var(--warning)" }} aria-hidden="true" />
      </div>

      {/* Status pill — small, calm label that makes the verdict unmissable. */}
      <span
        className="mb-3 inline-flex items-center rounded-full px-3 py-1"
        style={{
          background: "var(--warning-subtle)",
          color: "var(--warning)",
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        NXDOMAIN
      </span>

      {/* Headline — neutral --text (not the warning color) so it reads as an
          authoritative finished answer, with the warning reserved for the
          icon + pill accents. */}
      <h2
        style={{
          color: "var(--text)",
          fontWeight: 700,
          fontSize: "var(--text-2xl)",
          lineHeight: "var(--text-2xl--line-height)",
          margin: 0,
        }}
      >
        Not Registered
      </h2>

      {/* Subline — names the domain and explains the verdict. */}
      <p
        style={{
          color: "var(--dim)",
          fontSize: "var(--text-base)",
          lineHeight: "var(--text-base--line-height)",
          maxWidth: "440px",
          marginTop: "0.5rem",
          marginBottom: 0,
        }}
      >
        {domain ? (
          <>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{domain}</span> doesn't exist. DNS returned
            NXDOMAIN, so no such domain is registered — it may be available to register.
          </>
        ) : (
          <>DNS returned NXDOMAIN — no such domain exists. It may be available to register.</>
        )}
      </p>

      {/* Register affordance — reuses the same neutral, theme-token-based links
          from the Explore tab. These are otherwise unreachable for NXDOMAIN
          because all tabs are hidden. Plain links, not affiliate. */}
      {domain && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <span
            style={{
              color: "var(--dim)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Check availability
          </span>
          <RegisterLinks domain={domain} />
        </div>
      )}
    </div>
  );
}
