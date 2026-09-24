// ABOUTME: The compact strip of tools that floats beside the selected piece.
// ABOUTME: Small inline-SVG glyphs so the tools stay out of the material's way.

import React, { useLayoutEffect, useRef, useState } from "react";
import type { CollagePiece } from "./collageRecord";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {children}
    </svg>
  );
}

/** The strip's glyphs, shared with the collage history's card actions. */
export const GLYPHS = {
  forward: (
    <Glyph>
      <rect x="2.5" y="4.5" width="7" height="7" {...STROKE} />
      <path d="M8 8.5h5.5V3" {...STROKE} />
    </Glyph>
  ),
  backward: (
    <Glyph>
      <rect x="6.5" y="4.5" width="7" height="7" {...STROKE} />
      <path d="M8 7.5H2.5V13" {...STROKE} />
    </Glyph>
  ),
  flipX: (
    <Glyph>
      <path d="M8 1.5v13" {...STROKE} strokeDasharray="2 2" />
      <path d="M6 4L2 8l4 4z" {...STROKE} />
      <path d="M10 4l4 4-4 4z" {...STROKE} />
    </Glyph>
  ),
  flipY: (
    <Glyph>
      <path d="M1.5 8h13" {...STROKE} strokeDasharray="2 2" />
      <path d="M4 6L8 2l4 4z" {...STROKE} />
      <path d="M4 10l4 4 4-4z" {...STROKE} />
    </Glyph>
  ),
  crop: (
    <Glyph>
      <path d="M4.5 1.5v10h10" {...STROKE} />
      <path d="M1.5 4.5h10v10" {...STROKE} />
    </Glyph>
  ),
  uncrop: (
    <Glyph>
      <rect x="2.5" y="2.5" width="11" height="11" {...STROKE} />
      <path d="M5.5 8h5M8 5.5v5" {...STROKE} />
    </Glyph>
  ),
  cutOut: (
    <Glyph>
      <circle cx="4" cy="12" r="1.8" {...STROKE} />
      <circle cx="12" cy="12" r="1.8" {...STROKE} />
      <path d="M5.3 10.7L12 2M10.7 10.7L4 2" {...STROKE} />
    </Glyph>
  ),
  duplicate: (
    <Glyph>
      <rect x="2.5" y="2.5" width="8" height="8" {...STROKE} />
      <rect x="5.5" y="5.5" width="8" height="8" {...STROKE} />
    </Glyph>
  ),
  saveFile: (
    <Glyph>
      <path d="M8 2v7.5M5 6.5l3 3 3-3" {...STROKE} />
      <path d="M2.5 10v3.5h11V10" {...STROKE} />
    </Glyph>
  ),
  remove: (
    <Glyph>
      <path d="M3 4.5h10M6.5 4.5V2.5h3v2" {...STROKE} />
      <path d="M4.5 4.5l.7 9h5.6l.7-9" {...STROKE} />
    </Glyph>
  ),
};

export interface PieceActionsProps {
  piece: CollagePiece;
  canUncrop: boolean;
  canCutOut: boolean;
  /** The frame's zoom, so the strip stays one size on screen. */
  scale: number;
  /** The frame's size, so the strip can be kept inside it. */
  frame: { width: number; height: number };
  onOrder: (to: "forward" | "backward" | "front" | "back") => void;
  onFlip: (axis: "x" | "y") => void;
  onCrop: () => void;
  onUncrop: () => void;
  onCutOut: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

type Action =
  | { separator: true; key: string }
  | {
      key: string;
      label: string;
      hint: string;
      glyph: React.ReactNode;
      run: () => void;
      disabled?: boolean;
      danger?: boolean;
      on?: boolean;
    };

function isSeparator(action: Action): action is { separator: true; key: string } {
  return "separator" in action;
}

/** How far above the piece the strip sits, in on-screen pixels. */
const STRIP_GAP = 10;

/**
 * The tools for whatever is in hand, floating beside the piece itself rather
 * than in a bar the eye has to travel to. To-front and to-back are not here:
 * they stay on shift + the bracket keys, listed in the keys popover.
 */
export function PieceActions({
  piece,
  canUncrop,
  canCutOut,
  scale,
  frame,
  onOrder,
  onFlip,
  onCrop,
  onUncrop,
  onCutOut,
  onDuplicate,
  onRemove,
}: PieceActionsProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  /** The strip's own on-screen size, measured so it can be kept in frame. */
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => {
      const box = strip.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  const actions: Action[] = [
    {
      key: "backward",
      label: "Send back one",
      hint: "[",
      glyph: GLYPHS.backward,
      run: () => onOrder("backward"),
    },
    {
      key: "forward",
      label: "Bring forward one",
      hint: "]",
      glyph: GLYPHS.forward,
      run: () => onOrder("forward"),
    },
    { separator: true, key: "after-order" },
    {
      key: "flip-x",
      label: "Flip across",
      hint: "H",
      glyph: GLYPHS.flipX,
      run: () => onFlip("x"),
      on: piece.flipX,
    },
    {
      key: "flip-y",
      label: "Flip down",
      hint: "V",
      glyph: GLYPHS.flipY,
      run: () => onFlip("y"),
      on: piece.flipY,
    },
    {
      key: "crop",
      label: "Crop",
      hint: "C",
      glyph: GLYPHS.crop,
      run: onCrop,
    },
    // Restoring a crop has no key of its own, so it only appears once there
    // is a crop to undo rather than sitting there greyed out.
    ...(canUncrop
      ? [
          {
            key: "uncrop",
            label: "Undo the crop",
            hint: "restores the whole picture",
            glyph: GLYPHS.uncrop,
            run: onUncrop,
          },
        ]
      : []),
    // Only a picture has a background to cut away.
    ...(canCutOut
      ? [
          {
            key: "cut-out",
            label: piece.cutout
              ? "Keep the background"
              : "Cut out the background",
            hint: "B",
            glyph: GLYPHS.cutOut,
            run: onCutOut,
            on: piece.cutout !== undefined,
          },
        ]
      : []),
    { separator: true, key: "after-shape" },
    {
      key: "duplicate",
      label: "Duplicate",
      hint: "cmd + D",
      glyph: GLYPHS.duplicate,
      run: onDuplicate,
    },
    {
      key: "remove",
      label: "Remove",
      hint: "delete",
      glyph: GLYPHS.remove,
      run: onRemove,
      danger: true,
    },
  ];

  // The strip is placed in frame coordinates but drawn at its own on-screen
  // size, so every measurement below is converted through the zoom.
  const gap = STRIP_GAP / scale;
  const width = size.width / scale;
  const height = size.height / scale;
  const above = piece.y - gap - height;
  // Near the top of the frame there is no room above, so it goes below.
  const top = above >= 0 ? above : piece.y + piece.height + gap;
  const centered = piece.x + piece.width / 2 - width / 2;
  const left =
    width >= frame.width
      ? 0
      : Math.min(Math.max(centered, 0), frame.width - width);

  return (
    <div
      ref={stripRef}
      className="collage-piece-actions"
      role="toolbar"
      aria-label="Piece"
      style={{
        left,
        top: Math.min(Math.max(top, 0), Math.max(frame.height - height, 0)),
        transform: `scale(${1 / scale})`,
      }}
      // Clicking a tool must not reach the frame beneath and drop the
      // selection the tool is about to act on.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {actions.map((action) =>
        isSeparator(action) ? (
          <span
            key={action.key}
            className="collage-piece-actions__rule"
            aria-hidden="true"
          />
        ) : (
          <button
            key={action.key}
            type="button"
            className={`collage-glyph${action.on ? " collage-glyph--on" : ""}${
              action.danger ? " collage-glyph--danger" : ""
            }`}
            title={`${action.label} (${action.hint})`}
            aria-label={action.label}
            aria-pressed={action.on === undefined ? undefined : action.on}
            disabled={action.disabled}
            onClick={action.run}
          >
            {action.glyph}
          </button>
        ),
      )}
    </div>
  );
}
