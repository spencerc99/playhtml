// ABOUTME: Places emote choices around the cursor and handles dismissal.
// ABOUTME: Uses a compact two-sided picker for pairs and a radial wheel for larger sets.

import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_EMOTES, type EmoteDef } from "./emotes";
import { emoteIconSvg } from "./icons";

const MENU_RADIUS = 74;
const ICON_PX = 26;
const PAIR_OFFSET = 48;

function keyForIndex(i: number): string {
  return i === 9 ? "0" : String(i + 1);
}

export function emoteItemPosition(index: number, count: number) {
  if (count === 2) {
    return { x: index === 0 ? -PAIR_OFFSET : PAIR_OFFSET, y: 0 };
  }
  const angle = ((-90 + index * (360 / count)) * Math.PI) / 180;
  return {
    x: Math.cos(angle) * MENU_RADIUS,
    y: Math.sin(angle) * MENU_RADIUS,
  };
}

export function EmoteWheel({
  x,
  y,
  emotes = ACTIVE_EMOTES,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  emotes?: EmoteDef[];
  onSelect: (emoteId: string) => void;
  onClose: () => void;
}) {
  const [fadingOut, setFadingOut] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".emote-wheel")) onClose();
    }
    const t = setTimeout(
      () => window.addEventListener("click", handleClick),
      50,
    );
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", handleClick);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, [onClose]);

  const handleMouseLeave = useCallback(() => {
    setFadingOut(true);
    fadeTimer.current = setTimeout(() => onClose(), 300);
  }, [onClose]);

  const handleMouseEnter = useCallback(() => {
    setFadingOut(false);
    if (fadeTimer.current) {
      clearTimeout(fadeTimer.current);
      fadeTimer.current = null;
    }
  }, []);

  const n = emotes.length;
  return (
    <div
      className={`emote-wheel ${n === 2 ? "emote-wheel--pair" : ""}`}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        animation: fadingOut ? undefined : "emote-wheel-open 0.15s ease-out",
        opacity: fadingOut ? 0 : 0.85,
        transition: "opacity 0.3s ease-out",
      }}
    >
      {n !== 2 && (
        <div
          className="emote-ring"
          style={{
            width: `${MENU_RADIUS * 2 + 40}px`,
            height: `${MENU_RADIUS * 2 + 40}px`,
            left: `${-(MENU_RADIUS + 20)}px`,
            top: `${-(MENU_RADIUS + 20)}px`,
          }}
        />
      )}
      {emotes.map((emote, i) => {
        const { x: ix, y: iy } = emoteItemPosition(i, n);
        return (
          <button
            key={emote.id}
            className="emote-item"
            onClick={() => onSelect(emote.id)}
            style={{
              left: `${ix - 23}px`,
              top: `${iy - 23}px`,
              animation: `emote-item-pop 0.2s ease-out ${i * 0.03}s both`,
            }}
            title={emote.label}
            aria-label={emote.label}
          >
            <span
              className="glyph"
              dangerouslySetInnerHTML={{
                __html: emoteIconSvg(emote.id, ICON_PX, "currentColor"),
              }}
            />
            <span className="key">{keyForIndex(i)}</span>
          </button>
        );
      })}
    </div>
  );
}
