// ABOUTME: Where each drawn trail's head is, written per frame by the animator
// ABOUTME: Read by anything that has to place a sound or a gesture on a trail it did not draw

/** One trail's head, in the animator's own coordinate space. */
export interface TrailPosition {
  trailIndex: number;
  x: number;
  y: number;
  color: string;
  /** Stroke width the trail is drawn at, so a mark can be sized off the line. */
  strokeWidth: number;
}

/**
 * The positions of every trail the animator is drawing.
 *
 * The animator owns the rAF loop and is the only thing that knows where a
 * trail's head is on any given frame. Everything else that has to place
 * something on a trail — the navigation accent panning to the trail that
 * hopped, the gesture a sound notice asks to be drawn — reaches for it here
 * rather than re-deriving the frame or being folded into the animator.
 *
 * A trail that has finished drawing keeps its last position. A navigation is
 * scheduled from the data's own clock while a trail is drawn on the playback
 * clock, so the two are close but never simultaneous: forgetting a trail the
 * instant it finishes means a hop landing a frame later has nowhere to go.
 * Everything is dropped when the playback loop restarts, which is the only
 * point at which a stale position could survive into a different scene.
 *
 * Written imperatively and read imperatively. Nothing here is React state:
 * it changes every frame, and turning it into state would re-render the whole
 * trail layer sixty times a second.
 */
export class TrailPositions {
  private byIndex = new Map<number, TrailPosition>();
  private byPid = new Map<string, number>();

  /** Record where one trail is this frame. */
  set(position: TrailPosition, pid: string): void {
    this.byIndex.set(position.trailIndex, position);
    this.byPid.set(pid, position.trailIndex);
  }

  clear(): void {
    this.byIndex.clear();
    this.byPid.clear();
  }

  get(trailIndex: number): TrailPosition | null {
    return this.byIndex.get(trailIndex) ?? null;
  }

  /**
   * The trail a participant most recently had on the canvas. A participant can
   * own several trails across a dataset, so the last one written for them is
   * the one to place on.
   */
  forParticipant(pid: string): TrailPosition | null {
    const trailIndex = this.byPid.get(pid);
    return trailIndex === undefined ? null : this.get(trailIndex);
  }
}
