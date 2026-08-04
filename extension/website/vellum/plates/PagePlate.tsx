// ABOUTME: Ghosted page render for one sheet — a large faint domain/title fallback beneath a scaled, scroll-driven iframe.
// ABOUTME: Adapts PagePreview's iframe-scaling technique; only sheets within maxPageLayers get a live iframe.
import { useMemo } from "react";
import type { PlateProps } from "../types";
import { buildScrollTimeline, scrollRangeOf, scrollYAt, sheetLocalTs } from "./scrollTimeline";

const RENDER_WIDTH = 1280;

export function PagePlate({ sheet, frame, t, settings, isEligibleForIframe }: PlateProps) {
  const timeline = useMemo(
    () => buildScrollTimeline(sheet.viewportEvents),
    [sheet.viewportEvents],
  );
  const scrollRange = useMemo(() => scrollRangeOf(timeline), [timeline]);

  const scale = frame.width / RENDER_WIDTH;
  const renderHeight = frame.height / scale;
  const pageHeight = renderHeight * (2 + scrollRange * 4);

  const currentTs = sheetLocalTs(sheet.startTs, sheet.endTs, t);
  const scrollY = scrollYAt(timeline, currentTs);
  const translateY = scrollY * (pageHeight - renderHeight);

  const filter = settings.pageGrayscale ? "grayscale(1) contrast(0.92)" : "none";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        opacity: settings.pageOpacity,
        filter,
        pointerEvents: "none",
      }}
    >
      {settings.showGhostTitles ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "6% 8%",
            mixBlendMode: settings.blendMode,
            color: "rgba(61,56,51,0.28)",
          }}
        >
          <div
            style={{
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 300,
              fontSize: "34px",
              lineHeight: 1.1,
            }}
          >
            {sheet.domain}
          </div>
          {sheet.title ? (
            <div
              style={{
                fontFamily: "'Lora', Georgia, serif",
                fontSize: "16px",
                marginTop: "6px",
              }}
            >
              {sheet.title}
            </div>
          ) : null}
        </div>
      ) : null}
      {isEligibleForIframe && sheet.url ? (
        <iframe
          src={sheet.url}
          sandbox="allow-same-origin allow-scripts"
          loading="lazy"
          tabIndex={-1}
          style={{
            border: "none",
            width: `${RENDER_WIDTH}px`,
            height: `${Math.round(pageHeight)}px`,
            transform: `scale(${scale}) translateY(-${Math.round(translateY)}px)`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
