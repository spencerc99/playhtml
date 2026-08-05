// ABOUTME: Shadow-DOM React root that positions and renders bottles for the extension.
// ABOUTME: Tracks each bottle's page anchor across scroll/resize; forwards seal events to the manager.

import { useEffect, useRef, useState } from "react";
import { MessageBottle } from "./MessageBottle";
import type { BottleAnchor } from "../features/bottle-anchor";
import { resolveBottlePosition } from "../features/bottle-anchor";
import type { RenderedBottle } from "../features/BottleManager";

interface BottleOverlayProps {
  bottles: RenderedBottle[];
  onSeal: (
    bottleId: string,
    text: string,
    anchor: BottleAnchor,
    meta: { authorName?: string; styleId?: string },
  ) => void;
  onOpened: (bottleId: string) => void;
  onClosed: (bottleId: string) => void;
  /** A just-placed bottle was closed without a note being sealed — the manager
   *  drops it (the user "took it back"). */
  onDismissPlaced: (bottleId: string) => void;
  /** A bottle's anchor element is genuinely gone from the DOM (not merely
   *  scrolled off-screen) — lets the manager re-place a cached empty bottle
   *  rather than letting it silently vanish. */
  onAnchorLost: (bottleId: string) => void;
  /** Shadow root used as the portal target for the open dialog. */
  portalContainer: Element | null;
}

interface ResolvedBottleSlot extends RenderedBottle {
  x: number;
  y: number;
  rotate: number;
}

export function BottleOverlay({
  bottles,
  onSeal,
  onOpened,
  onClosed,
  onDismissPlaced,
  onAnchorLost,
  portalContainer,
}: BottleOverlayProps) {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Re-resolve positions on scroll/resize/layout mutations, throttled via rAF.
  // Also re-tick periodically for the first few seconds in case content
  // loads in (images, lazy DOM) and shifts anchor positions.
  useEffect(() => {
    const onChange = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setTick((t) => t + 1);
      });
    };
    window.addEventListener("scroll", onChange, { passive: true });
    window.addEventListener("resize", onChange);

    // Layout-shift observer: re-resolve when major DOM changes happen.
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && document.body) {
      mo = new MutationObserver(() => onChange());
      mo.observe(document.body, {
        childList: true,
        subtree: true,
        // Skip attribute/character changes to keep it cheap
      });
    }

    // Belt-and-suspenders periodic re-ticks during the first 6s after
    // mount — covers cases where MutationObserver fires before layout
    // settles or where images load asynchronously.
    const intervals = [500, 1500, 3000, 6000].map((ms) =>
      setTimeout(onChange, ms),
    );

    return () => {
      window.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
      if (mo) mo.disconnect();
      for (const t of intervals) clearTimeout(t);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Each bottle is pinned to a page spot (its anchor), so its viewport
  // position is recomputed every tick to follow that spot as the page
  // scrolls — this is the bottle "staying put on the page," not a re-pick.
  // resolveBottlePosition only returns null when the anchor element itself
  // is gone (not merely off-screen), so scrolling never drops a bottle here.
  const resolved: ResolvedBottleSlot[] = [];
  const lost: string[] = [];
  for (const b of bottles) {
    const pos = resolveBottlePosition(b.anchor);
    if (!pos) {
      lost.push(b.id);
      continue;
    }
    resolved.push({ ...b, x: pos.x, y: pos.y, rotate: pos.rotate });
  }

  // Notify the manager of bottles whose anchor element was actually removed
  // from the DOM (after the commit, not during render) so it can re-place a
  // cached empty bottle.
  const lostKey = lost.join(",");
  useEffect(() => {
    for (const id of lost) onAnchorLost(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lostKey]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2147483645,
      }}
      data-tick={tick}
    >
      {resolved.map((slot) => (
        <div
          key={slot.id}
          style={{
            position: "fixed",
            left: `${slot.x}px`,
            top: `${slot.y}px`,
            transform: "translate(-50%, -50%)",
            pointerEvents: "auto",
          }}
        >
          <MessageBottle
            notes={slot.isEmpty ? [] : slot.notes ?? []}
            authorColor={slot.authorColor}
            canReply={slot.canReply}
            justPlaced={slot.justPlaced}
            onSeal={(text, meta) => onSeal(slot.id, text, slot.anchor, meta)}
            onOpened={() => onOpened(slot.id)}
            onClosed={() => onClosed(slot.id)}
            onDismissPlaced={() => onDismissPlaced(slot.id)}
            rotateDeg={slot.rotate}
            portalContainer={portalContainer}
          />
        </div>
      ))}
    </div>
  );
}
