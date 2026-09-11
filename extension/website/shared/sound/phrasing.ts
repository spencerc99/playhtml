// ABOUTME: Per-trail phrasing state — smoothed motion, turn detection, voice states
// ABOUTME: Pure functions over plain state so the phrasing can be reasoned about without audio

import { PHRASING_TUNING } from "./tuning";

/** What a voice is doing, which decides how the engine develops it. */
export type VoiceMotionState = "moving" | "lingering" | "resting";

/** One sampled position, kept only long enough to answer "is this trail lingering". */
interface LingerPoint {
  x: number;
  y: number;
  t: number;
}

/**
 * Everything the phrasing needs to remember about one trail between frames.
 *
 * Deliberately plain data: the engine owns the audio graph, this owns the
 * decision of *when* something should happen to it.
 */
export interface PhrasingState {
  /** EMA of px/frame. */
  speed: number;
  /** EMA of the velocity vector, not of its angle — see `PHRASING_TUNING.headingAlpha`. */
  headingX: number;
  headingY: number;
  /** False until the trail has moved at all, so the first note is unconditioned. */
  hasHeading: boolean;
  /** Heading the current note was started on, in radians. */
  noteHeading: number;
  /** Tick time the current note started, or null while the voice has no note. */
  noteStartedMs: number | null;
  state: VoiceMotionState;
  /** Tick time the current state was entered. */
  stateSinceMs: number;
  /** Tick time the trail first dropped below `restSpeed`, or null while it is moving. */
  stillSinceMs: number | null;
  /** Positions inside the linger window, oldest first. */
  recent: LingerPoint[];
  /**
   * Where the articulation envelope has reached, 0-1. Tracked in the engine's
   * own terms rather than read back off an `AudioParam`, so the drawing can be
   * tied to it without touching the audio thread.
   */
  articulation: number;
  /** Tick time the articulation envelope was last re-struck. */
  articulationStartedMs: number;
  /** Smoothed 0-1 bloom amount, so the octave layer crossfades rather than steps. */
  bloom: number;
}

export const createPhrasingState = (elapsedMs: number): PhrasingState => ({
  speed: 0,
  headingX: 0,
  headingY: 0,
  hasHeading: false,
  noteHeading: 0,
  noteStartedMs: null,
  state: "resting",
  stateSinceMs: elapsedMs,
  stillSinceMs: elapsedMs,
  recent: [],
  articulation: PHRASING_TUNING.articulationRestLevel,
  articulationStartedMs: Number.NEGATIVE_INFINITY,
  bloom: 0,
});

/** One step of an exponential moving average. */
export const ema = (previous: number, sample: number, alpha: number): number =>
  previous + (sample - previous) * alpha;

/**
 * Fold this frame's motion into the smoothed speed and heading.
 *
 * `distance` is the raw px this frame and `frameScale` normalizes it to a
 * reference frame, so a replay running at a different rate than 60fps does not
 * read as a different speed.
 */
export function advanceMotion(
  state: PhrasingState,
  dx: number,
  dy: number,
  frameScale: number,
): void {
  const { speedAlpha, headingAlpha } = PHRASING_TUNING;
  const scaledX = dx * frameScale;
  const scaledY = dy * frameScale;
  const distance = Math.hypot(scaledX, scaledY);
  state.speed = ema(state.speed, distance, speedAlpha);
  if (distance > 0) {
    // The unit vector, so a fast frame does not out-vote a slow one on
    // direction. Magnitude is already carried by `speed`.
    const unitX = scaledX / distance;
    const unitY = scaledY / distance;
    if (!state.hasHeading) {
      state.headingX = unitX;
      state.headingY = unitY;
      state.hasHeading = true;
    } else {
      state.headingX = ema(state.headingX, unitX, headingAlpha);
      state.headingY = ema(state.headingY, unitY, headingAlpha);
    }
  }
}

/** The smoothed heading as an angle, or null while the vector is too small to mean anything. */
export function headingAngle(state: PhrasingState): number | null {
  const magnitude = Math.hypot(state.headingX, state.headingY);
  if (magnitude < 1e-3) return null;
  return Math.atan2(state.headingY, state.headingX);
}

/** Smallest absolute difference between two angles, in degrees. */
export function angleDiffDegrees(a: number, b: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return Math.abs(delta) * (180 / Math.PI);
}

/**
 * Whether this frame should start a new note, and how sharply.
 *
 * `null` means hold the current note. A trail with no note yet always takes
 * one as soon as it is moving — that is its entrance, not a turn.
 */
export function turnDecision(
  state: PhrasingState,
  elapsedMs: number,
): { sharpnessDegrees: number } | null {
  const { turnDegrees, minNoteIntervalMs, moveMinSpeed } = PHRASING_TUNING;
  const heading = headingAngle(state);
  if (heading === null) return null;
  if (state.noteStartedMs === null) {
    return state.speed > moveMinSpeed ? { sharpnessDegrees: 180 } : null;
  }
  if (state.speed <= moveMinSpeed) return null;
  if (elapsedMs - state.noteStartedMs <= minNoteIntervalMs) return null;
  const swing = angleDiffDegrees(state.noteHeading, heading);
  if (swing <= turnDegrees) return null;
  return { sharpnessDegrees: swing };
}

/** Record that a note started on the current heading. */
export function beginNote(state: PhrasingState, elapsedMs: number): void {
  state.noteHeading = headingAngle(state) ?? state.noteHeading;
  state.noteStartedMs = elapsedMs;
  state.articulationStartedMs = elapsedMs;
  state.articulation = 1;
}

/**
 * Glide length in ms for a turn of this sharpness: a hard corner is near
 * instant, a gentle curve slides.
 */
export function glideMsForTurn(sharpnessDegrees: number): number {
  const { turnDegrees, sharpnessRangeDegrees, glideMaxMs, glideMinMs } =
    PHRASING_TUNING;
  const past = (sharpnessDegrees - turnDegrees) / sharpnessRangeDegrees;
  const sharpness = Math.min(1, Math.max(0, past));
  return glideMaxMs + (glideMinMs - glideMaxMs) * sharpness;
}

/**
 * Where the articulation envelope has reached: a fast ramp to 1 at the note's
 * onset, then an exponential relax toward the settled level.
 *
 * Computed rather than read back, because the drawing reads the same value and
 * an `AudioParam` is only truthfully readable on the audio thread.
 */
export function articulationAt(
  state: PhrasingState,
  elapsedMs: number,
): number {
  const {
    articulationAttackMs,
    articulationSettleDelayMs,
    articulationSettleLevel,
    articulationSettleTimeConstant,
    articulationRestLevel,
  } = PHRASING_TUNING;
  if (state.articulationStartedMs === Number.NEGATIVE_INFINITY) {
    return articulationRestLevel;
  }
  const age = elapsedMs - state.articulationStartedMs;
  if (age < 0) return articulationRestLevel;
  if (age < articulationAttackMs) {
    const progress = age / articulationAttackMs;
    return articulationRestLevel + (1 - articulationRestLevel) * progress;
  }
  const settleAge = (age - articulationSettleDelayMs) / 1000;
  if (settleAge <= 0) return 1;
  const decay = Math.exp(-settleAge / articulationSettleTimeConstant);
  return articulationSettleLevel + (1 - articulationSettleLevel) * decay;
}

/**
 * Keep the linger window, and answer whether every point in it sits inside the
 * linger radius. A trail can only linger while it is still moving — a stopped
 * trail is resting, which is a different thing and fades out.
 */
export function isLingering(
  state: PhrasingState,
  x: number,
  y: number,
  elapsedMs: number,
): boolean {
  const { lingerWindowMs, lingerRadiusPx, restSpeed } = PHRASING_TUNING;
  state.recent.push({ x, y, t: elapsedMs });
  const cutoff = elapsedMs - lingerWindowMs;
  let drop = 0;
  while (drop < state.recent.length && state.recent[drop].t < cutoff) drop++;
  if (drop > 0) state.recent.splice(0, drop);
  // A window that has not filled yet cannot say the trail has stayed put.
  if (state.recent.length < 2) return false;
  if (elapsedMs - state.recent[0].t < lingerWindowMs * 0.9) return false;
  if (state.speed <= restSpeed) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of state.recent) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const spread = Math.hypot(maxX - minX, maxY - minY);
  return spread <= lingerRadiusPx * 2;
}

/**
 * Resolve this frame's motion state. Resting needs the trail to have been
 * below `restSpeed` continuously for `restAfterMs` — a single slow frame in the
 * middle of a gesture is not a stop.
 */
export function resolveMotionState(
  state: PhrasingState,
  x: number,
  y: number,
  elapsedMs: number,
): VoiceMotionState {
  const { restSpeed, restAfterMs } = PHRASING_TUNING;
  if (state.speed < restSpeed) {
    if (state.stillSinceMs === null) state.stillSinceMs = elapsedMs;
  } else {
    state.stillSinceMs = null;
  }
  const lingering = isLingering(state, x, y, elapsedMs);
  let next: VoiceMotionState;
  if (
    state.stillSinceMs !== null &&
    elapsedMs - state.stillSinceMs > restAfterMs
  ) {
    next = "resting";
  } else if (lingering) {
    next = "lingering";
  } else {
    next = "moving";
  }
  if (next !== state.state) {
    state.state = next;
    state.stateSinceMs = elapsedMs;
    // Resting ends the phrase: whatever note was held is over, so resuming
    // motion selects a fresh one rather than continuing the old line.
    if (next === "resting") state.noteStartedMs = null;
  }
  return next;
}

/** 0-1 position of a speed inside the bloom's crossfade range. */
export function bloomAmountFor(speed: number): number {
  const { bloomMinSpeed, bloomMaxSpeed } = PHRASING_TUNING;
  if (speed <= bloomMinSpeed) return 0;
  return Math.min(1, (speed - bloomMinSpeed) / (bloomMaxSpeed - bloomMinSpeed));
}

/**
 * The absolute reverb send a voice at this speed should have: wet and far when
 * slow, dry and close when fast.
 */
export function reverbSendFor(speed: number): number {
  const { reverbSlowSend, reverbFastSend } = PHRASING_TUNING;
  const amount = bloomAmountFor(speed);
  return reverbSlowSend + (reverbFastSend - reverbSlowSend) * amount;
}
