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
  const travel = Math.max(0, frame.height - bandHeight);
  const currentTs = sheetLocalTs(sheet.startTs, sheet.endTs, t);
  const scrollY = scrollYAt(timeline, currentTs);
  const bandY = scrollY * travel;

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
          so the static (unfanned) view still shows the shape of scroll history.
          Off by default — stacked across several sheets these ticks pile into
          barcode-like noise on the left edge, very prominent when fanned.
          Mapped through the same `travel` range as the band itself, offset by
          half the band height so a tick at a given scrollY lines up with the
          band's CENTER when the band sits at that same scrollY — using
          `point.scrollY * frame.height` directly (matching bandY's old
          formula) would put the tick at the band's top edge instead. */}
      {settings.showScrollHistory
        ? timeline.map((point, i) => (
            <line
              key={i}
              x1={0}
              x2={5}
              y1={point.scrollY * travel + bandHeight / 2}
              y2={point.scrollY * travel + bandHeight / 2}
              stroke={ink}
              strokeWidth={1.5}
              opacity={0.15}
            />
          ))
        : null}
      <rect
        x={0}
        y={bandY}
        width={frame.width}
        height={bandHeight}
        fill={ink}
        fillOpacity={0.03}
        stroke={ink}
        strokeOpacity={settings.scrollFrameOpacity}
        strokeWidth={1}
      />
    </svg>
  );
}
