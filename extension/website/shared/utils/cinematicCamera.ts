// ABOUTME: Cursor-follow cinematic camera — pure state machine + viewBox math.
// ABOUTME: AnimatedTrails feeds it per-frame cursor positions; it returns the SVG viewBox to apply.

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CinematicConfig {
  /** "follow" rides cursors and flies between them; "reveal" runs a one-shot
   * scripted pull-back from a tight cursor close-up to the full canvas. */
  mode: "follow" | "reveal";
  /** Fraction of screen width visible while following (0.25 = tight zoom). */
  zoom: number;
  /** Fly-through duration between subjects, ms. */
  transitionMs: number;
  /** 0 = pure locked-center. >0 eases the camera center toward the cursor. */
  centerLerp: number;
  /** 0 = off. >0 zooms out proportional to cursor speed (px/frame). */
  velocityZoomOut: number;
  /** reveal mode: ms to pull back from the tight close-up to full canvas. */
  revealMs: number;
  /** reveal mode: fraction of screen width visible at the start (tightest). */
  revealStartZoom: number;
  /** follow mode: lock onto this trail index instead of auto-picking. When set,
   * the camera pins to that one cursor and never advances to other subjects;
   * if the trail isn't active it holds its last known spot. null/undefined =
   * default auto-pick behavior. */
  forcedSubjectIndex?: number | null;
  /** follow mode: choose which active cursor to ride next. Called both for the
   * initial pick and each time the current subject finishes. Receives every
   * active candidate this frame and the index the camera is currently on (null
   * when idle); returns the index to follow, or null to hold. Coordination logic
   * (e.g. cross-window claims so no two screens follow the same cursor) lives in
   * the caller — the camera stays pure. Ignored by `forcedSubjectIndex` (which
   * takes precedence) and by reveal mode. When undefined, the camera uses its
   * built-in lowest-progress pick (default single-window behavior). */
  pickSubject?: (
    candidates: Array<{ index: number; x: number; y: number; progress: number }>,
    currentIndex: number | null,
  ) => number | null;
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
  revealMs: 10000,
  revealStartZoom: 0.18,
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
  // reveal mode: captured at the first frame that has an active cursor.
  private revealStartMs = 0;
  private revealSubjectIndex: number | null = null;
  // Last known position of the reveal subject, so the camera keeps a sensible
  // center even after that cursor finishes and drops out of activeTrails.
  private revealSubjectLast: Point | null = null;
  // Last known position of the forced follow subject, so a locked camera holds
  // a sensible center while that cursor is inactive (not yet started/finished).
  private forcedSubjectLast: Point | null = null;

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
    this.revealStartMs = 0;
    this.revealSubjectIndex = null;
    this.revealSubjectLast = null;
    this.forcedSubjectLast = null;
  }

  /** Request an immediate fly-through to a new subject on the next frame,
   * without waiting for the current trail to finish. */
  requestNext(): void {
    this.forceNext = true;
  }

  /** The trail index the camera is currently riding in follow mode, or null.
   * Reflects the forced/reveal subject when those modes are active. Read by
   * dev/test tooling to verify multi-window coordination (distinct subjects). */
  getCurrentSubjectIndex(): number | null {
    if (this.config.mode === "reveal") return this.revealSubjectIndex;
    if (
      this.config.forcedSubjectIndex !== null &&
      this.config.forcedSubjectIndex !== undefined
    ) {
      return this.config.forcedSubjectIndex;
    }
    // While flying to a new subject, report the target so the reported index
    // switches at the moment the camera commits to the next cursor.
    if (this.state === "flying") return this.flyTargetIndex;
    return this.subjectIndex;
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

  /** Follow-mode subject selection. Delegates to an injected `pickSubject`
   * (e.g. claims-aware cross-window coordination) when the config provides one;
   * otherwise falls back to the built-in lowest-progress pick. `exclude` is the
   * current subject when advancing after it finishes, and doubles as the
   * `currentIndex` passed to an injected selector so it can keep its current
   * subject when still valid. */
  private pickFollowSubject(
    activeTrails: CameraFrame["activeTrails"],
    exclude: number | null,
  ): number | null {
    if (this.config.pickSubject) {
      return this.config.pickSubject(activeTrails, exclude);
    }
    return this.selectNextSubject(activeTrails, exclude);
  }

  tick(frame: CameraFrame): ViewBox | null {
    const { activeTrails, screenW, screenH, nowMs } = frame;

    // REVEAL: one-shot scripted pull-back. Lock onto the first cursor that
    // appears and FOLLOW it while zoomed in; over revealMs ease both the zoom
    // out to the full canvas AND the center from the live cursor toward the
    // canvas center, so it lands framed on the whole field.
    if (this.config.mode === "reveal") {
      if (this.revealSubjectIndex === null) {
        // Hold the tight start-zoom on canvas center until the first cursor
        // appears. Returning the full canvas here instead lets the first trail
        // draw zoomed-OUT for a few frames, then the lock snaps the camera in —
        // which reads as the opening cursor drawing once, then restarting under
        // the zoom. Pre-framing tight means the lock is a small pan, not a jump.
        const first = this.selectNextSubject(activeTrails, null);
        if (first === null) {
          return boxAround(
            { x: screenW / 2, y: screenH / 2 },
            this.config.revealStartZoom,
            screenW,
            screenH,
          );
        }
        const s = activeTrails.find((t) => t.index === first)!;
        this.revealSubjectIndex = first;
        this.revealSubjectLast = { x: s.x, y: s.y };
        this.revealStartMs = nowMs;
      }

      // Track the subject's live position; if it has finished/left, hold its
      // last known spot.
      const live = activeTrails.find((t) => t.index === this.revealSubjectIndex);
      if (live) this.revealSubjectLast = { x: live.x, y: live.y };
      const subjectCenter = this.revealSubjectLast!;

      const t = Math.min(
        1,
        Math.max(0, (nowMs - this.revealStartMs) / this.config.revealMs),
      );
      const e = ease(t);

      // Zoom eases from tight (revealStartZoom) to full canvas (1).
      const zoom = this.config.revealStartZoom + (1 - this.config.revealStartZoom) * e;
      // Center eases from the live subject to the canvas center.
      const canvasCenter = { x: screenW / 2, y: screenH / 2 };
      const center = {
        x: subjectCenter.x + (canvasCenter.x - subjectCenter.x) * e,
        y: subjectCenter.y + (canvasCenter.y - subjectCenter.y) * e,
      };
      const box = boxAround(center, zoom, screenW, screenH);
      this.lastViewBox = box;
      return box;
    }

    const byIndex = new Map(activeTrails.map((t) => [t.index, t]));

    // FORCED FOLLOW: pin to one trail index and never advance to other
    // subjects. Track its live position while active; hold its last known spot
    // (or canvas center if never seen) while inactive. Deterministic so a
    // master and follower agree on which cursor index N refers to.
    if (
      this.config.mode === "follow" &&
      this.config.forcedSubjectIndex !== null &&
      this.config.forcedSubjectIndex !== undefined
    ) {
      const live = byIndex.get(this.config.forcedSubjectIndex);
      if (live) this.forcedSubjectLast = { x: live.x, y: live.y };
      const center =
        this.forcedSubjectLast ?? { x: screenW / 2, y: screenH / 2 };
      const box = boxAround(center, this.config.zoom, screenW, screenH);
      this.lastViewBox = box;
      this.currentCenter = center;
      return box;
    }

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
      const next = this.pickFollowSubject(activeTrails, this.subjectIndex);
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

    // Coordination yield: with an injected selector, re-consult it each frame
    // even mid-draw so the camera can hop off a cursor another window has taken
    // (the selector returns a DIFFERENT index only when this window must yield;
    // otherwise it returns the current index and we keep following). Skipped for
    // the default lowest-progress path, which only advances on finish. Resolved
    // as a normal fly-through below via `yieldTarget`.
    let yieldTarget: number | null = null;
    if (
      !finishedOrGone &&
      subject !== undefined &&
      this.config.pickSubject &&
      this.subjectIndex !== null
    ) {
      const preferred = this.config.pickSubject(activeTrails, this.subjectIndex);
      if (
        preferred !== null &&
        preferred !== this.subjectIndex &&
        byIndex.has(preferred)
      ) {
        yieldTarget = preferred;
      }
    }

    if (finishedOrGone || yieldTarget !== null) {
      // Begin a fly-through to a fresh subject (or hold if none available).
      // On a forceNext (N key / next signal) the current subject may still be
      // active — drop it from the candidate set so even a "keep current when
      // valid" selector is forced to move to a different cursor. A coordination
      // yield already carries its resolved target.
      let next: number | null;
      if (yieldTarget !== null) {
        next = yieldTarget;
      } else {
        const forced = this.forceNext;
        const candidates =
          forced && this.subjectIndex !== null
            ? activeTrails.filter((t) => t.index !== this.subjectIndex)
            : activeTrails;
        next = this.pickFollowSubject(candidates, this.subjectIndex);
      }
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
