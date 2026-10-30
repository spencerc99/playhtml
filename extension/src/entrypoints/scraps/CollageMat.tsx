// ABOUTME: The mat a collage frame is mounted on, with its caption along the bottom edge.
// ABOUTME: Shared by the studio and the published-collage viewer so the framed collage reads the same in both.

import React from "react";

/** The mat around the frame, in screen pixels, and the band under it that carries the caption. */
export const MAT = 26;
export const MAT_CAPTION = 44;
/** On a phone every pixel goes to the collage, so the mat is narrower. */
export const PHONE_MAT = 12;
export const PHONE_MAT_CAPTION = 32;

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
  /** The mat's border and caption band, when they differ from the defaults. */
  mat?: number;
  matCaption?: number;
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
  mat = MAT,
  matCaption = MAT_CAPTION,
  children,
}: CollageMatProps) {
  return (
    <div
      className="collage-mat"
      data-marquee-ground=""
      style={{
        width: width + mat * 2,
        height: height + mat + matCaption,
      }}
    >
      <div
        className="collage-mat__window"
        data-marquee-ground=""
        style={{ left: mat, top: mat, width, height }}
      >
        {children}
      </div>
      <div className="collage-mat__caption" style={{ left: mat, right: mat }}>
        {caption}
      </div>
    </div>
  );
}
