// ABOUTME: Archive labels pinned to each piece while the peek key is held.
// ABOUTME: Names where the material came from without touching the arrangement.

import React from "react";
import type { CollagePiece } from "./collageRecord";
import { webPageHref } from "./scrapLinks";

interface ProvenancePeekProps {
  pieces: readonly CollagePiece[];
  /** The piece under the pointer, which gets the fuller label. */
  hoveredId: string | null;
  /** The frame's zoom, so the labels stay one size on screen. */
  scale: number;
}

function scrapKindName(piece: CollagePiece): string {
  switch (piece.scrap.kind) {
    case "image":
      return "picture";
    case "button":
      return "button";
    case "svg-icon":
      return "icon";
    case "cursor":
      return "cursor";
  }
}

function seenOn(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Keeps a long page title to a length a slip of paper can carry. */
function shortened(title: string, limit = 42): string {
  const trimmed = title.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1)}…`;
}

export function ProvenancePeek({
  pieces,
  hoveredId,
  scale,
}: ProvenancePeekProps) {
  return (
    <>
      {pieces.map((piece) => {
        const { scrap } = piece;
        const hovered = piece.id === hoveredId;
        // Favicons are stored data like any other URL, so only a plain web
        // address is ever loaded.
        const favicon = scrap.faviconUrl ? webPageHref(scrap.faviconUrl) : null;
        const title = shortened(scrap.pageTitle ?? "");
        return (
          <div
            key={piece.id}
            className={`collage-peek${hovered ? " collage-peek--full" : ""}`}
            aria-hidden="true"
            style={{
              left: piece.x,
              top: piece.y,
              // The slip is pinned to the piece's corner but stays upright and
              // the same size on screen however the frame is zoomed.
              transform: `translate(-2px, calc(-100% - 4px)) scale(${1 / scale})`,
              zIndex: hovered ? 10_006 : 10_005,
            }}
          >
            <span className="collage-peek__where">
              {favicon && (
                <img
                  className="collage-peek__mark"
                  src={favicon}
                  alt=""
                  width={10}
                  height={10}
                />
              )}
              {scrap.domain}
            </span>
            {hovered && (
              <span className="collage-peek__more">
                {title && (
                  <span className="collage-peek__line">{title}</span>
                )}
                <span className="collage-peek__line">
                  {scrapKindName(piece)} &#183; first seen {seenOn(scrap.ts)}
                </span>
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
