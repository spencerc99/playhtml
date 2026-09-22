// ABOUTME: A quiet list of every piece stacked under the pointer, front to back.
// ABOUTME: Right-clicking a pile is how a buried piece is picked out by eye.

import React, { useEffect, useRef } from "react";
import { ScrapContent } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "./collageRecord";

interface PiecesHereMenuProps {
  /** The pieces under the pointer, frontmost first. */
  pieces: readonly CollagePiece[];
  /** Where the menu opens, in frame coordinates. */
  at: { x: number; y: number };
  /** The frame's zoom, so the menu stays one size on screen. */
  scale: number;
  selectedId: string | null;
  onPick: (pieceId: string) => void;
  onClose: () => void;
}

function scrapKindName(piece: CollagePiece): string {
  switch (piece.scrap.kind) {
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

export function PiecesHereMenu({
  pieces,
  at,
  scale,
  selectedId,
  onPick,
  onClose,
}: PiecesHereMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capturing beats the studio's own Escape, so a press closes the menu
      // rather than dropping the selection behind it.
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu && !menu.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="collage-here"
      role="menu"
      aria-label="Pieces here"
      style={{
        left: at.x,
        top: at.y,
        transform: `scale(${1 / scale})`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="collage-studio__label collage-here__head">pieces here</p>
      {pieces.map((piece) => (
        <button
          key={piece.id}
          type="button"
          role="menuitem"
          className={`collage-here__row${
            piece.id === selectedId ? " collage-here__row--on" : ""
          }`}
          onClick={() => onPick(piece.id)}
        >
          <span className="collage-here__thumb" aria-hidden="true">
            <ScrapContent
              item={piece.scrap}
              loaded={true}
              onLoad={() => {}}
              onError={() => {}}
            />
          </span>
          <span className="collage-here__what">
            <span className="collage-here__kind">{scrapKindName(piece)}</span>
            <span className="collage-here__where">{piece.scrap.domain}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
