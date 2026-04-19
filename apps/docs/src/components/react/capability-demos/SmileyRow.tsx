import React, { useCallback, useEffect, useRef, useState } from "react";
import { withSharedState } from "@playhtml/react";

// ------------------------------------------------------------------
// SmileyRow — can-play triptych, slot 3
// ------------------------------------------------------------------
// A 64x64 monochrome doodle pad. Visitors draw, click "Add to row",
// and their drawing streams into a shared horizontal strip (max 20,
// FIFO). The tiny canvas + single-color palette is the moderation
// strategy: it's much harder to draw something offensive at 64x64
// than at 640x640.
//
// Storage note: canvas.toDataURL('image/png') for a mostly-empty
// 64x64 mono PNG is typically ~300-900 bytes. Even a densely-inked
// doodle caps around ~2 KB. 20 entries stays comfortably under
// ~40 KB of payload in the Yjs doc — negligible next to the
// awareness churn on this page.
//
// Yjs quirk (see docs/llm-prompting-guide.md): mutator form
// (setData((draft) => { ... })) does NOT support shift/pop. We use
// splice(0, n) to trim the head when we exceed the cap.

const COMPONENT_ID = "ph-cap-smiley-row";
const CANVAS_PX = 64; // physical pixels the PNG encodes
const PEN_RADIUS = 2; // in canvas-space pixels (feels like a soft marker at 3x scale)
const MAX_DOODLES = 20;

type Doodle = { id: string; src: string; at: number };
type DoodleData = { doodles: Doodle[] };

function makeId(): string {
  // Short, collision-resistant-enough for a 20-item row. We're not
  // using crypto.randomUUID because older mobile Safari builds still
  // ship without it in some contexts.
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

// Integer-stepped line interpolation. We draw small filled squares
// along a Bresenham-ish linear walk between the previous pointer
// sample and the current one. Without this, fast strokes leave
// visible gaps because pointermove fires at ~60Hz, not per-pixel.
function strokeSegment(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(fromX + dx * t);
    const y = Math.round(fromY + dy * t);
    ctx.fillRect(x - PEN_RADIUS, y - PEN_RADIUS, PEN_RADIUS * 2, PEN_RADIUS * 2);
  }
}

function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
  ctx.fillStyle = "#000000";
}

const SmileyRowInner = withSharedState<DoodleData>(
  {
    defaultData: { doodles: [] },
    id: COMPONENT_ID,
  },
  ({ data, setData }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const lastPtRef = useRef<{ x: number; y: number } | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const rowRef = useRef<HTMLDivElement | null>(null);

    // Initialize the canvas context once. We fill the background
    // explicitly so the exported PNG has a white (not transparent)
    // backing — otherwise the "pen" reads as colored pixels on a
    // checker pattern in previews.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctxRef.current = ctx;
      clearCanvas(ctx);
    }, []);

    // Keep the row scrolled to the right edge whenever new doodles
    // arrive — the "newest on the right" rule is only useful if the
    // newest is actually on screen after overflow kicks in.
    useEffect(() => {
      const row = rowRef.current;
      if (!row) return;
      row.scrollLeft = row.scrollWidth;
    }, [data.doodles.length]);

    const pointerToCanvas = useCallback(
      (clientX: number, clientY: number): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = CANVAS_PX / rect.width;
        const scaleY = CANVAS_PX / rect.height;
        return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY,
        };
      },
      [],
    );

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const pt = pointerToCanvas(e.clientX, e.clientY);
        if (!pt) return;
        // A click-without-drag should still leave a dot, so we stamp
        // at the down point immediately.
        strokeSegment(ctx, pt.x, pt.y, pt.x, pt.y);
        lastPtRef.current = pt;
        setIsDirty(true);
      },
      [pointerToCanvas],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        const last = lastPtRef.current;
        if (!last) return; // pen isn't down
        const pt = pointerToCanvas(e.clientX, e.clientY);
        if (!pt) return;
        strokeSegment(ctx, last.x, last.y, pt.x, pt.y);
        lastPtRef.current = pt;
      },
      [pointerToCanvas],
    );

    const handlePointerUp = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        lastPtRef.current = null;
      },
      [],
    );

    const handleClear = useCallback(() => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      clearCanvas(ctx);
      lastPtRef.current = null;
      setIsDirty(false);
    }, []);

    const handleAdd = useCallback(() => {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (!canvas || !ctx) return;
      if (!isDirty) return; // nothing to submit
      const src = canvas.toDataURL("image/png");
      const entry: Doodle = { id: makeId(), src, at: Date.now() };
      setData((draft) => {
        draft.doodles.push(entry);
        // FIFO cap. Must use splice in mutator form — shift/pop are
        // not supported on Yjs mutator proxies (see docs/llm-prompting-guide.md).
        if (draft.doodles.length > MAX_DOODLES) {
          draft.doodles.splice(0, draft.doodles.length - MAX_DOODLES);
        }
      });
      clearCanvas(ctx);
      setIsDirty(false);
    }, [isDirty, setData]);

    const count = data.doodles.length;

    return (
      <div id={COMPONENT_ID} className="ph-smiley-row">
        <p className="ph-smiley-row__caption">
          Draw a tiny something. One color, 64×64. Newest on the right, max {MAX_DOODLES}.
        </p>

        <div className="ph-smiley-row__pad">
          <canvas
            ref={canvasRef}
            width={CANVAS_PX}
            height={CANVAS_PX}
            className="ph-smiley-row__canvas"
            aria-label="Draw a smiley"
            role="img"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <div className="ph-smiley-row__actions">
            <button
              type="button"
              className="ph-smiley-row__btn"
              onClick={handleClear}
              disabled={!isDirty}
            >
              Clear
            </button>
            <button
              type="button"
              className="ph-smiley-row__btn ph-smiley-row__btn--primary"
              onClick={handleAdd}
              disabled={!isDirty}
            >
              Add to row
            </button>
          </div>
        </div>

        <div
          ref={rowRef}
          className="ph-smiley-row__strip"
          aria-live="polite"
          aria-label={`Shared doodles, ${count} of ${MAX_DOODLES}`}
        >
          {count === 0 ? (
            <span className="ph-smiley-row__empty">
              No doodles yet — be the first.
            </span>
          ) : (
            data.doodles.map((d) => (
              <img
                key={d.id}
                src={d.src}
                alt=""
                className="ph-smiley-row__thumb"
                draggable={false}
              />
            ))
          )}
        </div>
      </div>
    );
  },
  { standalone: true },
);

export function SmileyRow(): React.ReactElement {
  return <SmileyRowInner />;
}
