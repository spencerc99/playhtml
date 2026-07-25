// ABOUTME: Double-press "d" toggles a boolean for hiding page chrome (title, status,
// ABOUTME: controls) so the trail canvas can be captured or watched unobstructed

import { useEffect, useState } from "react";

// Mirrors the movement page's double-tap "d" shortcut
// (shared/components/MovementCanvas.tsx) — same key and timing window.
const DOUBLE_TAP_THRESHOLD = 300;

export function useChromeToggle(): boolean {
  const [chromeHidden, setChromeHidden] = useState(false);

  useEffect(() => {
    let lastDKeyTime = 0;

    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }

      if (e.key === "d" || e.key === "D") {
        const now = Date.now();
        if (now - lastDKeyTime < DOUBLE_TAP_THRESHOLD) {
          setChromeHidden((prev) => !prev);
          lastDKeyTime = 0;
        } else {
          lastDKeyTime = now;
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

  return chromeHidden;
}
