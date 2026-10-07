// ABOUTME: Controls the local Internet Commute debug panel visibility.
// ABOUTME: Supports the admin query parameter and archive-style double-D shortcut.

import { useEffect, useState } from "react";

const DOUBLE_TAP_THRESHOLD_MS = 300;

export function hasCommuteAdminQuery(search: string): boolean {
  return new URLSearchParams(search).has("admin");
}

export function useCommuteDebug(
  search: string = window.location.search,
): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState(() => hasCommuteAdminQuery(search));

  useEffect(() => {
    let lastDKeyTime = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const element = target instanceof HTMLElement ? target : null;
      const tag = element?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || element?.isContentEditable) {
        return;
      }
      if (event.key !== "d" && event.key !== "D") return;

      const now = Date.now();
      if (now - lastDKeyTime < DOUBLE_TAP_THRESHOLD_MS) {
        setVisible((current) => !current);
        lastDKeyTime = 0;
        return;
      }
      lastDKeyTime = now;
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return [visible, setVisible];
}
