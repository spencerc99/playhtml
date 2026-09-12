// ABOUTME: Tests the per-voice phrasing decisions — smoothed motion, turns, voice states
// ABOUTME: Pure state, no audio graph: what a note is taken from, not what it sounds like

import { describe, expect, it } from "vitest";
import {
  advanceMotion,
  angleDiffDegrees,
  articulationAt,
  beginNote,
  bloomAmountFor,
  createPhrasingState,
  glideMsForTurn,
  headingAngle,
  resolveMotionState,
  reverbSendFor,
  turnDecision,
  type PhrasingState,
} from "../phrasing";
import { PHRASING_TUNING } from "../tuning";

/** Drive a straight run at a constant speed, one reference frame per step. */
function travel(
  state: PhrasingState,
  dx: number,
  dy: number,
  steps: number,
  startMs = 0,
  stepMs = 16,
): number {
  let now = startMs;
  for (let i = 0; i < steps; i++) {
    now += stepMs;
    advanceMotion(state, dx, dy, 1);
  }
  return now;
}

describe("smoothed motion", () => {
  it("settles the speed on the travelled distance rather than jumping to it", () => {
    const state = createPhrasingState(0);
    advanceMotion(state, 10, 0, 1);
    // One frame of an EMA is one alpha's worth of the sample, which is the
    // point: a single fast frame must not read as a fast gesture.
    expect(state.speed).toBeCloseTo(10 * PHRASING_TUNING.speedAlpha, 5);
    travel(state, 10, 0, 60);
    expect(state.speed).toBeGreaterThan(9.5);
  });

  it("holds its heading through jitter near zero speed", () => {
    // Smoothing the vector rather than the angle is what makes this true: a
    // trail creeping along a line with sub-pixel wobble keeps pointing along
    // the line, where averaging raw angles would spin.
    const state = createPhrasingState(0);
    travel(state, 4, 0, 40);
    const before = headingAngle(state);
    expect(before).not.toBeNull();
    for (let i = 0; i < 20; i++) {
      advanceMotion(state, 0.02, i % 2 === 0 ? 0.02 : -0.02, 1);
    }
    const after = headingAngle(state);
    expect(after).not.toBeNull();
    expect(angleDiffDegrees(before!, after!)).toBeLessThan(15);
  });

  it("does not let jitter after a fast run steal the heading", () => {
    // The speed EMA takes several frames to drain after a fast gesture, so
    // during that drain a cursor that has effectively stopped is still "moving"
    // as far as the turn test is concerned. Weighting the heading by how far
    // each frame actually travelled is what stops a sub-pixel twitch from
    // rotating the line and earning a note nobody gestured.
    const state = createPhrasingState(0);
    let now = travel(state, 12, 0, 60);
    beginNote(state, now);
    const held = headingAngle(state)!;
    for (let i = 0; i < 20; i++) {
      now += 16;
      advanceMotion(state, 0.01, 0.05, 1);
      expect(turnDecision(state, now)).toBeNull();
    }
    expect(angleDiffDegrees(held, headingAngle(state)!)).toBeLessThan(
      PHRASING_TUNING.turnDegrees,
    );
  });

  it("normalizes speed against the frame the sample actually spans", () => {
    // A replay running at half rate travels twice as far per frame; without
    // the scale that reads as a trail moving twice as fast.
    const sixty = createPhrasingState(0);
    const thirty = createPhrasingState(0);
    travel(sixty, 6, 0, 40);
    for (let i = 0; i < 40; i++) advanceMotion(thirty, 12, 0, 0.5);
    expect(thirty.speed).toBeCloseTo(sixty.speed, 5);
  });
});

describe("turn detection", () => {
  it("takes the first note as soon as the trail is moving", () => {
    const state = createPhrasingState(0);
    travel(state, 6, 0, 20);
    expect(turnDecision(state, 320)).not.toBeNull();
  });

  it("holds the note through a straight run", () => {
    const state = createPhrasingState(0);
    travel(state, 6, 0, 20);
    beginNote(state, 320);
    const now = travel(state, 6, 0, 60, 320);
    expect(turnDecision(state, now)).toBeNull();
  });

  it("takes a new note once the heading swings past the turn threshold", () => {
    const state = createPhrasingState(0);
    travel(state, 6, 0, 30);
    beginNote(state, 480);
    // Straight down, a right angle from the run above.
    const now = travel(state, 0, 6, 40, 480);
    const decision = turnDecision(state, now);
    expect(decision).not.toBeNull();
    expect(decision!.sharpnessDegrees).toBeGreaterThan(
      PHRASING_TUNING.turnDegrees,
    );
  });

  it("refuses a turn inside the minimum note interval", () => {
    const state = createPhrasingState(0);
    travel(state, 6, 0, 30);
    beginNote(state, 480);
    // Same right-angle turn, but only a few frames later.
    const now = travel(state, 0, 6, 8, 480);
    expect(now - 480).toBeLessThan(PHRASING_TUNING.minNoteIntervalMs);
    expect(turnDecision(state, now)).toBeNull();
  });

  it("refuses a turn the trail is moving too slowly to mean", () => {
    const state = createPhrasingState(0);
    travel(state, 6, 0, 30);
    beginNote(state, 480);
    const now = travel(state, 0, 0.05, 60, 480);
    expect(state.speed).toBeLessThan(PHRASING_TUNING.moveMinSpeed);
    expect(turnDecision(state, now)).toBeNull();
  });
});

describe("glide", () => {
  it("slides through a gentle curve and snaps through a hard corner", () => {
    const gentle = glideMsForTurn(PHRASING_TUNING.turnDegrees + 1);
    const hard = glideMsForTurn(180);
    // A degree past the threshold is barely a turn at all, so it glides at
    // very nearly the full length.
    expect(PHRASING_TUNING.glideMaxMs - gentle).toBeLessThan(2);
    expect(hard).toBeCloseTo(PHRASING_TUNING.glideMinMs, 5);
    expect(hard).toBeLessThan(gentle);
  });

  it("never asks for a glide outside the tuned range", () => {
    for (const swing of [0, 30, 45, 90, 200, 400]) {
      const glide = glideMsForTurn(swing);
      expect(glide).toBeLessThanOrEqual(PHRASING_TUNING.glideMaxMs);
      expect(glide).toBeGreaterThanOrEqual(PHRASING_TUNING.glideMinMs);
    }
  });
});

describe("articulation", () => {
  it("swells to full on a note and then relaxes toward the settled level", () => {
    const state = createPhrasingState(0);
    travel(state, 6, 0, 20);
    // Neutral before the first note, so a voice that is never articulated —
    // every voice, with phrasing off — sounds at exactly its own gain.
    expect(articulationAt(state, 999)).toBe(1);
    beginNote(state, 1000);
    expect(articulationAt(state, 1000 + PHRASING_TUNING.articulationAttackMs))
      .toBeCloseTo(1, 5);
    const settling = articulationAt(state, 2500);
    expect(settling).toBeLessThan(1);
    expect(settling).toBeGreaterThan(PHRASING_TUNING.articulationSettleLevel);
    // Never silent while the note stands: the settle is a relaxation, not a
    // release.
    expect(articulationAt(state, 60_000)).toBeCloseTo(
      PHRASING_TUNING.articulationSettleLevel,
      3,
    );
  });

  it("re-articulates from the top on the next note", () => {
    const state = createPhrasingState(0);
    travel(state, 6, 0, 20);
    beginNote(state, 1000);
    const settled = articulationAt(state, 4000);
    beginNote(state, 4000);
    // The attack climbs from the level actually sounding, not from a fixed
    // floor, so re-articulating a settled line is continuous rather than a dip
    // followed by a jump.
    expect(articulationAt(state, 4000)).toBeCloseTo(settled, 5);
    expect(articulationAt(state, 4000 + PHRASING_TUNING.articulationAttackMs))
      .toBeGreaterThan(settled);
  });
});

describe("voice states", () => {
  it("calls a travelling trail moving", () => {
    const state = createPhrasingState(0);
    let now = 0;
    for (let i = 0; i < 200; i++) {
      now += 16;
      advanceMotion(state, 6, 0, 1);
      resolveMotionState(state, i * 6, 0, now);
    }
    expect(state.state).toBe("moving");
  });

  it("calls a trail that keeps moving inside a small radius lingering", () => {
    const state = createPhrasingState(0);
    let now = 0;
    // A hand hovering: real movement, none of it going anywhere.
    for (let i = 0; i < 400; i++) {
      now += 16;
      const dx = i % 2 === 0 ? 3 : -3;
      advanceMotion(state, dx, 0, 1);
      resolveMotionState(state, 400 + (i % 2 === 0 ? 3 : 0), 400, now);
    }
    expect(state.state).toBe("lingering");
  });

  it("calls a stopped trail resting only once it has held still", () => {
    const state = createPhrasingState(0);
    let now = 0;
    for (let i = 0; i < 60; i++) {
      now += 16;
      advanceMotion(state, 6, 0, 1);
      resolveMotionState(state, i * 6, 0, now);
    }
    expect(state.state).toBe("moving");
    // Stops dead. The speed EMA has to drain before the rest clock even
    // starts, and then the rest needs its own hold.
    for (let i = 0; i < 40; i++) {
      now += 16;
      advanceMotion(state, 0, 0, 1);
      resolveMotionState(state, 360, 0, now);
    }
    expect(state.state).not.toBe("resting");
    for (let i = 0; i < 200; i++) {
      now += 16;
      advanceMotion(state, 0, 0, 1);
      resolveMotionState(state, 360, 0, now);
    }
    expect(state.state).toBe("resting");
  });

  it("ends the phrase on rest, so resuming motion starts a fresh note", () => {
    const state = createPhrasingState(0);
    let now = 0;
    for (let i = 0; i < 60; i++) {
      now += 16;
      advanceMotion(state, 6, 0, 1);
      resolveMotionState(state, i * 6, 0, now);
    }
    beginNote(state, now);
    for (let i = 0; i < 240; i++) {
      now += 16;
      advanceMotion(state, 0, 0, 1);
      resolveMotionState(state, 360, 0, now);
    }
    expect(state.state).toBe("resting");
    expect(state.noteStartedMs).toBeNull();
    // Moving again along the very same heading still earns a note, because the
    // line it belonged to is over.
    for (let i = 0; i < 40; i++) {
      now += 16;
      advanceMotion(state, 6, 0, 1);
      resolveMotionState(state, 360 + i * 6, 0, now);
    }
    expect(turnDecision(state, now)).not.toBeNull();
  });
});

describe("speed layers", () => {
  it("crossfades the octave bloom in across the tuned speed range", () => {
    expect(bloomAmountFor(0)).toBe(0);
    expect(bloomAmountFor(PHRASING_TUNING.bloomMinSpeed)).toBe(0);
    expect(bloomAmountFor(PHRASING_TUNING.bloomMaxSpeed)).toBe(1);
    expect(bloomAmountFor(1000)).toBe(1);
    const middle = bloomAmountFor(
      (PHRASING_TUNING.bloomMinSpeed + PHRASING_TUNING.bloomMaxSpeed) / 2,
    );
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it("puts a slow path far away and a fast one close", () => {
    expect(reverbSendFor(0)).toBeCloseTo(PHRASING_TUNING.reverbSlowSend, 5);
    expect(reverbSendFor(100)).toBeCloseTo(PHRASING_TUNING.reverbFastSend, 5);
    expect(reverbSendFor(10)).toBeLessThan(reverbSendFor(2));
  });
});

describe("the drawing's breath", () => {
  it("draws a freshly articulated trail more strongly than a settled one", async () => {
    const { articulationBreath, ARTICULATION_VISUAL } = await import("../tuning");
    const fresh = articulationBreath(1);
    const settled = articulationBreath(PHRASING_TUNING.articulationSettleLevel);
    expect(fresh.opacityScale).toBeGreaterThan(settled.opacityScale);
    expect(fresh.widthScale).toBeGreaterThan(settled.widthScale);
    // Full articulation is the drawing as it was before any of this, so a
    // trail at the top of its swell is never dimmed by the tie-in.
    expect(fresh.opacityScale).toBeCloseTo(1, 5);
    expect(fresh.widthScale).toBeCloseTo(1, 5);
    expect(settled.opacityScale).toBeGreaterThanOrEqual(
      ARTICULATION_VISUAL.minOpacityScale,
    );
  });

  it("leaves an unphrased trail exactly as it was drawn", async () => {
    const { articulationBreath } = await import("../tuning");
    expect(articulationBreath(null)).toEqual({ opacityScale: 1, widthScale: 1 });
    expect(articulationBreath(undefined)).toEqual({
      opacityScale: 1,
      widthScale: 1,
    });
  });

  it("lands on steps, so a breathing line does not force a repaint every frame", async () => {
    const { articulationBreath, ARTICULATION_VISUAL } = await import("../tuning");
    // The renderer caches on the exact opacity and width it last drew; a
    // continuously varying breath would defeat that for every trail.
    const scales = new Set<number>();
    for (let i = 0; i <= 1000; i++) {
      scales.add(articulationBreath(i / 1000).opacityScale);
    }
    expect(scales.size).toBeLessThanOrEqual(
      Math.ceil(1 / ARTICULATION_VISUAL.quantum) + 2,
    );
  });
});
