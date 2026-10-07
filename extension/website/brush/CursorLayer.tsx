// ABOUTME: SVG layer drawing the production cursor glyph at the head of every active trail.
// ABOUTME: Reuses @movement's cursor components, hotspot and scale so heads match the real portrait.

import React, { useImperativeHandle, useRef, useState } from "react";
import {
  getCursorComponent,
  getCursorHotspot,
  getCursorScaleFactor,
} from "../shared/cursors";
import { CursorHead } from "./sketch";

/** Matches the cursor size the production trail renderer uses. */
const CURSOR_SIZE = 32;
/** Upper bound on simultaneously rendered cursors, one per concurrent trail. */
const MAX_CURSORS = 32;

export interface CursorLayerHandle {
  /** Place a cursor at each head; extra slots are hidden. */
  update: (heads: CursorHead[]) => void;
}

/** What a slot currently renders. Position is set imperatively, not via state. */
interface SlotStyle {
  color: string;
  cursorType: string | undefined;
}

/**
 * One cursor head. The glyph components take `color` as a prop and use it for
 * fills, strokes and the white underlay, so a color change has to re-render the
 * component rather than patch a `fill` attribute.
 */
const CursorSlot = React.forwardRef<
  SVGGElement,
  { style: SlotStyle }
>(({ style }, ref) => {
  const Glyph = getCursorComponent(style.cursorType);
  // Position the glyph so its hotspot lands at (0,0) — the group's translate
  // then puts that hotspot exactly on the trail head, as production does.
  const hotspot = getCursorHotspot(style.cursorType);
  const scale = (CURSOR_SIZE / 24) * getCursorScaleFactor(style.cursorType);

  return (
    <g ref={ref} style={{ display: "none" }}>
      <g transform={`translate(${-hotspot.x * scale}, ${-hotspot.y * scale})`}>
        <Glyph color={style.color} size={CURSOR_SIZE} />
      </g>
    </g>
  );
});
CursorSlot.displayName = "CursorSlot";

export const CursorLayer = React.forwardRef<CursorLayerHandle>((_props, ref) => {
  const slotRefs = useRef<Array<SVGGElement | null>>([]);
  // Only color/type live in state, so a moving cursor costs no React work.
  const [slotStyles, setSlotStyles] = useState<SlotStyle[]>(() =>
    Array.from({ length: MAX_CURSORS }, () => ({
      color: "#3d3833",
      cursorType: undefined,
    })),
  );
  const appliedRef = useRef(slotStyles);

  useImperativeHandle(ref, () => ({
    update(heads) {
      let changed = false;
      const next = appliedRef.current.map((current, i) => {
        const head = heads[i];
        if (!head) return current;
        if (head.color === current.color && head.cursor === current.cursorType) {
          return current;
        }
        changed = true;
        return { color: head.color, cursorType: head.cursor };
      });
      if (changed) {
        appliedRef.current = next;
        setSlotStyles(next);
      }

      for (let i = 0; i < MAX_CURSORS; i++) {
        const slot = slotRefs.current[i];
        if (!slot) continue;
        const head = heads[i];
        if (!head) {
          // A finished trail stops reporting a head, so its cursor disappears.
          if (slot.style.display !== "none") slot.style.display = "none";
          continue;
        }
        if (slot.style.display === "none") slot.style.display = "";
        slot.setAttribute("transform", `translate(${head.x}, ${head.y})`);
      }
    },
  }));

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      {slotStyles.map((style, i) => (
        <CursorSlot
          key={i}
          style={style}
          ref={(el) => {
            slotRefs.current[i] = el;
          }}
        />
      ))}
    </svg>
  );
});

CursorLayer.displayName = "CursorLayer";
