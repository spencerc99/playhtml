// ABOUTME: React component for the milestone toast rendered inside a shadow root.
// ABOUTME: Used by the content script (injected), the setup page, and the preview page.

import React, { useEffect, useRef, useState } from "react";

export type MilestoneToastType =
  | "cursorDistance"
  | "screenTime"
  | "sitesExplored"
  | "domainVisits";

export type MilestoneCtaAction = "TOGGLE_HISTORICAL_OVERLAY" | "OPEN_PORTRAIT";

export interface MilestoneToastData {
  type: MilestoneToastType;
  displayValue: string;
  copy: string;
  ctaLabel: string;
  ctaAction: MilestoneCtaAction;
  period: "today" | "alltime";
  domain?: string;
  faviconUrl?: string;
  sparkline?: number[];
}

interface Props {
  milestone: MilestoneToastData;
  onCta?: (action: MilestoneCtaAction) => void;
  onDismiss?: () => void;
  /** If true, skip the entrance animation and stay visible (for static previews). */
  static?: boolean;
  /** Auto-dismiss after this many ms. Disabled when 0 or undefined. */
  autoHideMs?: number;
}

const CURSOR_PATH_1 = "m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z";
const CURSOR_PATH_2 = "m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z";

function CursorGhost({ cls }: { cls: string }) {
  return (
    <svg
      className={`wwo-cursor-svg ${cls}`}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={CURSOR_PATH_1} fill="#4a9a8a" />
      <path d={CURSOR_PATH_2} fill="#4a9a8a" />
    </svg>
  );
}

function Accent({ milestone }: { milestone: MilestoneToastData }) {
  if (milestone.type === "cursorDistance") {
    return (
      <>
        <div className="wwo-cursor-trail">
          <CursorGhost cls="wwo-c3" />
          <CursorGhost cls="wwo-c2" />
          <CursorGhost cls="wwo-c1" />
          <CursorGhost cls="wwo-c0" />
        </div>
        <div className="wwo-toast-stat">
          {milestone.displayValue.replace(" mi", "")}
        </div>
        <div className="wwo-toast-unit">miles</div>
      </>
    );
  }

  if (milestone.type === "screenTime") {
    const parts = milestone.displayValue.split(" ");
    const sparkline = milestone.sparkline ?? Array(7).fill(0.5);
    return (
      <>
        <div className="wwo-toast-stat wwo-toast-stat-sm">
          {parts.length === 2 ? (
            <>
              {parts[0]}
              <br />
              {parts[1]}
            </>
          ) : (
            milestone.displayValue
          )}
        </div>
        <div className="wwo-sparkline">
          {sparkline.map((v, i) => {
            const height = Math.max(Math.round(v * 100), 5);
            const isCurrent = i === 6;
            return (
              <div
                key={i}
                className={`wwo-spark-bar${isCurrent ? " wwo-current" : ""}`}
                style={{ height: `${height}%` }}
              />
            );
          })}
        </div>
      </>
    );
  }

  if (milestone.type === "sitesExplored") {
    const dots = [
      { top: 1, left: 5, size: 3, opacity: 0.35 },
      { top: 6, left: 22, size: 4, opacity: 0.65 },
      { top: 14, left: 8, size: 3, opacity: 0.45 },
      { top: 2, left: 33, size: 5, opacity: 0.85 },
      { top: 18, left: 30, size: 3, opacity: 0.4 },
      { top: 9, left: 16, size: 3, opacity: 0.55 },
    ];
    return (
      <>
        <div className="wwo-toast-stat">{milestone.displayValue}</div>
        <div className="wwo-toast-unit">domains</div>
        <div className="wwo-scatter">
          {dots.map((d, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: `${d.top}px`,
                left: `${d.left}px`,
                width: `${d.size}px`,
                height: `${d.size}px`,
                borderRadius: "50%",
                background: "#4a9a8a",
                opacity: d.opacity,
              }}
            />
          ))}
        </div>
      </>
    );
  }

  return <DomainAccent milestone={milestone} />;
}

function DomainAccent({ milestone }: { milestone: MilestoneToastData }) {
  // Try the stored favicon first; on failure fall back to Google's S2 favicon
  // service (Chrome uses the same source); if even that fails, show the letter.
  const domain = milestone.domain ?? "";
  const s2Url = domain
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
        domain,
      )}&sz=64`
    : "";
  const primary = milestone.faviconUrl || s2Url;
  const [stage, setStage] = useState<"primary" | "s2" | "letter">(
    primary ? "primary" : "letter",
  );
  const initial = (domain || "?")[0].toUpperCase();

  const handleError = () => {
    if (stage === "primary" && milestone.faviconUrl && s2Url) {
      setStage("s2");
      return;
    }
    setStage("letter");
  };

  const src = stage === "primary" ? primary : stage === "s2" ? s2Url : "";

  return (
    <>
      <div className="wwo-favicon-wrap">
        {stage !== "letter" && src ? (
          <img
            className="wwo-favicon-img"
            src={src}
            alt=""
            onError={handleError}
          />
        ) : (
          <span className="wwo-favicon-fallback">{initial}</span>
        )}
      </div>
      <div className="wwo-toast-stat" style={{ marginTop: 5 }}>
        {milestone.displayValue}
      </div>
    </>
  );
}

export function MilestoneToast({
  milestone,
  onCta,
  onDismiss,
  static: isStatic,
  autoHideMs,
}: Props) {
  const [visible, setVisible] = useState(!!isStatic);
  const [hiding, setHiding] = useState(false);
  const toastRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStatic) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isStatic]);

  const dismiss = () => {
    if (isStatic) {
      onDismiss?.();
      return;
    }
    setVisible(false);
    setHiding(true);
    setTimeout(() => onDismiss?.(), 400);
  };

  useEffect(() => {
    if (!autoHideMs || isStatic) return;
    const t = setTimeout(dismiss, autoHideMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoHideMs, isStatic]);

  const handleCta = () => {
    onCta?.(milestone.ctaAction);
    dismiss();
  };

  const badgeClass =
    milestone.period === "today" ? "wwo-today" : "wwo-alltime";
  const badgeLabel = milestone.period === "today" ? "today" : "all time";

  const cls = [
    "wwo-milestone-toast",
    visible ? "wwo-visible" : "",
    hiding ? "wwo-hiding" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={toastRef} className={cls}>
      <div className="wwo-toast-wordmark">wwo</div>
      <div className="wwo-toast-body">
        <div className="wwo-toast-accent">
          <Accent milestone={milestone} />
        </div>
        <div className="wwo-toast-text">
          <div className={`wwo-toast-badge ${badgeClass}`}>{badgeLabel}</div>
          <p className="wwo-toast-headline">{milestone.copy}</p>
          <button className="wwo-toast-cta" onClick={handleCta}>
            {milestone.ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
