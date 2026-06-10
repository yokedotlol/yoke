import { SearchX } from "lucide-react";

export function NotRegisteredBanner({ domain }: { domain?: string }) {
  return (
    <div
      className="flex items-start gap-4 rounded-xl px-6 py-5"
      role="alert"
      style={{
        background: "color-mix(in srgb, var(--warning) 12%, var(--surface))",
        border: "2px solid color-mix(in srgb, var(--warning) 55%, transparent)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <SearchX size={40} style={{ color: "var(--warning)", flexShrink: 0, marginTop: "2px" }} aria-hidden="true" />
      <div className="space-y-1">
        <div
          style={{
            color: "var(--warning)",
            fontWeight: 700,
            fontSize: "var(--text-3xl)",
            lineHeight: "var(--text-3xl--line-height)",
          }}
        >
          Not Registered
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-base)", margin: 0 }}>
          {domain ? (
            <>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{domain}</span> doesn't exist — DNS returned
              NXDOMAIN, so no such domain is registered. It may be available to register.
            </>
          ) : (
            <>DNS returned NXDOMAIN — no such domain exists. It may be available to register.</>
          )}
        </p>
      </div>
    </div>
  );
}
