// ABOUTME: Cursor-follow cinematic camera — pure state machine + viewBox math.
// ABOUTME: AnimatedTrails feeds it per-frame cursor positions; it returns the SVG viewBox to apply.

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CinematicConfig {
  /** Only "follow" is implemented today. */
  mode: "follow";
  /** Fraction of screen width visible while following (0.25 = tight zoom). */
  zoom: number;
  /** Fly-through duration between subjects, ms. */
  transitionMs: number;
  /** 0 = pure locked-center. >0 eases the camera center toward the cursor. */
  centerLerp: number;
  /** 0 = off. >0 zooms out proportional to cursor speed (px/frame). */
  velocityZoomOut: number;
}

export interface CameraFrame {
  screenW: number;
  screenH: number;
  nowMs: number;
  /** Trails currently drawing this frame: 0 < progress < 1. */
  activeTrails: Array<{ index: number; x: number; y: number; progress: number }>;
}

export const DEFAULT_CINEMATIC_CONFIG: CinematicConfig = {
  mode: "follow",
  zoom: 0.25,
  transitionMs: 3000,
  centerLerp: 0,
  velocityZoomOut: 0,
};

type Point = { x: number; y: number };

/** Build a viewBox centered on `center`, sized so `zoom` fraction of the
 * screen width is visible, with height corrected to the screen aspect ratio
 * so trails never stretch (SVG uses preserveAspectRatio="none"). */
function boxAround(
  center: Point,
  zoom: number,
  screenW: number,
  screenH: number,
): ViewBox {
  const w = Math.max(1, screenW * zoom);
  const aspect = screenH / Math.max(1, screenW);
  const h = w * aspect;
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpBox(a: ViewBox, b: ViewBox, t: number): ViewBox {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
  };
}

/** easeInOutCubic — smooth start and stop for the fly-through. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type State = "idle" | "following" | "flying";

export class CinematicCamera {
  private config: CinematicConfig;
  private state: State = "idle";
  private subjectIndex: number | null = null;
  private currentCenter: Point | null = null;
  private lastViewBox: ViewBox | null = null;
  // Fly-through tween bookkeeping.
  private flyFrom: ViewBox | null = null;
  private flyTo: ViewBox | null = null;
  private flyStartMs = 0;
  private flyTargetIndex: number | null = null;
  // Set by requestNext(); the next tick treats the current subject as done
  // and flies to a fresh one, even mid-draw.
  private forceNext = false;

  constructor(config: CinematicConfig) {
    this.config = config;
  }

  setConfig(config: CinematicConfig): void {
    this.config = config;
  }

  reset(): void {
    this.state = "idle";
    this.subjectIndex = null;
    this.currentCenter = null;
    this.lastViewBox = null;
    this.flyFrom = null;
    this.flyTo = null;
    this.flyTargetIndex = null;
    this.forceNext = false;
  }

  /** Request an immediate fly-through to a new subject on the next frame,
   * without waiting for the current trail to finish. */
  requestNext(): void {
    this.forceNext = true;
  }

  /** Prefer a trail early in its draw so the camera rides most of it.
   * Deterministic: lowest progress wins (no RNG, keeps it predictable). */
  private selectNextSubject(
    activeTrails: CameraFrame["activeTrails"],
    exclude: number | null,
  ): number | null {
    let best: number | null = null;
    let bestProgress = Infinity;
    for (const t of activeTrails) {
      if (t.index === exclude) continue;
      if (t.progress < bestProgress) {
        bestProgress = t.progress;
        best = t.index;
      }
    }
    // If the only candidate is the excluded one, allow re-picking it rather
    // than stalling.
    if (best === null && activeTrails.length > 0) best = activeTrails[0].index;
    return best;
  }

  tick(frame: CameraFrame): ViewBox | null {
    const { activeTrails, screenW, screenH, nowMs } = frame;
    const byIndex = new Map(activeTrails.map((t) => [t.index, t]));

    // FLYING: tween regardless of subject availability; resolve on arrival.
    if (this.state === "flying" && this.flyFrom && this.flyTo) {
      // The target keeps drawing during the flight. Re-aim flyTo at its LIVE
      // position each frame (when still active) so the camera flies to where
      // the subject IS, not where it was when the flight began. Without this,
      // a fast subject moves on during the ~3s flight: the camera lands on an
      // empty spot, then snaps to the live position on arrival.
      if (this.flyTargetIndex !== null) {
        const liveTarget = byIndex.get(this.flyTargetIndex);
        if (liveTarget) {
          this.flyTo = boxAround(
            { x: liveTarget.x, y: liveTarget.y },
            this.config.zoom,
            screenW,
            screenH,
          );
        }
      }
      const raw = (nowMs - this.flyStartMs) / this.config.transitionMs;
      const t = Math.min(1, Math.max(0, raw));
      const box = lerpBox(this.flyFrom, this.flyTo, ease(t));
      this.lastViewBox = box;
      this.currentCenter = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      if (t >= 1) {
        this.state = "following";
        this.subjectIndex = this.flyTargetIndex;
        this.flyFrom = null;
        this.flyTo = null;
        this.flyTargetIndex = null;
      }
      return box;
    }

    // IDLE: wait for a subject; leave viewBox untouched until one appears.
    if (this.state === "idle") {
      const next = this.selectNextSubject(activeTrails, null);
      if (next === null) return this.lastViewBox; // null on very first frames
      this.subjectIndex = next;
      this.state = "following";
      const s = byIndex.get(next)!;
      this.currentCenter = { x: s.x, y: s.y };
      const box = boxAround(
        this.currentCenter,
        this.config.zoom,
        screenW,
        screenH,
      );
      this.lastViewBox = box;
      return box;
    }

    // FOLLOWING.
    const subject =
      this.subjectIndex !== null ? byIndex.get(this.subjectIndex) : undefined;
    const finishedOrGone =
      subject === undefined || subject.progress >= 1 || this.forceNext;

    if (finishedOrGone) {
      // Begin a fly-through to a fresh subject (or hold if none available).
      const next = this.selectNextSubject(activeTrails, this.subjectIndex);
      if (next === null) {
        // Nothing to fly to; keep following the current subject (don't strand
        // the camera) and clear the request so it isn't stuck pending.
        this.forceNext = false;
        if (subject !== undefined) {
          const box = boxAround(
            { x: subject.x, y: subject.y },
            this.config.zoom,
            screenW,
            screenH,
          );
          this.currentCenter = { x: subject.x, y: subject.y };
          this.lastViewBox = box;
          return box;
        }
        return this.lastViewBox;
      }
      this.forceNext = false;
      const target = byIndex.get(next)!;
      const targetBox = boxAround(
        { x: target.x, y: target.y },
        this.config.zoom,
        screenW,
        screenH,
      );
      this.flyFrom = this.lastViewBox ?? targetBox;
      this.flyTo = targetBox;
      this.flyTargetIndex = next;
      this.flyStartMs = nowMs;
      this.state = "flying";
      return this.flyFrom;
    }

    // Continue following the live subject.
    let center: Point = { x: subject.x, y: subject.y };
    if (this.config.centerLerp > 0 && this.currentCenter) {
      center = {
        x: lerp(this.currentCenter.x, subject.x, this.config.centerLerp),
        y: lerp(this.currentCenter.y, subject.y, this.config.centerLerp),
      };
    }
    // velocityZoomOut: widen the box when the cursor is moving fast.
    let zoom = this.config.zoom;
    if (this.config.velocityZoomOut > 0 && this.currentCenter) {
      const speed = Math.hypot(
        subject.x - this.currentCenter.x,
        subject.y - this.currentCenter.y,
      );
      zoom =
        this.config.zoom *
        (1 + this.config.velocityZoomOut * (speed / Math.max(1, screenW)));
    }
    this.currentCenter = center;
    const box = boxAround(center, zoom, screenW, screenH);
    this.lastViewBox = box;
    return box;
  }
}
