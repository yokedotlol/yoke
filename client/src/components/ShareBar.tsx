import { FileDown, Link2, Share2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { Axis, AxisScoreData } from "../api";

// ─── Base64url encoding ──────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let b64 = "";
  const len = bytes.length;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    b64 += chars[(triplet >> 18) & 0x3f];
    b64 += chars[(triplet >> 12) & 0x3f];
    b64 += i + 1 < len ? chars[(triplet >> 6) & 0x3f] : "";
    b64 += i + 2 < len ? chars[triplet & 0x3f] : "";
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── Share payload builder ───────────────────────────────────────────

const AXIS_ORDER: Axis[] = ["security", "foundations", "reputation", "speed", "discoverability", "email"];

function buildPayload(
  domain: string,
  composite: number,
  tier: string,
  axes: Record<Axis, AxisScoreData>,
  analyzedAt: string,
): string {
  const axisScores = AXIS_ORDER.map((a) => axes[a]?.score ?? 0);
  const ts = Math.floor(new Date(analyzedAt).getTime() / 1000);
  const obj = { d: domain, s: composite, g: tier, a: axisScores, t: ts };
  const json = JSON.stringify(obj);
  return base64urlEncode(new TextEncoder().encode(json));
}

async function getSignedUrl(payload: string, origin: string): Promise<string> {
  const resp = await fetch(`${origin}/api/share-sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  if (!resp.ok) throw new Error("Failed to sign share payload");
  const data = (await resp.json()) as { signature: string };
  return `${origin}/r/${payload}.${data.signature}`;
}

// ─── Component ───────────────────────────────────────────────────────

interface ShareBarProps {
  domain: string;
  composite?: number;
  tier?: string;
  axes?: Record<Axis, AxisScoreData>;
  analyzedAt?: string;
  pdfUrl?: string;
}

export function ShareBar({ domain, composite, tier, axes, analyzedAt, pdfUrl }: ShareBarProps) {
  const [copied, setCopied] = useState(false);
  const signedUrlRef = useRef<string | null>(null);
  const signingRef = useRef<Promise<string> | null>(null);

  // Check if we have score data for rich share URLs
  const hasScoreData = composite != null && tier && axes && analyzedAt;

  const getShareUrl = useCallback(async (): Promise<string> => {
    if (signedUrlRef.current) return signedUrlRef.current;

    if (!hasScoreData) {
      return `${window.location.origin}/${domain}`;
    }

    // Deduplicate concurrent sign requests
    if (!signingRef.current) {
      // biome-ignore lint/style/noNonNullAssertion: hasScoreData guard ensures these are defined
      const payload = buildPayload(domain, composite!, tier!, axes!, analyzedAt!);
      signingRef.current = getSignedUrl(payload, window.location.origin)
        .then((url) => {
          signedUrlRef.current = url;
          return url;
        })
        .catch(() => {
          signingRef.current = null;
          return `${window.location.origin}/${domain}`;
        });
    }
    return signingRef.current;
  }, [domain, composite, tier, axes, analyzedAt, hasScoreData]);

  const copyLink = useCallback(async () => {
    const url = await getShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [getShareUrl]);

  const shareToX = useCallback(async () => {
    const url = await getShareUrl();
    const text = `Domain intelligence report for ${domain}`;
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer,width=550,height=420",
    );
  }, [domain, getShareUrl]);

  const shareToLinkedIn = useCallback(async () => {
    const url = await getShareUrl();
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer,width=600,height=500",
    );
  }, [getShareUrl]);

  const shareToReddit = useCallback(async () => {
    const url = await getShareUrl();
    const title = `${domain} — Domain Intelligence Report`;
    window.open(
      `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [domain, getShareUrl]);

  const nativeShare = useCallback(async () => {
    if (navigator.share) {
      const url = await getShareUrl();
      try {
        await navigator.share({
          title: `${domain} — Yoke`,
          text: `Domain intelligence report for ${domain}`,
          url,
        });
      } catch {
        // User cancelled or share failed — ignore
      }
    }
  }, [domain, getShareUrl]);

  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className="share-bar">
      <button type="button" className="share-btn share-copy" onClick={copyLink} aria-label="Copy permalink">
        <Link2 size={12} aria-hidden="true" />
        <span>{copied ? "Copied!" : "Copy link"}</span>
      </button>

      {pdfUrl && (
        <button
          type="button"
          className="share-btn"
          onClick={() => window.open(pdfUrl, "_blank")}
          aria-label="Download PDF report"
        >
          <FileDown size={12} aria-hidden="true" />
          <span>PDF</span>
        </button>
      )}

      <button type="button" className="share-btn" onClick={shareToX} aria-label="Share on X">
        <XIcon />
        <span className="share-label-wide">Share</span>
      </button>

      <button type="button" className="share-btn" onClick={shareToLinkedIn} aria-label="Share on LinkedIn">
        <LinkedInIcon />
        <span className="share-label-wide">Share</span>
      </button>

      <button type="button" className="share-btn" onClick={shareToReddit} aria-label="Share on Reddit">
        <RedditIcon />
        <span className="share-label-wide">Share</span>
      </button>

      {hasNativeShare && (
        <button type="button" className="share-btn" onClick={nativeShare} aria-label="Share via system dialog">
          <Share2 size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* Tiny inline SVG icons for social platforms */
function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
    </svg>
  );
}
