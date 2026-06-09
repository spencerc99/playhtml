// ABOUTME: Small live readout of how many distinct people are currently active
// ABOUTME: in the event stream. Renders nothing until the stream connects.

import React from "react";

interface LiveIndicatorProps {
  /** WebSocket open. */
  connected: boolean;
  /** Distinct people (participants) currently active in the event stream. */
  peopleCount: number;
  /** Distinct timezones among active people (optional — appends a stat). */
  timezones?: number;
  /** Distinct continents among active people (optional — appends a stat). */
  continents?: number;
  style?: React.CSSProperties;
}

const TEAL = "#4a9a8a";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function LiveIndicator({
  connected,
  peopleCount,
  timezones,
  continents,
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

  // Append the geographic spread when there's something to show.
  const parts = [label];
  if (timezones && timezones > 1) parts.push(plural(timezones, "timezone"));
  if (continents && continents > 1) parts.push(plural(continents, "continent"));
  label = parts.join(" · ");

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
