// ABOUTME: Custom React hooks for playhtml functionality
// ABOUTME: Provides hooks for accessing cursor presences and other playhtml features

import { useContext } from "react";
import { PlayContext } from "./PlayProvider";
import { CursorPresenceView } from "@playhtml/common";

/**
 * Hook to access cursor presences from the playhtml context
 * Returns a Map of stable ID -> CursorPresenceView
 */
export function useCursorPresences(): Map<string, CursorPresenceView> {
  const { cursorPresences } = useContext(PlayContext);
  return cursorPresences;
}
