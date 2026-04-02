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
 * The approach: render a tiny canvas (viewport / pixelScale) that contains
 * the iframe scaled down. The container then scales it back up to fill the
 * viewport rect with image-rendering: pixelated, creating a mosaic effect.
 *
 * Scroll position is simulated via translateY on the iframe.
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
    pixelScale = 12,
  }: PagePreviewProps) => {
    // Page is taller than viewport to allow scrolling
    const pageMultiplier = 2 + scrollRange * 4;
    const pageHeight = height * pageMultiplier;
    const scrollOffset = scrollY * (pageHeight - height);

    // Tiny dimensions for the downscaled rendering
    const tinyW = Math.max(1, Math.round(width / pixelScale));
    const tinyH = Math.max(1, Math.round(height / pixelScale));

    return (
      <foreignObject x={x} y={y} width={width} height={height}>
        {/* Outer container: scales the tiny content back up to fill the viewport */}
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: width,
            height: height,
            overflow: "hidden",
            imageRendering: "pixelated" as any,
            pointerEvents: "none",
          }}
        >
          {/* Tiny container: everything inside is rendered at 1/pixelScale */}
          <div
            style={{
              width: tinyW,
              height: tinyH,
              overflow: "hidden",
              transform: `scale(${pixelScale})`,
              transformOrigin: "top left",
            }}
          >
            {/* Iframe rendered at tiny size, shifted up to simulate scroll */}
            <iframe
              src={url}
              sandbox="allow-same-origin"
              loading="lazy"
              tabIndex={-1}
              style={{
                border: "none",
                width: tinyW,
                height: Math.round(pageHeight / pixelScale),
                transform: `translateY(-${Math.round(scrollOffset / pixelScale)}px)`,
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
