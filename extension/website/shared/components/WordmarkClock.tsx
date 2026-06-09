// ABOUTME: Live current date + time rendered in the "we were online" wordmark
// ABOUTME: style (Source Serif italic). Ticks every second.

import React, { useEffect, useState } from "react";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
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
      {dateFmt.format(now)} · {timeFmt.format(now)}
    </span>
  );
}
