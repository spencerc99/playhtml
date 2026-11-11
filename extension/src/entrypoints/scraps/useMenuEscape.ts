// ABOUTME: Closes an open studio menu or popover on Escape, and keeps that press from the studio.
// ABOUTME: Without it, the same Escape would also deselect pieces or cancel a crop behind the menu.

import { useEffect, useRef } from "react";

/**
 * While `open`, an Escape press runs `onEscape` and goes no further. The
 * listener captures on the window, which reaches it before the studio's own
 * keydown handler, and stops it there.
 */
export function useMenuEscape(open: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onEscapeRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);
}
