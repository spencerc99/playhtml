// ABOUTME: Hairline viewport-frame band showing where the sheet's viewport sat on the page, plus a scroll-history track.
// ABOUTME: Shares the scroll timeline extraction with PagePlate so the band and page always agree on scroll position.
import { useMemo } from "react";
import type { PlateProps } from "../types";
import { resolveInk } from "./ink";
import { buildScrollTimeline, scrollRangeOf, scrollYAt, sheetLocalTs } from "./scrollTimeline";

export function ScrollPlate({ sheet, frame, t, settings }: PlateProps) {
  const timeline = useMemo(
    () => buildScrollTimeline(sheet.viewportEvents),
    [sheet.viewportEvents],
  );
  const scrollRange = useMemo(() => scrollRangeOf(timeline), [timeline]);
  const ink = useMemo(
    () => resolveInk(sheet, settings),
    [sheet, settings.inkMode, settings.monoColor],
  );

  if (timeline.length === 0) return null;

  const pageMultiplier = 2 + scrollRange * 4;
  const bandHeight = frame.height / pageMultiplier;
  const currentTs = sheetLocalTs(sheet.startTs, sheet.endTs, t);
  const scrollY = scrollYAt(timeline, currentTs);
  const bandY = scrollY * Math.max(0, frame.height - bandHeight);

  return (
    <svg
      width={frame.width}
      height={frame.height}
      style={{
        position: "absolute",
        inset: 0,
        mixBlendMode: settings.blendMode,
        pointerEvents: "none",
      }}
    >
      {/* Scroll-history track: a tick per recorded sample along the left edge,
          so the static (unfanned) view still shows the shape of scroll history. */}
      {timeline.map((point, i) => (
        <line
          key={i}
          x1={0}
          x2={5}
          y1={point.scrollY * frame.height}
          y2={point.scrollY * frame.height}
          stroke={ink}
          strokeWidth={1.5}
          opacity={0.25}
        />
      ))}
      <rect
        x={0}
        y={bandY}
        width={frame.width}
        height={bandHeight}
        fill={ink}
        fillOpacity={0.04}
        stroke={ink}
        strokeOpacity={settings.scrollFrameOpacity}
        strokeWidth={1}
      />
    </svg>
  );
}
