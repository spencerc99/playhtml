// ABOUTME: Renders an abstract pixelated preview of a web page inside an SVG foreignObject.
// ABOUTME: Loads page in a hidden iframe, applies heavy downscaling for a mosaic effect.
import React, { memo } from "react";

interface PagePreviewProps {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scrollY: number; // Normalized 0-1
  scrollRange: number; // How much of the page is scrolled through (0-1)
  pixelScale?: number; // Higher = more pixelated (default 16)
}

/**
 * Renders an abstract, pixelated representation of a web page.
 *
 * The approach: render the page in an iframe at full size, then use nested
 * CSS transforms to downscale and re-upscale with `image-rendering: pixelated`.
 * This creates a mosaic effect that preserves color distribution and layout
 * density without being readable.
 *
 * Scroll position is simulated via `transform: translateY()` on the iframe,
 * which works cross-origin since it's a CSS transform on our element.
 */
export const PagePreview = memo(
  ({
    url,
    x,
    y,
    width,
    height,
    scrollY,
    scrollRange,
    pixelScale = 16,
  }: PagePreviewProps) => {
    // The iframe is rendered tall enough to cover the scroll range.
    // pageMultiplier matches the logic in DynamicViewportRect.
    const pageMultiplier = 2 + scrollRange * 4;
    const iframeHeight = height * pageMultiplier;
    const scrollableHeight = iframeHeight - height;
    const scrollOffset = scrollY * scrollableHeight;

    // The downscale factor: we shrink the iframe to 1/pixelScale of its size,
    // then the container scales it back up. With image-rendering: pixelated,
    // this creates the mosaic effect.
    const downscale = 1 / pixelScale;

    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        <div
          style={{
            width,
            height,
            overflow: "hidden",
            imageRendering: "pixelated",
            // Prevent any interaction with the iframe
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width,
              height,
              transform: `scale(${downscale})`,
              transformOrigin: "top left",
            }}
          >
            <iframe
              src={url}
              sandbox="allow-same-origin"
              loading="lazy"
              tabIndex={-1}
              style={{
                border: "none",
                width: width * pixelScale,
                height: iframeHeight * pixelScale,
                transform: `translateY(-${scrollOffset * pixelScale}px) scale(${downscale})`,
                transformOrigin: "top left",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </foreignObject>
    );
  },
);

PagePreview.displayName = "PagePreview";
