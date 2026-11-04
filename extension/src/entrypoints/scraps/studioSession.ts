// ABOUTME: The one editing session the collage studio is in: idle, crop, cutout, rotate, scale or back.
// ABOUTME: Holding it as a single value means starting one session always ends the one before.

import type { CropFraction, Point } from "./collageGeometry";
import type { PieceCutout } from "./backgroundCutout";
import type { CollagePiece } from "./collageRecord";
import type { StudioMode } from "./studioKeymap";

/** A rotate or scale driven by pointer movement with no button held. */
export type ModalTransform = {
  kind: "rotate" | "scale";
  /** The pieces in hand as they were when the transform began, for cancelling back. */
  before: readonly CollagePiece[];
  /** What the pieces turn or grow about: the piece's center or the group's. */
  center: Point;
  anchor: Point;
  readout: string;
};

export type CropState = {
  pieceId: string;
  crop: CropFraction;
  /** The crop the piece had on entry, restored when the session is cancelled. */
  before: CropFraction;
};

/**
 * The picture whose cutout edge is being tuned, and the cutout it had when
 * the control opened, restored if the session is cancelled.
 */
export type CutoutState = {
  pieceId: string;
  before: PieceCutout | undefined;
};

/**
 * What the studio is doing. Only one session runs at a time: the collage
 * cannot be turned over with a crop open, and a cutout cannot run under a
 * rotate. Each session carries only the state it needs.
 */
export type StudioSession =
  | { kind: "idle" }
  | { kind: "back" }
  | { kind: "crop"; crop: CropState }
  | { kind: "transform"; transform: ModalTransform }
  | { kind: "cutout"; cutout: CutoutState };

export const IDLE_SESSION: StudioSession = { kind: "idle" };
export const BACK_SESSION: StudioSession = { kind: "back" };

/** The mode the keymap reads, with a transform named by what it does. */
export function studioModeOf(session: StudioSession): StudioMode {
  return session.kind === "transform" ? session.transform.kind : session.kind;
}

/** The crop running now, if the studio is cropping. */
export function cropOf(session: StudioSession): CropState | null {
  return session.kind === "crop" ? session.crop : null;
}

/** The modal rotate or scale running now, if there is one. */
export function transformOf(session: StudioSession): ModalTransform | null {
  return session.kind === "transform" ? session.transform : null;
}

/** The cutout whose edge is being tuned now, if there is one. */
export function cutoutOf(session: StudioSession): CutoutState | null {
  return session.kind === "cutout" ? session.cutout : null;
}

/**
 * Ends the session only if it is still the kind the caller started. A crop
 * that finishes after the collage was turned over must not turn it back.
 */
export function endSession(
  session: StudioSession,
  kind: StudioSession["kind"],
): StudioSession {
  return session.kind === kind ? IDLE_SESSION : session;
}

/**
 * Replaces a running session's own state, as when a crop's edges move or a
 * transform's readout changes. Anything else that started meanwhile is left.
 */
export function updateSession(
  session: StudioSession,
  next: Exclude<StudioSession, { kind: "idle" } | { kind: "back" }>,
): StudioSession {
  return session.kind === next.kind ? next : session;
}

/** Turns the collage over, or face up again. Face up is always idle. */
export function turnedOver(session: StudioSession): StudioSession {
  return session.kind === "back" ? IDLE_SESSION : BACK_SESSION;
}
