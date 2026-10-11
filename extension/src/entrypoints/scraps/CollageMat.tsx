// ABOUTME: The mat a collage frame is mounted on, with its caption along the bottom edge.
// ABOUTME: Shared by the studio and the published-collage viewer so the framed collage reads the same in both.

import React from "react";

/** The mat around the frame, in screen pixels, and the band under it that carries the caption. */
export const MAT = 26;
export const MAT_CAPTION = 44;

/** A date as the mat's caption writes it: "oct 11, 2026". */
export function madeOn(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .toLowerCase();
}

interface CollageMatProps {
  /** The window the frame shows through, in screen pixels. */
  width: number;
  height: number;
  /** What the mat says along its bottom edge. */
  caption: React.ReactNode;
  /** The collage sheet, sized to the window. */
  children: React.ReactNode;
}

/**
 * The frame sits on a mat, and the mat carries the collage's name, count and
 * date under it, so a screenshot of the mat says what it is.
 */
export function CollageMat({
  width,
  height,
  caption,
  children,
}: CollageMatProps) {
  return (
    <div
      className="collage-mat"
      data-marquee-ground=""
      style={{
        width: width + MAT * 2,
        height: height + MAT + MAT_CAPTION,
      }}
    >
      <div
        className="collage-mat__window"
        data-marquee-ground=""
        style={{ left: MAT, top: MAT, width, height }}
      >
        {children}
      </div>
      <div className="collage-mat__caption" style={{ left: MAT, right: MAT }}>
        {caption}
      </div>
    </div>
  );
}
