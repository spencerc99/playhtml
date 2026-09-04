// ABOUTME: Visual gestures for the replay canvas, each one fired by the sound it stands for
// ABOUTME: Holds the gathering specks, navigation knots, lightness surge and hue tilt

import { SoundNotice } from "../shared/sound/types";
import { parseColorToHsl } from "../shared/utils/eventUtils";

/**
 * Which visual gestures are drawn. Each pairs with a sound and is fired from
 * that sound's own trigger, so a gesture is only ever seen for a note that
 * actually played.
 */
export interface VisualConfig {
  /** Specks converging into an arriving trail, dispersing from a leaving one. */
  gathering: boolean;
  /** A permanent bead on the trail at each navigation. */
  knot: boolean;
  /** The recent path brightening at a navigation, then settling. */
  lightnessSurge: boolean;
  /** The trail's hue leaning aside at a navigation, then returning. */
  hueTilt: boolean;
}

/**
 * What the playground opens on. Gathering and knot are the two gestures that
 * carry information — who arrived, and where they turned a page — so both are
 * on. The surge and the tilt are two flavours of the same transient drama at
 * the same moment, so only one starts on; the other is there to compare it
 * against.
 */
export const VISUAL_DEFAULTS: VisualConfig = {
  gathering: true,
  knot: true,
  lightnessSurge: true,
  hueTilt: false,
};

/**
 * Gathering: a handful of specks drifting in from a small radius and landing
 * on the cursor's entry point, one per chime note. A departure runs it
 * backwards — the specks leave the point and fade outwards as the chime falls.
 */
export const GATHERING_TUNING = {
  /** How far out a speck starts (arrival) or ends (departure), in pixels. */
  radiusPx: 40,
  /** Radius of one speck, in pixels. */
  speckRadiusPx: 1,
  /** Peak opacity of a speck, kept under the trail's own line. */
  peakAlpha: 0.5,
  /**
   * How long one speck takes to travel. Held slightly under the gap between
   * chime notes plus this, so specks overlap into a drift rather than arriving
   * as separate blinks.
   */
  travelSeconds: 0.45,
  /** Ceiling on simultaneous gatherings, so a busy stretch stays quiet. */
  maxConcurrent: 12,
};

/**
 * Knot: a filled bead left on the trail wherever that trail navigated, with a
 * one-time ring opening out of it as it forms.
 */
export const KNOT_TUNING = {
  /** Bead radius as a multiple of the trail's stroke width at full weight. */
  radiusStrokeMultiple: 2,
  /** The trail stroke width the multiple is taken against, in pixels. */
  strokeWidthPx: 1.5,
  /** Bead opacity. Low enough to read as part of the trail, not on top of it. */
  alpha: 0.55,
  /** How long the forming ring takes to open and fade, in seconds. */
  ringSeconds: 0.6,
  /** How far past the bead the ring opens, as a multiple of the bead radius. */
  ringRadiusMultiple: 4,
  /** Peak ring opacity, at the moment it starts. */
  ringPeakAlpha: 0.35,
  /**
   * Beads kept per trail, oldest dropped. Dense browsing would otherwise turn
   * a trail into a string of beads with no path left to read between them.
   */
  maxPerTrail: 12,
};

/**
 * Lightness surge: the last stretch of a trail's path lifting in lightness at
 * the navigation moment, on the gong's own envelope — a fast swell, a slow
 * settle — and never persisting.
 */
export const SURGE_TUNING = {
  /** How much of the path behind the cursor brightens, in ms of travel. */
  spanMs: 1500,
  /** Lightness points added at the peak. */
  liftPoints: 18,
  /** Time to reach the peak, in seconds. */
  swellSeconds: 0.3,
  /** Time to settle back from the peak, in seconds. */
  settleSeconds: 1.2,
};

/**
 * Hue tilt: the whole trail's drawn hue leaning to one side at the navigation
 * moment and returning. The stored colour is untouched, so the participant's
 * identity and their sound register are unaffected.
 */
export const HUE_TILT_TUNING = {
  /** Degrees the hue leans at the peak. */
  degrees: 10,
  /** Time to reach the lean, in seconds. */
  swellSeconds: 0.3,
  /** Time to return, in seconds. */
  returnSeconds: 1.2,
};

/** One speck of a gathering, on its own leg of the drift. */
interface Speck {
  /** Where the speck starts, relative to the gathering's point, in pixels. */
  offsetX: number;
  offsetY: number;
  /** Replay clock the speck begins its travel at, in ms. */
  startMs: number;
}

/** A gathering in progress, anchored where the trail entered or left. */
export interface Gathering {
  trailIndex: number;
  x: number;
  y: number;
  color: string;
  /** True when specks converge inward, false when they disperse outward. */
  rising: boolean;
  specks: Speck[];
  /** Replay clock past which nothing of this gathering is still drawn. */
  endsMs: number;
}

/** A bead marking one navigation, fixed to the point the trail was at. */
export interface Knot {
  x: number;
  y: number;
  /** Replay clock the bead formed at, which paces its one-time ring. */
  formedMs: number;
}

/** A trail's transient response to its own navigation gong. */
export interface Flourish {
  /** Replay clock the gong fired at. */
  startMs: number;
}

/**
 * Everything the canvas draws that a sound asked for. Owned by the replay
 * driver and cleared when the sample is swapped or the loop comes round, so
 * each pass through a sample is drawn as a fresh performance.
 */
export class SoundVisuals {
  private config: VisualConfig = { ...VISUAL_DEFAULTS };
  private gatherings: Gathering[] = [];
  private knots: Map<number, Knot[]> = new Map();
  private flourishes: Map<number, Flourish> = new Map();
  /**
   * The replay clock, kept current by the driver. Notices arrive from the
   * engine mid-frame with no time of their own, so they are stamped with this.
   */
  private nowMs = 0;

  setConfig(config: VisualConfig): void {
    this.config = { ...config };
    if (!config.gathering) this.gatherings.length = 0;
    if (!config.knot) this.knots.clear();
    if (!config.lightnessSurge && !config.hueTilt) this.flourishes.clear();
  }

  setNow(nowMs: number): void {
    this.nowMs = nowMs;
  }

  /** Drop everything. A data swap or a loop restart is a fresh performance. */
  clear(): void {
    this.gatherings.length = 0;
    this.knots.clear();
    this.flourishes.clear();
  }

  /** Forget one trail, when it is retired from the scene. */
  retireTrail(trailIndex: number): void {
    this.knots.delete(trailIndex);
    this.flourishes.delete(trailIndex);
  }

  /**
   * Start the gesture a sound just asked for. `locate` answers where the trail
   * is and what colour it is drawn in, which the notice itself does not carry
   * — an arrival names a trail, and a departure's trail has already left the
   * driver's active set by the time its chime sounds.
   */
  handleNotice(
    notice: SoundNotice,
    locate: (
      trailIndex: number,
    ) => { x: number; y: number; color: string } | null,
  ): void {
    if (notice.kind === "arrival") {
      if (!this.config.gathering) return;
      if (this.gatherings.length >= GATHERING_TUNING.maxConcurrent) return;
      const at = locate(notice.trailIndex);
      if (!at) return;
      this.gatherings.push(
        buildGathering(notice, at, this.nowMs, notice.trailIndex),
      );
      return;
    }

    if (!this.config.knot && !this.config.lightnessSurge && !this.config.hueTilt) {
      return;
    }
    if (notice.trailIndex === undefined) return;
    const at = locate(notice.trailIndex);
    if (!at) return;

    if (this.config.knot) {
      const beads = this.knots.get(notice.trailIndex) ?? [];
      beads.push({ x: at.x, y: at.y, formedMs: this.nowMs });
      // Oldest first, so the cap drops the bead furthest behind the cursor.
      while (beads.length > KNOT_TUNING.maxPerTrail) beads.shift();
      this.knots.set(notice.trailIndex, beads);
    }

    if (this.config.lightnessSurge || this.config.hueTilt) {
      this.flourishes.set(notice.trailIndex, { startMs: this.nowMs });
    }
  }

  /** Drop gestures whose time has passed, so nothing accumulates across a loop. */
  prune(nowMs: number): void {
    this.nowMs = nowMs;
    this.gatherings = this.gatherings.filter(
      (gathering) => gathering.endsMs > nowMs,
    );
    const flourishMs =
      (SURGE_TUNING.swellSeconds + SURGE_TUNING.settleSeconds) * 1000;
    for (const [trailIndex, flourish] of this.flourishes) {
      if (nowMs - flourish.startMs > flourishMs) {
        this.flourishes.delete(trailIndex);
      }
    }
  }

  getGatherings(): readonly Gathering[] {
    return this.gatherings;
  }

  getKnots(trailIndex: number): readonly Knot[] {
    return this.knots.get(trailIndex) ?? [];
  }

  getFlourish(trailIndex: number): Flourish | undefined {
    return this.flourishes.get(trailIndex);
  }
}

/**
 * Lay one gathering out from the chime that asked for it: one speck per note,
 * each starting when its note lands, scattered evenly around the point at
 * offsets seeded by the note order so the drift is not a rotating pinwheel.
 */
export function buildGathering(
  notice: Extract<SoundNotice, { kind: "arrival" }>,
  at: { x: number; y: number; color: string },
  nowMs: number,
  trailIndex: number,
): Gathering {
  const { radiusPx, travelSeconds } = GATHERING_TUNING;
  const offsets = notice.noteOffsetsSeconds;
  const specks: Speck[] = offsets.map((offsetSeconds, order) => {
    // Spread around the circle with a per-gathering rotation, so two trails
    // arriving together do not draw the same star.
    const angle =
      ((order + 0.5) / offsets.length) * Math.PI * 2 +
      (trailIndex % 7) * (Math.PI / 7);
    return {
      offsetX: Math.cos(angle) * radiusPx,
      offsetY: Math.sin(angle) * radiusPx,
      startMs: nowMs + offsetSeconds * 1000,
    };
  });
  const lastStart = specks.length > 0 ? specks[specks.length - 1].startMs : nowMs;
  return {
    trailIndex,
    x: at.x,
    y: at.y,
    color: at.color,
    rising: notice.rising,
    specks,
    endsMs: lastStart + travelSeconds * 1000,
  };
}

/**
 * A gong flourish's progress through its envelope, 0 at rest and 1 at the
 * peak: a fast swell to the peak, then a slower settle back to nothing.
 */
export function flourishEnvelope(
  elapsedMs: number,
  swellSeconds: number,
  settleSeconds: number,
): number {
  if (elapsedMs < 0) return 0;
  const swellMs = swellSeconds * 1000;
  if (elapsedMs < swellMs) return elapsedMs / swellMs;
  const settleMs = settleSeconds * 1000;
  const settled = (elapsedMs - swellMs) / settleMs;
  return settled >= 1 ? 0 : 1 - settled;
}

/**
 * The colour a trail is drawn in this instant: its own, unless a gong flourish
 * is lifting its lightness or leaning its hue. Both are transient — the stored
 * colour never changes, so a participant's identity and the register their
 * sound is voiced in are untouched.
 */
export function flourishedColor(
  color: string,
  elapsedMs: number,
  lightnessSurge: boolean,
  hueTilt: boolean,
): string {
  if (!lightnessSurge && !hueTilt) return color;
  const hsl = parseColorToHsl(color);
  if (!hsl) return color;

  let { h, s, l } = hsl;
  if (lightnessSurge) {
    const amount = flourishEnvelope(
      elapsedMs,
      SURGE_TUNING.swellSeconds,
      SURGE_TUNING.settleSeconds,
    );
    l = Math.min(95, l + SURGE_TUNING.liftPoints * amount);
  }
  if (hueTilt) {
    const amount = flourishEnvelope(
      elapsedMs,
      HUE_TILT_TUNING.swellSeconds,
      HUE_TILT_TUNING.returnSeconds,
    );
    h = (h + HUE_TILT_TUNING.degrees * amount + 360) % 360;
  }
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}
