// ABOUTME: Custom React hooks for playhtml functionality
// ABOUTME: Provides hooks for cursor presences, cursor zones, and other playhtml features

import { useContext, useEffect, RefObject } from "react";
import { PlayContext } from "./PlayProvider";
import { CursorPresenceView } from "@playhtml/common";
import type { CursorZoneOptions } from "playhtml";

/**
 * Hook to access cursor presences from the playhtml context
 * Returns a Map of stable ID -> CursorPresenceView
 */
export function useCursorPresences(): Map<string, CursorPresenceView> {
  const { cursorPresences } = useContext(PlayContext);
  return cursorPresences;
}

/**
 * Register an element as a cursor zone. When the local user's cursor enters
 * this element, other clients see the cursor positioned relative to their
 * own copy of the same element (matched by element id).
 */
export function useCursorZone(
  ref: RefObject<HTMLElement | null>,
  options?: CursorZoneOptions,
): void {
  const { registerCursorZone, unregisterCursorZone } = useContext(PlayContext);

  useEffect(() => {
    const element = ref.current;
    if (!element || !element.id) return;

    registerCursorZone(element, options);

    return () => {
      unregisterCursorZone(element.id);
    };
  }, [ref.current, ref.current?.id]);
}
