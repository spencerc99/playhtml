// ABOUTME: Renders an abstract pixelated preview of a web page inside an SVG foreignObject.
// ABOUTME: Loads page in a hidden iframe, applies downscaling for a mosaic effect.
import React, { memo } from "react";

interface PagePreviewProps {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scrollY: number;
  scrollRange: number;
  pixelScale?: number;
}

export const PagePreview = memo(
  ({
    url,
    x,
    y,
    width,
    height,
    scrollY,
    scrollRange,
    pixelScale = 10,
  }: PagePreviewProps) => {
    const pageMultiplier = 2 + scrollRange * 4;
    const pageHeight = height * pageMultiplier;
    const scrollOffset = scrollY * (pageHeight - height);

    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            overflow: "hidden",
            pointerEvents: "none",
            position: "relative",
          }}
        >
          <iframe
            src={url}
            sandbox="allow-same-origin"
            loading="lazy"
            tabIndex={-1}
            style={{
              border: "none",
              position: "absolute",
              left: 0,
              top: 0,
              width: `${width}px`,
              height: `${pageHeight}px`,
              transform: `translateY(-${Math.round(scrollOffset)}px)`,
              pointerEvents: "none",
              filter: `blur(${Math.max(1, Math.round(width / 80))}px)`,
              opacity: 0.85,
            }}
          />
        </div>
      </foreignObject>
    );
  },
);

PagePreview.displayName = "PagePreview";
