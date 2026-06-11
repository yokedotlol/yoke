import { ExternalLink } from "lucide-react";

export function RegisterLinks({ domain }: { domain: string }) {
  const nc = `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`;
  const pb = `https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}`;
  const cf = `https://dash.cloudflare.com/?to=/:account/domains/register/${encodeURIComponent(domain)}`;
  return (
    <span className="flex gap-1.5 items-center" style={{ fontSize: "11px" }}>
      <a
        href={nc}
        target="_blank"
        rel="noopener noreferrer"
        className="suggestion-register-link"
        title="Register on Namecheap"
      >
        Namecheap <ExternalLink size={9} style={{ display: "inline", verticalAlign: "-1px" }} />
      </a>
      <span style={{ color: "var(--dim)" }}>·</span>
      <a
        href={pb}
        target="_blank"
        rel="noopener noreferrer"
        className="suggestion-register-link"
        title="Register on Porkbun"
      >
        Porkbun <ExternalLink size={9} style={{ display: "inline", verticalAlign: "-1px" }} />
      </a>
      <span style={{ color: "var(--dim)" }}>·</span>
      <a
        href={cf}
        target="_blank"
        rel="noopener noreferrer"
        className="suggestion-register-link"
        title="Register on Cloudflare (at cost)"
      >
        CF <ExternalLink size={9} style={{ display: "inline", verticalAlign: "-1px" }} />
      </a>
    </span>
  );
}
