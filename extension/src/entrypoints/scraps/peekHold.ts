// ABOUTME: Decides when the studio shows the source tags pinned to every piece.
// ABOUTME: A held key, so the rules for repeat, release, blur and typing live in one place.

/** The key held down to read where each piece came from. */
export const PEEK_KEY = "i";

export interface PeekState {
  /** Whether the tags are on screen right now. */
  held: boolean;
}

export type PeekEvent =
  | {
      kind: "keyDown";
      key: string;
      /** An auto-repeat from a key already down, which must change nothing. */
      repeat: boolean;
      metaKey: boolean;
      ctrlKey: boolean;
      altKey: boolean;
      /** True while the person is typing, which makes the key inert. */
      typing: boolean;
      /** True during a crop session or a modal transform. */
      modeActive: boolean;
    }
  | { kind: "keyUp"; key: string }
  | { kind: "windowBlur" }
  | { kind: "pageHidden" };

export function createPeekState(): PeekState {
  return { held: false };
}

function isPeekKey(key: string): boolean {
  return key.toLowerCase() === PEEK_KEY;
}

/**
 * Advances the peek. Everything that could strand the tags on screen — a
 * release, the window losing focus, the tab going away — puts them back down.
 */
export function stepPeek(state: PeekState, event: PeekEvent): PeekState {
  switch (event.kind) {
    case "keyDown": {
      if (!isPeekKey(event.key)) return state;
      // An accelerator is somebody else's shortcut, and typing an "i" into the
      // title is not a request to peek.
      if (event.metaKey || event.ctrlKey || event.altKey) return state;
      if (event.typing || event.modeActive) return state;
      // A held key repeats; the tags are already up and nothing should flicker.
      if (event.repeat) return state;
      return state.held ? state : { held: true };
    }
    case "keyUp":
      if (!isPeekKey(event.key)) return state;
      return state.held ? { held: false } : state;
    case "windowBlur":
    case "pageHidden":
      return state.held ? { held: false } : state;
  }
}
