// ABOUTME: Archive labels pinned to each piece while the peek key is held.
// ABOUTME: Each tag shares a tint with its piece's outline so the pair reads as one thing.

import React, { useLayoutEffect, useRef, useState } from "react";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "./collageRecord";
import {
  pieceBounds,
  placeTags,
  tintPieces,
  type Rect,
  type TagRequest,
} from "./peekTags";
import { webPageHref } from "./scrapLinks";
import type { PieceOwner } from "./sharedCollage";

interface ProvenancePeekProps {
  pieces: readonly CollagePiece[];
  /** The piece under the pointer, whose edge is drawn in ink. */
  hoveredId: string | null;
  /** The frame's zoom, so the labels stay one size on screen. */
  scale: number;
  /** The part of the frame that shows, in frame units; every label stays in it. */
  bounds: Rect;
  /** Who put a piece down, on a shared collage; their color tints its label. */
  ownerFor?: (piece: CollagePiece) => PieceOwner | null;
}

/** What a tag is assumed to take up before it has been measured. */
const ASSUMED_TAG = { width: 120, height: 16 };
/** How close two pieces sit on screen before their tints must differ. */
const NEAR_ON_SCREEN = 48;

function scrapKindName(scrap: ScrapItem): string {
  switch (scrap.kind) {
    case "image":
      return "picture";
    case "button":
      return "button";
    case "svg-icon":
      return "icon";
    case "heading":
      return "heading";
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

/**
 * What a label says about a scrap: where it came from, the page's title, what
 * kind of thing it is and when it was first seen.
 */
/** Who added a scrap, leading its label in their cursor's color. */
export function OwnerLine({ owner }: { owner: PieceOwner }) {
  return (
    <span className="collage-peek__who" style={{ color: owner.color }}>
      <span className="collage-peek__dot" style={{ background: owner.color }} />
      {owner.name}
    </span>
  );
}

export function ProvenanceLines({
  scrap,
  owner,
}: {
  scrap: ScrapItem;
  /** Who added it, on a shared collage. */
  owner?: PieceOwner | null;
}) {
  // Favicons are stored data like any other URL, so only a plain web address
  // is ever loaded.
  const favicon = scrap.faviconUrl ? webPageHref(scrap.faviconUrl) : null;
  const title = shortened(scrap.pageTitle ?? "");
  return (
    <>
      {owner && <OwnerLine owner={owner} />}
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
      <span className="collage-peek__more">
        {title && <span className="collage-peek__line">{title}</span>}
        <span className="collage-peek__line">
          {scrapKindName(scrap)} &#183; first seen {seenOn(scrap.ts)}
        </span>
      </span>
    </>
  );
}

export function ProvenancePeek({
  pieces,
  hoveredId,
  scale,
  bounds,
  ownerFor,
}: ProvenancePeekProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  /** Tints given so far, kept for as long as the peek is held. */
  const tintsRef = useRef<ReadonlyMap<string, string>>(new Map());
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
  }, [pieces, scale]);

  const covered = pieces.map((piece) => ({
    id: piece.id,
    bounds: pieceBounds(piece),
  }));
  // Pieces within a few labels' height of each other on screen count as near.
  const tints = tintPieces(covered, tintsRef.current, NEAR_ON_SCREEN / scale);
  tintsRef.current = tints;

  // Each tag takes the first spot near its piece that is inside the frame and
  // clear of the others, so every label can be read.
  const requests: TagRequest[] = covered.map(({ id, bounds: piece }) => {
    const size = sizes[id] ?? {
      width: ASSUMED_TAG.width / scale,
      height: ASSUMED_TAG.height / scale,
    };
    return { pieceId: id, piece, width: size.width, height: size.height };
  });
  const placed = new Map(
    placeTags(requests, bounds).map((tag) => [tag.pieceId, tag] as const),
  );

  return (
    <div ref={holderRef}>
      {pieces.map((piece) => {
        const { scrap } = piece;
        const hovered = piece.id === hoveredId;
        const tag = placed.get(piece.id);
        const owner = ownerFor?.(piece) ?? null;
        // On a shared collage each piece wears its adder's color instead.
        const tint = {
          "--peek-tint": owner?.color ?? tints.get(piece.id),
        } as React.CSSProperties;
        return (
          <React.Fragment key={piece.id}>
            {/* The piece's own edge, drawn so the label has something to
                belong to. It turns with the piece. */}
            <div
              className={`collage-peek-edge${hovered ? " collage-peek-edge--on" : ""}${
                owner ? " collage-peek-edge--owned" : ""
              }`}
              aria-hidden="true"
              style={{
                left: piece.x,
                top: piece.y,
                width: piece.width,
                height: piece.height,
                transform: `rotate(${piece.rotation}deg)`,
                borderWidth: (owner ? 2.5 : 1) / scale,
                ...tint,
              }}
            />
            <div
              data-piece={piece.id}
              className="collage-peek"
              aria-hidden="true"
              style={{
                left: tag?.x ?? piece.x,
                top: tag?.y ?? piece.y,
                transform: `scale(${1 / scale})`,
                zIndex: 10_005,
                ...tint,
              }}
            >
              <ProvenanceLines scrap={scrap} owner={owner} />
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
