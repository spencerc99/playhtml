// ABOUTME: One tunable constants file for the orchestra upgrade — phrasing, density, conductor
// ABOUTME: Every number here is a starting point meant to be moved by ear, not a derived value

/**
 * Phase 1 — per-voice phrasing.
 *
 * The split this encodes: a voice's *instant* parameters (gain, brightness,
 * vowel, pan) keep tracking motion every frame, and its *phrased* parameter —
 * pitch — changes only when the trail turns. Re-reading pitch per frame is what
 * made a fast cursor sound like a siren rather than a player; a note that is
 * chosen once and then held is what makes a line.
 */
export const PHRASING_TUNING = {
  /**
   * EMA weight on the newest speed sample. Low enough that one dropped frame
   * does not read as a stop, high enough that a flick is audible inside ~100ms.
   */
  speedAlpha: 0.15,
  /**
   * EMA weight on the velocity *vector*. Smoothing the vector rather than the
   * angle is the whole point: near zero speed the angle is noise, and averaging
   * noise angles spins the heading; averaging near-zero vectors does not.
   */
  headingAlpha: 0.15,
  /** How far the heading must swing from the note's own heading to earn a new note. */
  turnDegrees: 30,
  /** Floor on the gap between notes, so a jittery hand does not trill. */
  minNoteIntervalMs: 200,
  /** Smoothed speed below which a turn is not a gesture, in px/frame. */
  moveMinSpeed: 0.35,

  /**
   * Glide length scales with how sharp the turn was: a gentle curve slides into
   * its next note, a hard corner snaps. `sharpnessRangeDegrees` is how far past
   * `turnDegrees` counts as fully sharp.
   */
  glideMaxMs: 150,
  glideMinMs: 20,
  sharpnessRangeDegrees: 150,
  /**
   * `setTargetAtTime` reaches ~95% of its target in three time constants, so a
   * glide asked for in ms is applied as `glideMs / 3000` seconds.
   */
  glideTimeConstantDivisor: 3000,

  /**
   * Swell and settle. Every note re-articulates: a fast ramp to full, then a
   * long relax toward a sustain level. The voice never reaches silence while
   * the trail is moving — this multiplies the instant velocity gain rather
   * than replacing it.
   */
  articulationAttackMs: 30,
  articulationSettleDelayMs: 50,
  articulationSettleLevel: 0.6,
  articulationSettleTimeConstant: 1.5,

  /**
   * The octave "bloom": a quiet ×2 layer crossfaded in with speed, replacing
   * the old ×2/×4 pitch jumps. It stays inside the voice's register, so speed
   * never introduces a pitch the harmony did not ask for.
   */
  bloomMultiple: 2,
  bloomMinSpeed: 4,
  bloomMaxSpeed: 18,
  bloomGain: 0.25,
  bloomSmoothingMs: 300,
  /** The bloom's own cutoff — it adds an octave, not a new set of partials. */
  bloomFilterHz: 2600,
  bloomFadeSeconds: 0.4,

  /**
   * Speed drives the room inversely: a fast path feels close, a slow one far.
   * These are absolute send levels, converted to a per-voice scale against the
   * engine's default send.
   */
  reverbSlowSend: 0.4,
  reverbFastSend: 0.15,

  /**
   * Lingering: the trail is still moving but going nowhere — every point of the
   * last `windowMs` inside `radiusPx`. The note is held and allowed to develop
   * rather than being re-chosen.
   */
  lingerWindowMs: 2000,
  lingerRadiusPx: 24,
  /** The closed hum a lingering voice eases its vowel onto. */
  lingerFormantsHz: [250, 600],
  lingerFormantEaseSeconds: 2,
  /** How long the lingering vibrato takes to reach its full widened depth. */
  lingerVibratoRampSeconds: 6,
  lingerVibratoDepthScale: 2.5,
  /** The bloom doubles as the lingering voice's halo, fading in this far. */
  lingerBloomGain: 0.15,
  lingerBloomRampSeconds: 4,

  /**
   * Resting: genuinely stopped. Below `restSpeed` for `restAfterMs`, the voice
   * fades out; resuming motion starts a fresh note rather than resuming the old
   * one.
   */
  restSpeed: 0.1,
  restAfterMs: 1500,
  restFadeSeconds: 2,
} as const;

/** How far a voice's articulation is allowed to move the drawn trail. */
export const ARTICULATION_VISUAL = {
  /** Opacity multiplier at the settled level, rising to 1 at a fresh attack. */
  minOpacityScale: 0.72,
  /** Stroke width multiplier across the same range. */
  minWidthScale: 0.85,
  /**
   * Step the multipliers land on.
   *
   * The trail renderer caches on the exact opacity and width it last drew and
   * skips the repaint when neither moved, which is what keeps a crowded scene
   * cheap. A continuously varying breath would defeat that cache for every
   * trail on every frame. Quantizing costs nothing visible — the steps are far
   * under what an eye resolves against a moving line — and the repaint rate
   * drops back to roughly the rate the envelope actually crosses a step.
   */
  quantum: 0.02,
} as const;

/**
 * The opacity and stroke multipliers a voice's articulation amounts to.
 * `articulation` is null when the trail has no phrased voice — no sound, or
 * phrasing off — and the drawing is then left exactly as it was.
 */
export function articulationBreath(articulation: number | null | undefined): {
  opacityScale: number;
  widthScale: number;
} {
  if (articulation === null || articulation === undefined) {
    return { opacityScale: 1, widthScale: 1 };
  }
  const { minOpacityScale, minWidthScale, quantum } = ARTICULATION_VISUAL;
  const level = Math.min(1, Math.max(0, articulation));
  const step = (min: number) =>
    Math.round((min + (1 - min) * level) / quantum) * quantum;
  return {
    opacityScale: step(minOpacityScale),
    widthScale: step(minWidthScale),
  };
}
