// ABOUTME: Live current date + time in UTC, rendered in the "we were online"
// ABOUTME: wordmark style (Source Serif italic). UTC is the one clock every
// ABOUTME: contributor shares, so it anchors the collective portrait regardless
// ABOUTME: of the viewer's timezone. Ticks every second.

import React, { useEffect, useState } from "react";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  weekday: "long",
  month: "long",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function WordmarkClock({ style }: { style?: React.CSSProperties }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <span
      style={{
        fontFamily: "'Source Serif 4', 'Lora', Georgia, serif",
        fontStyle: "italic",
        fontWeight: 200,
        fontSize: "18px",
        letterSpacing: "-0.01em",
        color: "#3d3833",
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dateFmt.format(now)} · {timeFmt.format(now)} UTC
    </span>
  );
}
