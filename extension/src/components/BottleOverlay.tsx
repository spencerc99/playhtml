// ABOUTME: Shadow-DOM React root that positions and renders bottles for the extension.
// ABOUTME: Re-resolves anchor positions on scroll/resize; forwards seal events to the manager.

import { useEffect, useRef, useState } from "react";
import { MessageBottle } from "./MessageBottle";
import type { BottleAnchor } from "../features/bottle-anchor";
import { resolveBottlePosition } from "../features/bottle-anchor";
import type { RenderedBottle } from "../features/BottleManager";

interface BottleOverlayProps {
  bottles: RenderedBottle[];
  onSeal: (bottleId: string, text: string, anchor: BottleAnchor) => void;
  onOpened: (bottleId: string) => void;
  onClosed: (bottleId: string) => void;
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

  const resolved: ResolvedBottleSlot[] = [];
  for (const b of bottles) {
    const pos = resolveBottlePosition(b.anchor);
    if (!pos) continue;
    resolved.push({ ...b, x: pos.x, y: pos.y, rotate: pos.rotate });
  }

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
            onSeal={(text) => onSeal(slot.id, text, slot.anchor)}
            onOpened={() => onOpened(slot.id)}
            onClosed={() => onClosed(slot.id)}
            rotateDeg={slot.rotate}
            portalContainer={portalContainer}
          />
        </div>
      ))}
    </div>
  );
}
