// ABOUTME: Sealing ceremony — the real letter-scroll DOM folds accordion-style at its perforation
// ABOUTME: seams into a small packet, which then flips to the bottle card and tucks through the slot.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BottleNote } from "../../features/BottleManager";
import { LetterSegment } from "../bottle/LetterSegment";
import {
  CARD_H_PX,
  CARD_W_PX,
  T_FISSURE_CLOSE,
  createSlotFissure,
  type SealingProps,
} from "./common";

// Each segment is a fixed-height window onto its letter — tall enough to show the
// opening lines plus the perforation seam, short enough that the whole packet
// stays on screen no matter how long a letter is (the reader already read the
// full letters on the scroll). The newest letter is the face; older notes stack
// upward from it and fold down onto it one crease at a time.
const SEG_H_PX = 132;
const SEG_W_PX = 320;

// Fold timing. Folds run TOP-DOWN: the oldest/topmost note creases first, then
// each note below it in sequence. Each fold is FOLD_MS; note i+1 starts
// STAGGER_MS after note i, so the crease travels down the stack toward the face.
// A short hold first lets the fresh stamp register before the paper moves.
const HOLD_MS = 320;
const FOLD_MS = 520;
const STAGGER_MS = 200;
const SETTLE_MS = 240;
const FLIP_MS = 1400;
const FOLD_EASE = "cubic-bezier(0.5, 0, 0.2, 1)";

export function FoldCeremony({
  slotX,
  slotY,
  notes,
  newNote,
  onFirstFrame,
  onComplete,
}: SealingProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Refs to the foldable segments, ordered face-adjacent first (index 0 is the
  // note directly above the face) up to the oldest (highest on screen). The face
  // is not foldable and is not in this list.
  const segRefs = useRef<(HTMLDivElement | null)[]>([]);

  // The full ordered set (oldest first) plus the freshly stamped note last. The
  // last entry is the face. Rendered with the same LetterSegment the scroll uses
  // so the type, sign-off, fingerprint, and date imprint are the real thing.
  const [chain] = useState<BottleNote[]>(() => {
    const prev = notes ?? [];
    return newNote ? [...prev, newNote] : [...prev];
  });

  // The notes above the face, ordered face-adjacent first. This is the fold
  // order (nearest the face folds last). The nesting in the render goes the
  // other way: face is the root, the note above it is its child, and so on up.
  const above = useMemo(() => chain.slice(0, -1).reverse(), [chain]);

  // Fire onFirstFrame once the chain has mounted and painted, so the parent hides
  // the DOM scroll only after this fold chain is on screen in its place (no blank
  // gap, no jump).
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
    const root = rootRef.current;
    if (!container || !root) return;

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

    // segRefs is ordered face-adjacent first; folding must go top-down (oldest
    // first), so we walk it in reverse. Each note folds 180deg about its own
    // bottom seam, laying it flat down onto the note beneath it. Because the
    // chain is nested (each note is the PARENT of the note below), a note's fold
    // carries its whole folded tail down with it — it reads as one contiguous
    // sheet closing crease by crease. The face never transforms.
    const foldSegs = [...segRefs.current].reverse();

    later(startFold, HOLD_MS);

    function startFold() {
      if (disposed) return;
      let lastEnd = 0;
      foldSegs.forEach((seg, order) => {
        if (!seg) return;
        const delay = order * STAGGER_MS;
        track(
          seg.animate(
            [
              { transform: "rotateX(0deg)" },
              { transform: "rotateX(-180deg)" },
            ],
            {
              duration: FOLD_MS,
              delay,
              easing: FOLD_EASE,
              fill: "forwards",
            },
          ),
        );
        lastEnd = delay + FOLD_MS;
      });
      later(flipAndTuck, lastEnd + SETTLE_MS);
    }

    // BEAT 3: the folded packet — now a compact wide card where the face sits —
    // flips 90deg (rotateZ) into the portrait bottle card, then travels to the
    // slot, shrinking + fading through the fissure. The flip pivots on the face
    // center so the packet stays put as it rotates.
    function flipAndTuck() {
      if (disposed) return;
      const face = rootRef.current;
      if (!face) return;
      const faceRect = face.getBoundingClientRect();
      const faceCx = faceRect.left + faceRect.width / 2;
      const faceCy = faceRect.top + faceRect.height / 2;
      const dx = slotX - faceCx;
      const dy = slotY - faceCy;

      // The folded packet is a wide card (SEG_W wide, SEG_H tall). Rotating it
      // 90deg makes it tall+narrow; scale so its footprint reads as the portrait
      // bottle card (CARD_W x CARD_H, a tall ~1:2). Scale to fit within that
      // footprint after the quarter turn (width maps to CARD_H, height to
      // CARD_W).
      const flipScale = Math.min(CARD_H_PX / SEG_W_PX, CARD_W_PX / SEG_H_PX);

      fissure.open();

      const flip = track(
        face.animate(
          [
            {
              transform: "rotateZ(0deg) scale(1)",
              opacity: 1,
              offset: 0,
            },
            {
              transform: "rotateZ(90deg) scale(0.86)",
              opacity: 1,
              offset: 0.4,
            },
            {
              transform: "rotateZ(90deg) scale(0.86)",
              opacity: 1,
              offset: 0.54,
            },
            {
              transform: `translate(${dx}px, ${dy}px) rotateZ(90deg) scale(${flipScale})`,
              opacity: 0.16,
              offset: 1,
            },
          ],
          {
            duration: FLIP_MS,
            easing: "cubic-bezier(0.5, 0, 0.7, 0.4)",
            fill: "forwards",
          },
        ),
      );

      // Close the fissure as the packet finishes sinking, then complete.
      later(() => {
        if (disposed) return;
        fissure.close();
      }, Math.round(FLIP_MS * 0.82));

      flip.finished
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

  // Build the nested chain from the FACE outward: the face is the root/anchor,
  // the note directly above it is its child (positioned bottom-flush against the
  // face's top edge), the note above THAT nests inside it, and so on up to the
  // oldest (deepest child, highest on screen). Each non-face note hinges at its
  // own bottom seam and folds down onto the note it sits on.
  //
  // `above` is ordered face-adjacent first, so we recurse into it from index 0.
  // segRefs collects the foldable notes in that same order (face-adjacent
  // first).
  segRefs.current = [];
  const buildAbove = (depth: number): JSX.Element | null => {
    if (depth >= above.length) return null;
    const note = above[depth];
    const refIndex = depth;
    return (
      <div
        ref={(el) => {
          segRefs.current[refIndex] = el;
        }}
        className="mbf-seg"
        style={{
          height: `${SEG_H_PX}px`,
          // Hinge at this note's bottom edge — the perforation it shares with
          // the note directly below it. Folding rotates about that seam.
          transformOrigin: "center bottom",
        }}
      >
        <div className="mbf-segFront">
          <div className="mbf-segInner">
            <LetterSegment note={note} />
          </div>
        </div>
        <div className="mbf-segBack" aria-hidden="true" />
        {buildAbove(depth + 1)}
      </div>
    );
  };

  const faceNote = chain[chain.length - 1];

  return (
    <div ref={containerRef} className="mbf-ceremony">
      <div
        ref={rootRef}
        className="mbf-root"
        style={{ width: `${SEG_W_PX}px`, height: `${SEG_H_PX}px` }}
      >
        {/* The face — the freshly stamped letter. It is the fixed base; it never
            transforms during the fold. The older notes nest above it and fold
            down onto it. */}
        <div className="mbf-face" style={{ height: `${SEG_H_PX}px` }}>
          <div className="mbf-segFront">
            <div className="mbf-segInner">
              {faceNote ? <LetterSegment note={faceNote} /> : null}
            </div>
          </div>
        </div>
        {buildAbove(0)}
      </div>
    </div>
  );
}
