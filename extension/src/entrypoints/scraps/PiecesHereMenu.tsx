// ABOUTME: A quiet list of every piece stacked under the pointer, front to back.
// ABOUTME: Right-clicking a pile is how a buried piece is picked out by eye.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScrapContent } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "./collageRecord";
import { GLYPHS } from "./PieceActions";

interface PiecesHereMenuProps {
  /** The pieces under the pointer, frontmost first. */
  pieces: readonly CollagePiece[];
  /** Where the menu opens, in frame coordinates. */
  at: { x: number; y: number };
  /** The frame's zoom, so the menu stays one size on screen. */
  scale: number;
  /** The frame's size, so the menu is kept inside it. */
  frame?: { width: number; height: number };
  selectedId: string | null;
  onPick: (pieceId: string) => void;
  /** Holds a piece in place or lets it go. */
  onLock: (pieceId: string, locked: boolean) => void;
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
  frame,
  selectedId,
  onPick,
  onLock,
  onClose,
}: PiecesHereMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  /** The menu's own on-screen size, measured so it can be kept in frame. */
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const box = menu.getBoundingClientRect();
    setSize({ width: box.width, height: box.height });
  }, [pieces.length]);
  // Opened near the right or bottom edge, it slides back in rather than
  // running off the frame, which on a phone is off the screen too.
  const left = frame
    ? Math.max(0, Math.min(at.x, frame.width - size.width / scale))
    : at.x;
  const top = frame
    ? Math.max(0, Math.min(at.y, frame.height - size.height / scale))
    : at.y;

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
        left,
        top,
        transform: `scale(${1 / scale})`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="collage-studio__label collage-here__head">pieces here</p>
      {pieces.map((piece) => (
        <div
          key={piece.id}
          className={`collage-here__row${
            piece.id === selectedId ? " collage-here__row--on" : ""
          }${piece.locked ? " collage-here__row--locked" : ""}`}
        >
          <button
            type="button"
            role="menuitem"
            className="collage-here__pick"
            // A locked piece stays put until it is let go.
            disabled={piece.locked}
            title={piece.locked ? "Locked. Unlock it to move it." : undefined}
            onClick={() => onPick(piece.id)}
          >
            <span className="collage-here__thumb" aria-hidden="true">
              <ScrapContent
                item={piece.scrap}
                loaded={true}
                onLoad={() => {}}
                onError={() => {}}
                letteringChecker={false}
              />
            </span>
            <span className="collage-here__what">
              <span className="collage-here__kind">{scrapKindName(piece)}</span>
              <span className="collage-here__where">{piece.scrap.domain}</span>
            </span>
          </button>
          <button
            type="button"
            className="collage-glyph collage-here__lock"
            aria-label={piece.locked ? "Unlock" : "Lock in place"}
            aria-pressed={piece.locked === true}
            title={piece.locked ? "Unlock" : "Lock in place"}
            onClick={() => onLock(piece.id, !piece.locked)}
          >
            {piece.locked ? GLYPHS.lock : GLYPHS.unlock}
          </button>
        </div>
      ))}
    </div>
  );
}
