import { HelpCircle } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

interface TooltipProps {
  text: string;
  children?: ReactNode;
  /** Show as an inline help icon (?) instead of wrapping children */
  help?: boolean;
}

/**
 * Tooltip with:
 * - Desktop: 200ms hover delay, dismiss on mouse leave
 * - Mobile: tap to toggle, tap-outside or scroll to dismiss
 * - Escape key dismisses
 * - Auto-positions above or below depending on viewport space
 */
export function Tooltip({ text, children, help }: TooltipProps) {
  const [show, setShow] = useState(false);
  const tooltipId = useId();
  const wrapperRef = useRef<HTMLSpanElement | HTMLButtonElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [positionAbove, setPositionAbove] = useState(true);

  // Calculate position on show
  useEffect(() => {
    if (!show || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    // If not enough room above (less than 60px), position below
    setPositionAbove(rect.top > 60);
  }, [show]);

  // Dismiss on scroll
  useEffect(() => {
    if (!show) return;
    const onScroll = () => setShow(false);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [show]);

  // Dismiss on click-outside (mobile tap-away)
  useEffect(() => {
    if (!show) return;
    const onClick = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    // Small delay to avoid capturing the tap that just opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onClick);
      document.addEventListener("touchstart", onClick);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("touchstart", onClick);
    };
  }, [show]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && show) {
        setShow(false);
        e.stopPropagation();
      }
    },
    [show],
  );

  const hoverEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => setShow(true), 200);
  }, []);

  const hoverLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setShow(false);
  }, []);

  // Tap toggle for mobile
  const handleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Only toggle on actual taps (not hover-triggered clicks)
    if ("touches" in e || window.matchMedia("(hover: none)").matches) {
      e.preventDefault();
      e.stopPropagation();
      setShow((prev) => !prev);
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const posStyle = positionAbove
    ? { bottom: "calc(100% + 6px)" as const, top: undefined }
    : { top: "calc(100% + 6px)" as const, bottom: undefined };

  const tooltipPopup = (
    <span
      id={tooltipId}
      role="tooltip"
      className="tooltip-popup"
      style={{
        position: "absolute",
        ...posStyle,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--card-bg, #1c2028)",
        border: "1px solid var(--border, #30363d)",
        borderRadius: "6px",
        padding: "6px 10px",
        fontSize: "11px",
        fontFamily: "var(--font-ui)",
        color: "var(--text-secondary, #adbac7)",
        whiteSpace: "normal",
        width: "max-content",
        maxWidth: "280px",
        zIndex: 1000,
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        lineHeight: 1.4,
        pointerEvents: "none",
      }}
    >
      {text}
    </span>
  );

  if (help) {
    return (
      <button
        type="button"
        className="tooltip-wrapper"
        ref={wrapperRef as React.RefObject<HTMLButtonElement>}
        onMouseEnter={hoverEnter}
        onMouseLeave={hoverLeave}
        onClick={handleTap}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onKeyDown={handleKeyDown}
        aria-describedby={show ? tooltipId : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          cursor: "help",
          position: "relative",
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "inherit",
        }}
      >
        <HelpCircle size={11} style={{ color: "var(--dim)", opacity: 0.6 }} aria-hidden="true" />
        {show && tooltipPopup}
      </button>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: tooltip wrapper uses hover/focus to show tooltip, not for primary interaction
    <span
      className="tooltip-wrapper"
      ref={wrapperRef as React.RefObject<HTMLSpanElement>}
      onMouseEnter={hoverEnter}
      onMouseLeave={hoverLeave}
      onClick={handleTap}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      onKeyDown={handleKeyDown}
      aria-describedby={show ? tooltipId : undefined}
      style={{ display: "inline-flex", alignItems: "center", position: "relative" }}
    >
      {children}
      {show && tooltipPopup}
    </span>
  );
}
