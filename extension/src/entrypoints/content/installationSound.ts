// ABOUTME: Sonifies live browsing with the same engine the installation screens use.
// ABOUTME: One voice follows the local cursor; clicks ring the bell, silence releases the voice.

import { SoundEngine } from "@movement/sound/SoundEngine";
import { attachSoundWakeListeners } from "@movement/sound/soundWake";

/** The local cursor is the only trail this engine ever plays. */
const LOCAL_TRAIL_INDEX = 0;

/**
 * Reads the shape of a cursor from the element under it. Installation mode
 * paints the page `cursor: none`, so the computed style says nothing — the
 * element's own role is what gives each kind of target its instrument.
 */
export function cursorTypeForTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "default";
  if (target.closest("a, button, [role='button'], summary, label")) {
    return "pointer";
  }
  if (
    target.closest("input, textarea, [contenteditable='true'], [role='textbox']")
  ) {
    return "text";
  }
  return "default";
}

export interface InstallationSound {
  /** Follows the pointer; the next tick turns it into pitch, gain, and pan. */
  move(x: number, y: number, target: EventTarget | null): void;
  /** Advances the engine one animation frame. Safe to call before sound starts. */
  tick(): void;
  /** Rings a bell for a click, or a heavier one for a hold. */
  click(x: number, y: number, holdDuration?: number): void;
  /** Releases the voice when movement stops or the tab goes away. */
  idle(): void;
  setWidth(width: number): void;
  /** "off" when muted, "pending" until a gesture starts audio, then "playing". */
  state(): "off" | "pending" | "playing";
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/**
 * Builds the browsing voice. The engine is created on the first user gesture
 * because browsers refuse to start audio before one; every call before then is
 * a no-op rather than an error.
 */
export function createInstallationSound(color: string): InstallationSound {
  let engine: SoundEngine | null = null;
  let starting = false;
  let enabled = true;
  let disposed = false;
  let width = window.innerWidth;
  let point: { x: number; y: number; cursorType: string } | null = null;
  let sounding = false;
  let detachWake: (() => void) | null = null;

  const start = () => {
    if (engine || starting || disposed || !enabled) return;
    starting = true;
    const next = new SoundEngine();
    next
      .init()
      .then(() => {
        if (disposed || !enabled) {
          next.dispose();
          return;
        }
        next.setCanvasWidth(width);
        next.setConfig({ cursorInstruments: true });
        engine = next;
        detachWake = attachSoundWakeListeners(() => engine?.resume());
      })
      .catch(() => undefined)
      .finally(() => {
        starting = false;
      });
  };

  // A gesture is what unblocks audio, so listen for the first one either way.
  const onGesture = () => start();
  document.addEventListener("pointerdown", onGesture, true);
  document.addEventListener("keydown", onGesture, true);

  return {
    move(x, y, target) {
      point = { x, y, cursorType: cursorTypeForTarget(target) };
      start();
    },
    tick() {
      if (!engine || !point) return;
      sounding = true;
      engine.tick(performance.now(), [
        {
          trailIndex: LOCAL_TRAIL_INDEX,
          x: point.x,
          y: point.y,
          prevX: point.x,
          prevY: point.y,
          cursorType: point.cursorType,
          progress: 1,
          color,
          isNewlyActive: false,
        },
      ]);
    },
    click(x, y, holdDuration) {
      start();
      engine?.triggerClick({ x, y, holdDuration });
    },
    idle() {
      if (!engine || !sounding) return;
      sounding = false;
      engine.retireTrail(LOCAL_TRAIL_INDEX);
    },
    state() {
      if (!enabled) return "off";
      return engine ? "playing" : "pending";
    },
    setWidth(next) {
      width = next;
      engine?.setCanvasWidth(next);
    },
    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (next) {
        start();
        return;
      }
      detachWake?.();
      detachWake = null;
      engine?.dispose();
      engine = null;
      sounding = false;
    },
    dispose() {
      disposed = true;
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
      detachWake?.();
      detachWake = null;
      engine?.dispose();
      engine = null;
    },
  };
}
