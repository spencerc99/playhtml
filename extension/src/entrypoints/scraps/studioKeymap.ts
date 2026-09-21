// ABOUTME: Maps keyboard events in the collage studio to the command they invoke.
// ABOUTME: One place decides what a key does, so the studio itself stays declarative.

/** What the studio is in the middle of, which changes what a key means. */
export type StudioMode = "idle" | "crop" | "rotate" | "scale";

export type StudioCommand =
  | { kind: "delete" }
  | { kind: "duplicate" }
  | { kind: "copy" }
  | { kind: "paste" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "enterCrop" }
  | { kind: "beginRotate" }
  | { kind: "beginScale" }
  | { kind: "cutout" }
  | { kind: "flip"; axis: "x" | "y" }
  | { kind: "toggleDrawer" }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "deselect" }
  | { kind: "selectNext" }
  | { kind: "selectPrevious" }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "order"; to: "forward" | "backward" | "front" | "back" }
  | { kind: "showKeys" };

export interface KeyEventShape {
  key: string;
  /**
   * The physical key, which the bracket shortcuts match on: holding shift
   * turns `[` into `{`, so the printed character cannot identify them.
   */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** The element the event was aimed at, used to leave typing alone. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

export interface KeymapContext {
  mode: StudioMode;
  hasSelection: boolean;
  /** Whether anything is on the studio's own clipboard. */
  hasClipboard: boolean;
}

/** One frame unit per press, ten with shift, matching a nudge in any editor. */
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;

const ARROW_DELTAS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/**
 * Whether the event came from somewhere the user is typing. Shortcuts must
 * never fire over a title field or any other input.
 */
export function isTypingTarget(event: KeyEventShape): boolean {
  const target = event.target;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The command a key press invokes, or null when the studio does not own that
 * key and the browser should keep it.
 */
export function studioCommandFor(
  event: KeyEventShape,
  context: KeymapContext,
): StudioCommand | null {
  if (isTypingTarget(event)) return null;

  const accel = event.metaKey || event.ctrlKey;
  const { mode, hasSelection } = context;
  const transforming = mode === "rotate" || mode === "scale";

  // While a modal transform or a crop is running, it owns the few keys that
  // finish it and nothing else may interrupt.
  if (mode === "crop" || transforming) {
    if (event.key === "Escape") return { kind: "cancel" };
    if (event.key === "Enter") return { kind: "confirm" };
    if (transforming && event.key === "Shift") return null;
    return null;
  }

  if (accel) {
    // Shift turns `[` into `{`, so the brackets are matched by physical key
    // and only fall back to the character when no code is available.
    const bracket =
      event.code === "BracketRight" || (!event.code && event.key === "]")
        ? "right"
        : event.code === "BracketLeft" || (!event.code && event.key === "[")
          ? "left"
          : null;
    if (bracket) {
      if (!hasSelection) return null;
      if (bracket === "right") {
        return { kind: "order", to: event.shiftKey ? "front" : "forward" };
      }
      return { kind: "order", to: event.shiftKey ? "back" : "backward" };
    }

    switch (event.key.toLowerCase()) {
      case "z":
        return event.shiftKey ? { kind: "redo" } : { kind: "undo" };
      case "y":
        return { kind: "redo" };
      case "d":
        return hasSelection ? { kind: "duplicate" } : null;
      case "c":
        return hasSelection ? { kind: "copy" } : null;
      case "v":
        return context.hasClipboard ? { kind: "paste" } : null;
      default:
        return null;
    }
  }

  if (event.altKey) return null;

  const delta = ARROW_DELTAS[event.key];
  if (delta) {
    if (!hasSelection) return null;
    const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    return { kind: "nudge", dx: delta.dx * step, dy: delta.dy * step };
  }

  if (event.key === "Tab") {
    return event.shiftKey ? { kind: "selectPrevious" } : { kind: "selectNext" };
  }

  if (event.key === "Escape") return { kind: "deselect" };

  if (event.key === "Backspace" || event.key === "Delete") {
    return hasSelection ? { kind: "delete" } : null;
  }

  if (event.key === "Enter") {
    return hasSelection ? { kind: "enterCrop" } : null;
  }

  if (event.key === "?") return { kind: "showKeys" };

  if (event.shiftKey) return null;

  switch (event.key.toLowerCase()) {
    case "c":
      return hasSelection ? { kind: "enterCrop" } : null;
    case "r":
      return hasSelection ? { kind: "beginRotate" } : null;
    case "s":
      return hasSelection ? { kind: "beginScale" } : null;
    case "b":
      return hasSelection ? { kind: "cutout" } : null;
    case "h":
      return hasSelection ? { kind: "flip", axis: "x" } : null;
    case "v":
      return hasSelection ? { kind: "flip", axis: "y" } : null;
    case "\\":
      return { kind: "toggleDrawer" };
    default:
      return null;
  }
}

export interface ShortcutEntry {
  keys: string;
  what: string;
}

/** The list the keys popover shows, grouped the way a user would look for it. */
export const STUDIO_SHORTCUTS: { group: string; entries: ShortcutEntry[] }[] = [
  {
    group: "shape a piece",
    entries: [
      { keys: "double-click, enter, C", what: "crop" },
      { keys: "R", what: "rotate, then click to confirm" },
      { keys: "S", what: "scale, then click to confirm" },
      { keys: "B", what: "cut out the background" },
      { keys: "H / V", what: "flip across / flip down" },
      { keys: "shift while rotating", what: "snap to 15 degrees" },
      { keys: "shift on a corner", what: "free the aspect ratio" },
      { keys: "alt on a corner", what: "resize from the center" },
      { keys: "esc", what: "cancel what you started" },
    ],
  },
  {
    group: "arrange",
    entries: [
      { keys: "arrows", what: "nudge by one" },
      { keys: "shift + arrows", what: "nudge by ten" },
      { keys: "cmd + ] / [", what: "bring forward / send back" },
      { keys: "cmd + shift + ] / [", what: "bring to front / send to back" },
      { keys: "tab / shift + tab", what: "step through pieces" },
      { keys: "\\", what: "tuck the drawer away" },
    ],
  },
  {
    group: "edit",
    entries: [
      { keys: "cmd + D", what: "duplicate" },
      { keys: "alt-drag", what: "drag out a copy" },
      { keys: "cmd + C / V", what: "copy and paste" },
      { keys: "cmd + Z", what: "undo" },
      { keys: "cmd + shift + Z", what: "redo" },
      { keys: "delete", what: "remove" },
    ],
  },
];
