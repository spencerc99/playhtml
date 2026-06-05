// ABOUTME: Small live readout of how many distinct people are currently being
// ABOUTME: drawn in the portrait. Renders nothing until the stream connects.

import React from "react";

interface LiveIndicatorProps {
  /** WebSocket open. */
  connected: boolean;
  /** Distinct people (participants) currently drawn in the portrait. */
  peopleCount: number;
  style?: React.CSSProperties;
}

const TEAL = "#4a9a8a";

export function LiveIndicator({
  connected,
  peopleCount,
  style,
}: LiveIndicatorProps) {
  // `peopleCount` is recomputed upstream on every event batch, so this stays
  // current without a self-timer — re-renders come from the parent prop change.

  // Render nothing until the stream is connected — no "connecting" placeholder.
  if (!connected) return null;

  let label: string;
  if (peopleCount <= 0) {
    label = "no one browsing";
  } else if (peopleCount === 1) {
    label = "1 person browsing";
  } else {
    label = `${peopleCount} people browsing`;
  }

  return (
    <span
      style={{
        fontFamily: "'Martian Mono', ui-monospace, monospace",
        fontSize: "11px",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: TEAL,
        pointerEvents: "none",
        userSelect: "none",
        ...style,
      }}
    >
      {label}
    </span>
  );
}
