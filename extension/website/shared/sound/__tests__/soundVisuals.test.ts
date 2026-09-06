// ABOUTME: Covers the replay canvas's sound-fired gestures without touching pixels
// ABOUTME: Knot cap and placement, gesture-follows-sound, and the transient envelopes

import { describe, expect, it } from "vitest";
import {
  flourishedColor,
  flourishEnvelope,
  GATHERING_TUNING,
  HUE_TILT_TUNING,
  KNOT_TUNING,
  SoundVisuals,
  SURGE_TUNING,
  VISUAL_DEFAULTS,
  VisualConfig,
} from "../soundVisuals";
import { SoundNotice } from "../types";

const TRAIL = 3;

/** A trail parked at a fixed spot, which is all a gesture needs to place itself. */
const locateAt = (x: number, y: number) => () => ({
  x,
  y,
  color: "#4a9a8a",
});

/** No trail on the canvas — a departure whose trail has already been dropped. */
const locateNothing = () => null;

const arrival = (
  rising: boolean,
  noteOffsetsSeconds: number[] = [0, 0.08, 0.17],
  played = true,
): SoundNotice => ({
  kind: "arrival",
  trailIndex: TRAIL,
  rising,
  noteOffsetsSeconds,
  played,
});

const navigation = (played = true): SoundNotice => ({
  kind: "navigation",
  trailIndex: TRAIL,
  x: 100,
  played,
});

/** A gong the driver could not attribute to any trail on the canvas. */
const unattributedNavigation = (): SoundNotice => ({
  kind: "navigation",
  x: 100,
  played: true,
});

const withConfig = (overrides: Partial<VisualConfig>): SoundVisuals => {
  const visuals = new SoundVisuals();
  visuals.setConfig({ ...VISUAL_DEFAULTS, ...overrides });
  return visuals;
};

describe("gathering", () => {
  it("lays one speck per chime note, on that note's own schedule", () => {
    const visuals = withConfig({});
    visuals.setNow(1000);
    visuals.handleNotice(arrival(true, [0, 0.1, 0.25, 0.4]), locateAt(50, 60));

    const [gathering] = visuals.getGatherings();
    expect(gathering.specks).toHaveLength(4);
    // Each speck begins when its note lands, so the drift is paced by the
    // chime rather than by a timing of the visual's own.
    expect(gathering.specks.map((speck) => speck.startMs)).toEqual([
      1000, 1100, 1250, 1400,
    ]);
  });

  it("starts every speck a full radius from the point it converges on", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(arrival(true), locateAt(0, 0));

    const [gathering] = visuals.getGatherings();
    for (const speck of gathering.specks) {
      const distance = Math.hypot(speck.offsetX, speck.offsetY);
      expect(distance).toBeCloseTo(GATHERING_TUNING.radiusPx, 5);
    }
  });

  it("carries the direction of the chime it belongs to", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(arrival(true), locateAt(10, 10));
    visuals.handleNotice(arrival(false), locateAt(10, 10));

    expect(visuals.getGatherings().map((g) => g.rising)).toEqual([true, false]);
  });

  it("draws nothing when the gathering toggle is off", () => {
    const visuals = withConfig({ gathering: false });
    visuals.setNow(0);
    visuals.handleNotice(arrival(true), locateAt(10, 10));
    expect(visuals.getGatherings()).toHaveLength(0);
  });

  it("skips a chime whose trail is no longer on the canvas", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(arrival(false), locateNothing);
    expect(visuals.getGatherings()).toHaveLength(0);
  });

  it("caps how many gatherings run at once, so a dense stretch stays quiet", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    for (let i = 0; i < GATHERING_TUNING.maxConcurrent + 10; i++) {
      visuals.handleNotice(arrival(true), locateAt(i, i));
    }
    expect(visuals.getGatherings()).toHaveLength(GATHERING_TUNING.maxConcurrent);
  });

  it("clears once its last speck has finished travelling", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(arrival(true, [0, 0.1]), locateAt(5, 5));

    const travelMs = GATHERING_TUNING.travelSeconds * 1000;
    visuals.prune(100 + travelMs - 1);
    expect(visuals.getGatherings()).toHaveLength(1);
    visuals.prune(100 + travelMs + 1);
    expect(visuals.getGatherings()).toHaveLength(0);
  });
});

describe("knots", () => {
  it("leaves a bead where the trail was when its gong fired", () => {
    const visuals = withConfig({});
    visuals.setNow(500);
    visuals.handleNotice(navigation(), locateAt(120, 45));

    expect(visuals.getKnots(TRAIL)).toEqual([
      { x: 120, y: 45, formedMs: 500 },
    ]);
  });

  it("marks each navigation at the moment that navigation sounded", () => {
    const visuals = withConfig({});
    const moments = [200, 1400, 2600];
    moments.forEach((at, index) => {
      visuals.setNow(at);
      visuals.handleNotice(navigation(), locateAt(index * 10, 0));
    });

    // Beads sit on the navigation schedule, not on a schedule of their own:
    // a bead exists for each gong that sounded and at the time it sounded.
    expect(visuals.getKnots(TRAIL).map((knot) => knot.formedMs)).toEqual(
      moments,
    );
    expect(visuals.getKnots(TRAIL).map((knot) => knot.x)).toEqual([0, 10, 20]);
  });

  it("keeps only the most recent beads once the cap is reached", () => {
    const visuals = withConfig({});
    const total = KNOT_TUNING.maxPerTrail + 5;
    for (let i = 0; i < total; i++) {
      visuals.setNow(i * 100);
      visuals.handleNotice(navigation(), locateAt(i, 0));
    }

    const knots = visuals.getKnots(TRAIL);
    expect(knots).toHaveLength(KNOT_TUNING.maxPerTrail);
    // The oldest are dropped, so what remains is the stretch nearest the cursor.
    expect(knots[0].x).toBe(total - KNOT_TUNING.maxPerTrail);
    expect(knots[knots.length - 1].x).toBe(total - 1);
  });

  it("persists across the life of the trail rather than expiring", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(navigation(), locateAt(1, 1));

    visuals.prune(600_000);
    expect(visuals.getKnots(TRAIL)).toHaveLength(1);
  });

  it("goes with the trail when the trail is retired", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(navigation(), locateAt(1, 1));

    visuals.retireTrail(TRAIL);
    expect(visuals.getKnots(TRAIL)).toHaveLength(0);
  });

  it("re-forms from nothing after a loop restart", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(navigation(), locateAt(1, 1));
    expect(visuals.getKnots(TRAIL)).toHaveLength(1);

    // A loop is a fresh performance: the beads of the last pass do not carry
    // over, and the next pass lays them again at their own scheduled times.
    visuals.clear();
    expect(visuals.getKnots(TRAIL)).toHaveLength(0);

    visuals.setNow(0);
    visuals.handleNotice(navigation(), locateAt(1, 1));
    expect(visuals.getKnots(TRAIL)).toHaveLength(1);
  });

  it("draws nothing when the knot toggle is off", () => {
    const visuals = withConfig({ knot: false });
    visuals.setNow(0);
    visuals.handleNotice(navigation(), locateAt(1, 1));
    expect(visuals.getKnots(TRAIL)).toHaveLength(0);
  });

  it("ignores a gong that names no trail", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(unattributedNavigation(), locateAt(1, 1));
    expect(visuals.getKnots(TRAIL)).toHaveLength(0);
  });
});

describe("gong flourishes", () => {
  it("starts on the gong and clears once the envelope has run out", () => {
    const visuals = withConfig({});
    visuals.setNow(0);
    visuals.handleNotice(navigation(), locateAt(1, 1));
    expect(visuals.getFlourish(TRAIL)).toEqual({ startMs: 0 });

    const envelopeMs =
      (SURGE_TUNING.swellSeconds + SURGE_TUNING.settleSeconds) * 1000;
    visuals.prune(envelopeMs - 1);
    expect(visuals.getFlourish(TRAIL)).toBeDefined();
    visuals.prune(envelopeMs + 1);
    expect(visuals.getFlourish(TRAIL)).toBeUndefined();
  });

  it("starts for either flavour on its own, and for neither when both are off", () => {
    for (const flavour of ["lightnessSurge", "hueTilt"] as const) {
      const visuals = withConfig({
        lightnessSurge: false,
        hueTilt: false,
        [flavour]: true,
      });
      visuals.setNow(0);
      visuals.handleNotice(navigation(), locateAt(1, 1));
      expect(visuals.getFlourish(TRAIL)).toBeDefined();
    }

    const neither = withConfig({
      knot: false,
      lightnessSurge: false,
      hueTilt: false,
    });
    neither.setNow(0);
    neither.handleNotice(navigation(), locateAt(1, 1));
    expect(neither.getFlourish(TRAIL)).toBeUndefined();
  });
});

describe("flourishEnvelope", () => {
  it("swells to the peak, then settles back to rest", () => {
    expect(flourishEnvelope(0, 0.3, 1.2)).toBe(0);
    expect(flourishEnvelope(150, 0.3, 1.2)).toBeCloseTo(0.5, 5);
    expect(flourishEnvelope(300, 0.3, 1.2)).toBeCloseTo(1, 5);
    expect(flourishEnvelope(900, 0.3, 1.2)).toBeCloseTo(0.5, 5);
    expect(flourishEnvelope(1500, 0.3, 1.2)).toBe(0);
  });

  it("stays at rest past the end and before the start", () => {
    expect(flourishEnvelope(-100, 0.3, 1.2)).toBe(0);
    expect(flourishEnvelope(60_000, 0.3, 1.2)).toBe(0);
  });
});

describe("flourishedColor", () => {
  const BASE = "hsl(170, 40%, 45%)";

  it("returns the trail's own colour when neither flavour is on", () => {
    expect(flourishedColor(BASE, 300, false, false)).toBe(BASE);
  });

  it("lifts lightness at the peak and returns the colour untouched at rest", () => {
    const peak = flourishedColor(BASE, SURGE_TUNING.swellSeconds * 1000, true, false);
    expect(peak).toBe(`hsl(170.0, 40.0%, ${(45 + SURGE_TUNING.liftPoints).toFixed(1)}%)`);

    const settled = flourishedColor(BASE, 60_000, true, false);
    expect(settled).toBe("hsl(170.0, 40.0%, 45.0%)");
  });

  it("leans hue at the peak without moving lightness", () => {
    const peak = flourishedColor(
      BASE,
      HUE_TILT_TUNING.swellSeconds * 1000,
      false,
      true,
    );
    expect(peak).toBe(
      `hsl(${(170 + HUE_TILT_TUNING.degrees).toFixed(1)}, 40.0%, 45.0%)`,
    );
  });

  it("returns an unparseable colour as it is rather than throwing", () => {
    expect(flourishedColor("var(--trail)", 100, true, true)).toBe("var(--trail)");
  });
});
