// ABOUTME: Decides the one floating panel the studio shows over the collage at a time.
// ABOUTME: A running tool owns the space, so nothing else can open on top of its controls.

import type { PieceBox } from "./collageGeometry";

/**
 * The floating panels that can sit over the collage. At most one is ever on
 * screen: "crop" and "cutout" are tool sessions, "piecesHere" is the stack
 * menu, and "pieceActions" is the strip of tools beside the selected piece.
 */
export type StudioPanel =
  | "none"
  | "crop"
  | "cutout"
  | "piecesHere"
  | "pieceActions";

export interface PanelState {
  /** The collage is turned over and only its back is showing. */
  turnedOver: boolean;
  cropping: boolean;
  /** A modal rotate or scale is following the pointer. */
  transforming: boolean;
  /** The background cutout's edge control is open. */
  cuttingOut: boolean;
  piecesHereOpen: boolean;
  /** A drag, resize or rotate from a handle is under way. */
  gestureRunning: boolean;
  /** The source tags are held up over every piece. */
  peekHeld: boolean;
  hasSelection: boolean;
}

/**
 * The panel that is visible, by priority. A tool session outranks everything,
 * because its controls are the only way to finish it; the stack menu was asked
 * for on purpose, so it outranks the piece strip; the strip is the resting
 * state and stands aside while anything moves or the tags are up.
 */
export function visiblePanel(state: PanelState): StudioPanel {
  if (state.turnedOver) return "none";
  if (state.cropping) return "crop";
  if (state.transforming) return "none";
  if (state.cuttingOut) return "cutout";
  if (state.piecesHereOpen) return "piecesHere";
  if (state.gestureRunning || state.peekHeld) return "none";
  if (state.hasSelection) return "pieceActions";
  return "none";
}

/**
 * Whether a tool session holds the collage, in which case the stack menu may
 * not open and the hover outline stays down.
 */
export function toolSessionActive(state: PanelState): boolean {
  return state.cropping || state.transforming || state.cuttingOut;
}

/** How far from the piece a panel sits, in on-screen pixels. */
export const PANEL_GAP = 10;

/** How far the rotate knob's tether reaches above a selected piece, in frame units. */
export const ROTATE_HANDLE_OFFSET = 26;

/**
 * Everything the rotate knob covers above the piece, in frame units: the
 * tether plus half the knob drawn at its end.
 */
export const ROTATE_HANDLE_REACH = ROTATE_HANDLE_OFFSET + 6;

/**
 * Where a panel floating beside a piece goes, in frame coordinates. It sits
 * above the piece, clear of the rotate knob, drops below when there is no
 * room above, and is kept inside the frame. The panel is drawn at its own
 * on-screen size, so its measured size is converted through the zoom.
 */
export function placeBesidePiece(
  piece: PieceBox,
  panel: { width: number; height: number },
  scale: number,
  frame: { width: number; height: number },
): { left: number; top: number } {
  const gap = PANEL_GAP / scale;
  const width = panel.width / scale;
  const height = panel.height / scale;
  const above = piece.y - ROTATE_HANDLE_REACH - gap - height;
  const top = above >= 0 ? above : piece.y + piece.height + gap;
  const centered = piece.x + piece.width / 2 - width / 2;
  const left =
    width >= frame.width
      ? 0
      : Math.min(Math.max(centered, 0), frame.width - width);
  return {
    left,
    top: Math.min(Math.max(top, 0), Math.max(frame.height - height, 0)),
  };
}
