// ABOUTME: Renders an abstract preview of a web page inside an SVG foreignObject.
// ABOUTME: Renders at desktop width then scales down to fit the viewport rect.
import React, { memo } from "react";

interface PagePreviewProps {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scrollY: number;
  scrollRange: number;
}

const RENDER_WIDTH = 1280;

export const PagePreview = memo(
  ({
    url,
    x,
    y,
    width,
    height,
    scrollY,
    scrollRange,
  }: PagePreviewProps) => {
    const scale = width / RENDER_WIDTH;
    const renderHeight = height / scale;
    const pageMultiplier = 2 + scrollRange * 4;
    const pageHeight = renderHeight * pageMultiplier;
    const scrollOffset = scrollY * (pageHeight - renderHeight);

    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <iframe
            src={url}
            sandbox="allow-same-origin allow-scripts"
            loading="lazy"
            tabIndex={-1}
            style={{
              border: "none",
              width: `${RENDER_WIDTH}px`,
              height: `${pageHeight}px`,
              transform: `scale(${scale}) translateY(-${Math.round(scrollOffset)}px)`,
              transformOrigin: "top left",
              pointerEvents: "none",
            }}
          />
        </div>
      </foreignObject>
    );
  },
);

PagePreview.displayName = "PagePreview";
