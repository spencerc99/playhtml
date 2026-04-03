// ABOUTME: Renders an abstract pixelated preview of a web page inside an SVG foreignObject.
// ABOUTME: Compresses pages into a tiny pixel grid inspired by "nothing on my computer."
import React, { memo } from "react";

interface PagePreviewProps {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scrollY: number;
  scrollRange: number;
  // Number of pixels wide the compressed view should be (default 30)
  resolution?: number;
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
    resolution = 30,
  }: PagePreviewProps) => {
    // Compute the tiny render size that preserves the viewport aspect ratio
    const aspect = width / height;
    const tinyW = resolution;
    const tinyH = Math.round(resolution / aspect);

    // The iframe renders at this tiny size — the browser will rasterize the page
    // into very few pixels. We then scale it up to fill the viewport rect.
    const scaleUp = width / tinyW;

    // For scroll: the page is taller than the viewport
    const pageMultiplier = 2 + scrollRange * 4;
    const tinyPageH = Math.round(tinyH * pageMultiplier);
    const scrollOffset = Math.round(scrollY * (tinyPageH - tinyH));

    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: `${width}px`,
            height: `${height}px`,
            overflow: "hidden",
            pointerEvents: "none",
            // This is the key: when the tiny iframe is scaled up,
            // each "pixel" becomes a crisp block instead of being interpolated
            imageRendering: "pixelated",
          }}
        >
          <div
            style={{
              width: `${tinyW}px`,
              height: `${tinyH}px`,
              overflow: "hidden",
              transform: `scale(${scaleUp})`,
              transformOrigin: "top left",
            }}
          >
            <iframe
              src={url}
              sandbox="allow-same-origin allow-scripts"
              loading="lazy"
              tabIndex={-1}
              style={{
                border: "none",
                width: `${tinyW}px`,
                height: `${tinyPageH}px`,
                transform: `translateY(-${scrollOffset}px)`,
                pointerEvents: "none",
                display: "block",
              }}
            />
          </div>
        </div>
      </foreignObject>
    );
  },
);

PagePreview.displayName = "PagePreview";
