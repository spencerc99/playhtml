// ABOUTME: Maps keyboard events in the collage studio to the command they invoke.
// ABOUTME: One place decides what a key does, so the studio itself stays declarative.

/**
 * What the studio is in the middle of, which changes what a key means. "back"
 * is the collage turned over to read its sources.
 */
export type StudioMode = "idle" | "crop" | "rotate" | "scale" | "back";

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
  /** Steps into a pile: the piece one below or above in the stacking order. */
  | { kind: "selectInStack"; direction: "below" | "above" }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "order"; to: "forward" | "backward" | "front" | "back" }
  | { kind: "showKeys" }
  /** Turns the collage over to its back, or face up again. */
  | { kind: "turnOver" };

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
  target?: {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  } | null;
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
 * Marks a control, such as the drawer's filters, that handles its own keys:
 * Tab, Enter and Escape there move focus or close a popover, never the studio.
 */
export const OWNS_KEYS_SELECTOR = "[data-owns-keys]";

/** Whether the studio should leave this key press to the page entirely. */
export function leavesKeysAlone(event: KeyEventShape): boolean {
  return (
    isTypingTarget(event) ||
    Boolean(event.target?.closest?.(OWNS_KEYS_SELECTOR))
  );
}

/**
 * The command a key press invokes, or null when the studio does not own that
 * key and the browser should keep it.
 */
export function studioCommandFor(
  event: KeyEventShape,
  context: KeymapContext,
): StudioCommand | null {
  if (leavesKeysAlone(event)) return null;

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

  // Turned over, the collage is only being read: the keys that turn it back
  // and the shortcut list work, and nothing reaches the pieces.
  if (mode === "back") {
    if (accel || event.altKey) return null;
    if (event.key === "Escape") return { kind: "turnOver" };
    if (event.key === "?") return { kind: "showKeys" };
    if (!event.shiftKey && event.key.toLowerCase() === "t") {
      return { kind: "turnOver" };
    }
    return null;
  }

  if (accel) {
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

  // Ordering uses bare brackets. The browser reserves the accelerator forms:
  // Cmd/Ctrl+Shift+[ and +] switch tabs and cannot be intercepted, and
  // Cmd+[ / Cmd+] are history back and forward.
  const bracket = bracketSide(event);
  if (bracket) {
    if (!hasSelection) return null;
    if (bracket === "right") {
      return { kind: "order", to: event.shiftKey ? "front" : "forward" };
    }
    return { kind: "order", to: event.shiftKey ? "back" : "backward" };
  }

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

  // Stepping down into a pile and back up, next to the bracket keys that
  // restack it, so reaching a buried piece never moves anything.
  if (event.key === ",") return { kind: "selectInStack", direction: "below" };
  if (event.key === ".") return { kind: "selectInStack", direction: "above" };

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
    case "t":
      return { kind: "turnOver" };
    case "\\":
      return { kind: "toggleDrawer" };
    default:
      return null;
  }
}

/**
 * Which bracket was pressed. Shift rewrites `[` to `{`, so the physical key
 * decides and the character is only a fallback.
 */
function bracketSide(event: KeyEventShape): "left" | "right" | null {
  if (event.code === "BracketRight") return "right";
  if (event.code === "BracketLeft") return "left";
  if (event.code) return null;
  if (event.key === "]" || event.key === "}") return "right";
  if (event.key === "[" || event.key === "{") return "left";
  return null;
}

/**
 * Accelerators a browser or the operating system keeps for itself. Some of
 * these cannot be intercepted by a page at all, and the rest would take the
 * person somewhere else if a binding ever missed, so the studio binds none.
 */
export const RESERVED_ACCELERATORS: string[] = [
  // Cannot be intercepted: tab and window management.
  "accel+w",
  "accel+shift+w",
  "accel+t",
  "accel+shift+t",
  "accel+n",
  "accel+shift+n",
  "accel+q",
  "accel+shift+[",
  "accel+shift+]",
  "ctrl+tab",
  "ctrl+shift+tab",
  "ctrl+pageup",
  "ctrl+pagedown",
  // Navigates away from the studio, so not worth binding even where a page
  // may intercept it.
  "accel+[",
  "accel+]",
  "accel+l",
  "accel+r",
  "accel+shift+r",
  // Digits switch tabs on every desktop browser.
  ...Array.from({ length: 9 }, (_, index) => `accel+${index + 1}`),
];

/**
 * The accelerator an event names, in the form the reserved list uses, or null
 * when the event is a bare key the browser does not claim.
 */
export function acceleratorName(event: KeyEventShape): string | null {
  const held: string[] = [];
  if (event.metaKey || event.ctrlKey) held.push("accel");
  else if (event.ctrlKey) held.push("ctrl");
  if (held.length === 0) return null;
  if (event.shiftKey) held.push("shift");
  if (event.altKey) held.push("alt");
  return [...held, event.key.toLowerCase()].join("+");
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
      { keys: "enter, C", what: "crop" },
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
      { keys: "] / [", what: "bring forward / send back one" },
      // These have no button in the piece strip, so the list is where they
      // are found.
      { keys: "shift + ] / [", what: "bring to front / send to back" },
      { keys: "tab / shift + tab", what: "step through pieces" },
      { keys: "\\", what: "tuck the drawer away" },
    ],
  },
  {
    group: "reach a buried piece",
    entries: [
      { keys: "click again", what: "take the next piece down" },
      { keys: ", / .", what: "step down / up the stack" },
      { keys: "right-click", what: "list every piece here" },
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
      { keys: "cmd + S", what: "save now" },
    ],
  },
  {
    group: "look",
    entries: [
      { keys: "hold i", what: "where each piece came from" },
      { keys: "T", what: "turn the collage over to read its sources" },
    ],
  },
];
