// ABOUTME: Sealing ceremony — the real letter-scroll DOM folds accordion-style at its perforation
// ABOUTME: seams into a small packet, which then drops and tucks through the page slot fissure.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BottleNote } from "../../features/BottleManager";
import { LetterSegment } from "../bottle/LetterSegment";
import {
  CARD_W_PX,
  T_FISSURE_CLOSE,
  createSlotFissure,
  type SealingProps,
} from "./common";

// Each folded panel is a fixed, compact height so the whole packet stays on
// screen no matter how long a letter is (the sheet's own content is clipped to
// this window during the fold — the reader already read it on the scroll). The
// new letter sits at the bottom as the packet's face; the earlier letters fold
// down onto it note-by-note.
const PANEL_H_PX = 132;
// The strip renders at the same width as the on-page scroll so fonts and layout
// match what the reader was just looking at (see .mbs-strip in the SCSS).
const STRIP_W_PX = 320;

// Fold timing. Each panel's fold is FOLD_MS long; panel i starts STAGGER_MS
// after panel i-1, so the crease travels down the stack note-by-note. A short
// hold first lets the fresh stamp register before the paper starts moving.
const HOLD_MS = 300;
const FOLD_MS = 420;
const STAGGER_MS = 150;
const SETTLE_MS = 220;
const DROP_MS = 900;
const EASE = "cubic-bezier(0.4, 0.0, 0.2, 1)";

export function FoldCeremony({
  slotX,
  slotY,
  notes,
  newNote,
  onFirstFrame,
  onComplete,
}: SealingProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);

  // The panels: every existing letter (oldest first) plus the freshly stamped
  // one at the bottom. Rendered with the same LetterSegment component the scroll
  // uses, so the type, sign-off, fingerprint, and date imprint are the real
  // thing (no raster).
  const [panels] = useState<BottleNote[]>(() => {
    const prev = notes ?? [];
    return newNote ? [...prev, newNote] : [...prev];
  });

  // Fire onFirstFrame once the strip has mounted and painted, so the parent
  // hides the DOM scroll beneath only after this fold strip is on screen in its
  // place (no blank gap, no jump).
  const firstFrameFired = useRef(false);
  useLayoutEffect(() => {
    if (firstFrameFired.current) return;
    firstFrameFired.current = true;
    const id = requestAnimationFrame(() => onFirstFrame?.());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const stripEl = stripRef.current;
    if (!container || !stripEl) return;
    // Bound non-null so the nested fold/drop closures don't re-widen the ref.
    const strip: HTMLDivElement = stripEl;

    const fissure = createSlotFissure(container, slotX, slotY);

    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const runningAnimations: Animation[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };
    const track = (a: Animation): Animation => {
      runningAnimations.push(a);
      return a;
    };

    const count = panels.length;
    // The bottom (newest) panel is the packet's face and never folds. Everything
    // above it collapses down onto it, from the top.
    const foldable = Math.max(0, count - 1);

    // Center the packet where the strip already sits. The strip is absolutely
    // stacked, so folding a panel doesn't reflow its neighbors — the geometry is
    // fully deterministic (each panel at y = index * PANEL_H_PX).
    // As panels fold away the packet shrinks toward the bottom face; we ease the
    // whole strip upward by half a panel per fold so the shrinking packet stays
    // visually centered rather than drifting.

    // Kick the accordion off after the hold. Fold from the top down: panel 0
    // folds first, hinged at its BOTTOM edge (the perforation with panel 1),
    // rotating DOWN and away so it lies against the sheet below. Alternate the
    // fold direction per panel so the stack zig-zags into a compact packet.
    later(startFold, HOLD_MS);

    function startFold() {
      if (disposed) return;
      for (let i = 0; i < foldable; i++) {
        const panel = panelRefs.current[i];
        if (!panel) continue;
        const delay = i * STAGGER_MS;
        // Alternate hinge direction: even panels crease backward (away from the
        // viewer), odd panels crease forward, so the folds nest like a fan.
        const dir = i % 2 === 0 ? 1 : -1;
        track(
          panel.animate(
            [
              { transform: "rotateX(0deg)", offset: 0 },
              { transform: `rotateX(${dir * 88}deg)`, offset: 1 },
            ],
            {
              duration: FOLD_MS,
              delay,
              easing: EASE,
              fill: "forwards",
            },
          ),
        );
      }

      // As the top panels lie down, lift the strip so the collapsing packet
      // holds its center. The face panel ends up occupying the strip's bottom;
      // shifting up by (foldable * PANEL_H / 2) recenters that face.
      const lift = (foldable * PANEL_H_PX) / 2;
      const foldWindow = foldable > 0 ? (foldable - 1) * STAGGER_MS + FOLD_MS : 0;
      track(
        strip.animate(
          [
            { transform: "translateY(0px)" },
            { transform: `translateY(${-lift}px)` },
          ],
          {
            duration: Math.max(foldWindow, 1),
            easing: EASE,
            fill: "forwards",
          },
        ),
      );

      later(dropIntoSlot, foldWindow + SETTLE_MS);
    }

    // The folded packet drops toward the slot and tucks through the fissure —
    // the same "plunge into the page" ending the WebGL ceremony had, done as a
    // CSS transform on the real strip. We measure the packet's current on-screen
    // center (the bottom face panel) and animate a translate that lands it on
    // the slot, shrinking + fading as it sinks below the seam.
    function dropIntoSlot() {
      if (disposed) return;
      const face = panelRefs.current[count - 1] ?? strip;
      const faceRect = face.getBoundingClientRect();
      const faceCx = faceRect.left + faceRect.width / 2;
      const faceCy = faceRect.top + faceRect.height / 2;
      const dx = slotX - faceCx;
      const dy = slotY - faceCy;

      fissure.open();

      // The strip is already lifted by the fold animation; compose the drop on
      // top by animating the strip's own transform from its post-fold state to
      // the slot. We read the committed post-fold transform so the drop starts
      // exactly where the fold left off (no snap-back to origin).
      const postFold = getComputedStyle(strip).transform;
      const base = postFold === "none" ? "" : `${postFold} `;
      const target =
        `${base}translate(${dx}px, ${dy}px) scale(${CARD_W_PX / STRIP_W_PX})`;

      const drop = track(
        strip.animate(
          [
            { transform: postFold === "none" ? "translate(0,0)" : postFold, opacity: 1 },
            { transform: target, opacity: 0.15, easing: "cubic-bezier(0.55,0,0.85,0.35)" },
          ],
          { duration: DROP_MS, fill: "forwards" },
        ),
      );

      // Close the fissure as the packet finishes sinking, then complete.
      later(() => {
        if (disposed) return;
        fissure.close();
      }, Math.round(DROP_MS * 0.82));

      drop.finished
        .catch(() => {})
        .finally(() => {
          if (disposed) return;
          later(onComplete, T_FISSURE_CLOSE + 60);
        });
    }

    return () => {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      for (const a of runningAnimations) a.cancel();
      fissure.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className="mbf-ceremony">
      <div
        ref={stripRef}
        className="mbf-strip"
        style={{
          width: `${STRIP_W_PX}px`,
          height: `${panels.length * PANEL_H_PX}px`,
          // Transform-origin at the FACE panel's center so the lift + drop
          // scale shrink the packet toward its face — keeping the face pinned on
          // the slot as it tucks in, rather than drifting toward the strip
          // center.
          transformOrigin: `${STRIP_W_PX / 2}px ${
            (panels.length - 0.5) * PANEL_H_PX
          }px`,
        }}
      >
        {panels.map((note, i) => {
          const isFace = i === panels.length - 1;
          return (
            <div
              key={i}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              className={`mbf-panel${isFace ? " mbf-panelFace" : ""}`}
              style={{
                top: `${i * PANEL_H_PX}px`,
                height: `${PANEL_H_PX}px`,
                // The crease hinge is the panel's bottom edge — the perforation
                // it shares with the sheet below. Folding rotates about that
                // seam so the note pivots down onto its neighbor.
                transformOrigin: "center bottom",
                zIndex: panels.length - i,
              }}
            >
              <div className="mbf-panelInner">
                <LetterSegment note={note} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
