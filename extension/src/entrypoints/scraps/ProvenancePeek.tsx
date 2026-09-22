// ABOUTME: Archive labels pinned to each piece while the peek key is held.
// ABOUTME: Each tag is tied to its piece by an outline so the pair reads as one thing.

import React, { useLayoutEffect, useRef, useState } from "react";
import type { CollagePiece } from "./collageRecord";
import { spreadTags, type TagBox } from "./pieceStack";
import { webPageHref } from "./scrapLinks";

interface ProvenancePeekProps {
  pieces: readonly CollagePiece[];
  /** The piece under the pointer, which gets the fuller label. */
  hoveredId: string | null;
  /** The frame's zoom, so the labels stay one size on screen. */
  scale: number;
}

/** What a tag is assumed to take up before it has been measured. */
const ASSUMED_TAG = { width: 120, height: 16 };

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
  const holderRef = useRef<HTMLDivElement>(null);
  /** Each tag's measured on-screen size, so overlaps can be told apart. */
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>(
    {},
  );

  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const measure = () => {
      const measured: Record<string, { width: number; height: number }> = {};
      for (const node of holder.querySelectorAll<HTMLElement>("[data-piece]")) {
        const id = node.dataset.piece;
        if (!id) continue;
        const box = node.getBoundingClientRect();
        // Back into frame units, which is the space the tags are laid out in.
        measured[id] = { width: box.width / scale, height: box.height / scale };
      }
      setSizes(measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of holder.querySelectorAll("[data-piece]")) {
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [pieces, hoveredId, scale]);

  // Tags start at each piece's top-left corner and are then nudged apart, so
  // two labels never sit on top of each other.
  const wanted: TagBox[] = pieces.map((piece) => {
    const size = sizes[piece.id] ?? {
      width: ASSUMED_TAG.width / scale,
      height: ASSUMED_TAG.height / scale,
    };
    return {
      pieceId: piece.id,
      x: piece.x,
      y: piece.y - size.height,
      width: size.width,
      height: size.height,
    };
  });
  const placed = new Map(
    spreadTags(wanted).map((tag) => [tag.pieceId, tag] as const),
  );

  return (
    <div ref={holderRef}>
      {pieces.map((piece) => {
        const { scrap } = piece;
        const hovered = piece.id === hoveredId;
        const tag = placed.get(piece.id);
        // Favicons are stored data like any other URL, so only a plain web
        // address is ever loaded.
        const favicon = scrap.faviconUrl ? webPageHref(scrap.faviconUrl) : null;
        const title = shortened(scrap.pageTitle ?? "");
        return (
          <React.Fragment key={piece.id}>
            {/* The piece's own edge, drawn so the label has something to
                belong to. It turns with the piece. */}
            <div
              className={`collage-peek-edge${hovered ? " collage-peek-edge--on" : ""}`}
              aria-hidden="true"
              style={{
                left: piece.x,
                top: piece.y,
                width: piece.width,
                height: piece.height,
                transform: `rotate(${piece.rotation}deg)`,
                borderWidth: 1 / scale,
              }}
            />
            <div
              data-piece={piece.id}
              className={`collage-peek${hovered ? " collage-peek--full" : ""}`}
              aria-hidden="true"
              style={{
                left: tag?.x ?? piece.x,
                top: tag?.y ?? piece.y,
                transform: `scale(${1 / scale})`,
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
                  {title && <span className="collage-peek__line">{title}</span>}
                  <span className="collage-peek__line">
                    {scrapKindName(piece)} &#183; first seen {seenOn(scrap.ts)}
                  </span>
                </span>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
