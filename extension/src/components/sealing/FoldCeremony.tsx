// ABOUTME: Sealing ceremony — the real letter-scroll DOM folds accordion-style at its perforation
// ABOUTME: seams into a small packet, which then flips to the bottle card and tucks through the slot.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BottleNote } from "../../features/BottleManager";
import { LetterSegment } from "../bottle/LetterSegment";
import { segmentStyle } from "../bottle/segmentStyles";
import {
  CARD_H_PX,
  CARD_W_PX,
  T_FISSURE_CLOSE,
  createSlotFissure,
  createSlotCover,
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
const HOLD_MS = 420;
const FOLD_MS = 720;
const STAGGER_MS = 320;
const SETTLE_MS = 320;
const FLIP_MS = 1100;
// The final plunge: the sealed bottle sinks into the page through the slot,
// bottom edge first, after the flip lands it upright over the hole.
const PLUNGE_MS = 900;
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
  // The folded-letter-card skin overlaid on the packet's face. It fades in as
  // the flip lands so the object that plunges into the slot matches the resting
  // on-page capsule (a folded note), with no pop from readable-letter to card.
  const cardSkinRef = useRef<HTMLDivElement>(null);
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
    const rootEl = rootRef.current;
    if (!container || !rootEl) return;
    // Bound non-null so the deferred fold closures keep the narrowing.
    const root: HTMLDivElement = rootEl;
    const containerEl: HTMLDivElement = container;

    const fissure = createSlotFissure(containerEl, slotX, slotY);
    // The below-slot cover is created lazily at plunge time (it would otherwise
    // hide the fold/flip that plays centered on screen). Tracked here so cleanup
    // can always remove it.
    let slotCover: { dispose: () => void } | null = null;

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
    // bottom seam, laying it flat down onto the note beneath it. The fold goes
    // AWAY from the viewer (rotateX +180) so folded notes stack BEHIND the face
    // plane: the newest letter (the face) stays the visible top surface of the
    // sealed packet, older notes tuck under/behind it. Because the chain is
    // nested (each note is the PARENT of the note below), a note's fold carries
    // its whole folded tail with it — it reads as one contiguous sheet closing
    // crease by crease. The face never transforms.
    const foldSegs = [...segRefs.current].reverse();

    // The older notes stack UPWARD from the fixed face, so the top of the scroll
    // (where folding begins) starts above the viewport — it would look like
    // nothing is happening. Pan the whole chain: start with the TOP of the stack
    // centered, then translate down over the fold so the view follows the crease
    // travelling down to the face. Pan distance = the stack's height above the
    // face. The face lands back at its resting (centered) spot as the fold ends.
    const panBy = above.length * SEG_H_PX;
    const foldWindow =
      foldSegs.length > 0 ? (foldSegs.length - 1) * STAGGER_MS + FOLD_MS : 0;

    later(startFold, HOLD_MS);

    function startFold() {
      if (disposed) return;
      // Pan the chain down from "top centered" to "face centered", tracking the
      // crease as it travels down. The face is flex-centered by .mbf-ceremony,
      // so the pan is a plain translateY: start shifted DOWN by the stack height
      // (bringing the top of the scroll to center), end at 0 (face centered).
      // Runs across the whole fold window.
      if (panBy > 0) {
        track(
          root.animate(
            [
              { transform: `translateY(${panBy}px)` },
              { transform: "translateY(0px)" },
            ],
            {
              duration: foldWindow,
              easing: FOLD_EASE,
              fill: "forwards",
            },
          ),
        );
      }
      let lastEnd = 0;
      foldSegs.forEach((seg, order) => {
        if (!seg) return;
        const delay = order * STAGGER_MS;
        track(
          seg.animate(
            [
              { transform: "rotateX(0deg)" },
              { transform: "rotateX(180deg)" },
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
    // flips 90deg (rotateZ) into the portrait bottle card and lands upright with
    // its BOTTOM edge resting on the slot line. BEAT 4 then plunges it down
    // through the fissure, bottom-first, into the page. Two moves so the final
    // sink into the hole reads clearly instead of just fading away.
    function flipAndTuck() {
      if (disposed) return;
      const face = rootRef.current;
      if (!face) return;
      const faceRect = face.getBoundingClientRect();
      const faceCx = faceRect.left + faceRect.width / 2;
      const faceCy = faceRect.top + faceRect.height / 2;

      // The folded packet is a wide card (SEG_W wide, SEG_H tall). Rotating it
      // 90deg makes it tall+narrow; scale so its footprint reads as the portrait
      // bottle card (CARD_W x CARD_H, a tall ~1:2). After the quarter turn the
      // packet's on-screen width is SEG_H*scale and its height is SEG_W*scale.
      const flipScale = Math.min(CARD_H_PX / SEG_W_PX, CARD_W_PX / SEG_H_PX);
      const cardH = SEG_W_PX * flipScale; // upright card height after the flip

      // Land the card so its BOTTOM edge sits on the slot line: the card center
      // ends half its height ABOVE the slot. dx/dy carry the (still-centered)
      // packet there.
      const dx = slotX - faceCx;
      const dyLand = slotY - cardH / 2 - faceCy;

      fissure.open();

      // Beat 3: flip in place, then travel to land upright above the slot.
      const flip = track(
        face.animate(
          [
            { transform: "rotateZ(0deg) scale(1)", offset: 0 },
            { transform: "rotateZ(90deg) scale(0.9)", offset: 0.45 },
            {
              transform: `translate(${dx}px, ${dyLand}px) rotateZ(90deg) scale(${flipScale})`,
              offset: 1,
            },
          ],
          {
            duration: FLIP_MS,
            easing: "cubic-bezier(0.4, 0, 0.3, 1)",
            fill: "forwards",
          },
        ),
      );

      // Cross-fade the readable packet face into the folded-letter-card skin
      // over the back half of the flip, so by the time it lands upright over the
      // slot it reads as the same folded note the resting capsule shows. The
      // skin then plunges with the packet.
      const skin = cardSkinRef.current;
      if (skin) {
        track(
          skin.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], {
            duration: FLIP_MS,
            easing: "ease-in",
            fill: "forwards",
          }),
        );
      }

      flip.finished
        .catch(() => {})
        .finally(() => {
          if (disposed) return;
          plunge(dx, dyLand, flipScale, cardH);
        });
    }

    // BEAT 4: the upright bottle card sinks into the page through the slot,
    // bottom edge first. It descends straight DOWN in world space; the part that
    // crosses below the slot line is hidden by a cover pinned along the slot, so
    // it reads as sinking THROUGH the hole rather than sliding past it. The
    // fissure closes behind it, then complete.
    function plunge(
      dx: number,
      dyLand: number,
      flipScale: number,
      cardH: number,
    ) {
      const face = rootRef.current;
      if (!face) return;
      // Pin the below-slot cover now, along the slot line, so the descending
      // card is swallowed as its bottom crosses through.
      slotCover = createSlotCover(containerEl, slotX, slotY, cardH);
      const rotatedCard = `rotateZ(90deg) scale(${flipScale})`;
      const base = `translate(${dx}px, ${dyLand}px) ${rotatedCard}`;
      // Descend in WORLD space: put the downward translate FIRST (before the
      // rotateZ), so it moves the card straight down on screen. A translateY
      // applied AFTER rotateZ(90) would move along the card's rotated local axis
      // — i.e. sideways in the world — which slid the card left instead of down.
      const sink = cardH + 8; // full card height past the slot line, in world px
      const sunk = `translate(${dx}px, ${dyLand + sink}px) ${rotatedCard}`;
      track(
        face.animate(
          [
            { transform: base, opacity: 1, offset: 0 },
            { transform: sunk, opacity: 0.9, offset: 0.85 },
            { transform: sunk, opacity: 0.4, offset: 1 },
          ],
          {
            duration: PLUNGE_MS,
            easing: "cubic-bezier(0.5, 0, 0.8, 0.5)",
            fill: "forwards",
          },
        ),
      );

      // Close the fissure as the card finishes sinking, then complete.
      later(() => {
        if (disposed) return;
        fissure.close();
      }, Math.round(PLUNGE_MS * 0.7));

      later(onComplete, PLUNGE_MS + T_FISSURE_CLOSE + 60);
    }

    return () => {
      disposed = true;
      for (const t of timers) clearTimeout(t);
      for (const a of runningAnimations) a.cancel();
      fissure.dispose();
      slotCover?.dispose();
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
        {/* The underside carries this note's own paper style (same ground class
            as the front's segment) so when it folds past 90deg you see its
            paper — matching how a real letter's back is the same sheet — not a
            generic blank. Comeau's fold shows the reverse of the same surface. */}
        <div
          className={`mbf-segBack ${segmentStyle(note.styleId).className}`}
          aria-hidden="true"
        />
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
        style={{
          width: `${SEG_W_PX}px`,
          height: `${SEG_H_PX}px`,
          // Start panned DOWN by the stack height so the TOP of the scroll is
          // centered at the opening — the fold begins in view. The pan animates
          // back to 0 as the crease travels down (see startFold). Without notes
          // above the face, no pan is needed.
          transform: above.length > 0 ? `translateY(${above.length * SEG_H_PX}px)` : undefined,
        }}
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
        {/* The folded-letter-card skin — covers the packet's face, faded in as
            the flip lands so the sealed object reads as the same folded note the
            resting on-page capsule shows. It travels + plunges with the packet
            (a child of the root). */}
        <div
          ref={cardSkinRef}
          className="mbf-cardSkin"
          style={{ height: `${SEG_H_PX}px` }}
          aria-hidden="true"
        >
          <span className="mbf-cardSkinCrease mbf-cardSkinCrease1" />
          <span className="mbf-cardSkinCrease mbf-cardSkinCrease2" />
        </div>
      </div>
    </div>
  );
}
