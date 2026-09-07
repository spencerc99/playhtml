// ABOUTME: Verifies the gesture stage drives the engine's real trigger paths, not a mimic
// ABOUTME: and that it hands the shared engine's notice listener back when a gesture ends

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SoundEngine } from "../../shared/sound/SoundEngine";
import { GestureStage, PUMP_INTERVAL_MS } from "../GestureStage";

let frames: FrameRequestCallback[] = [];
/** Timer callbacks the stage's hidden-tab pump is waiting on. */
let timers: Array<() => void> = [];
let now = 0;
let hidden = false;

/**
 * Advance the stage clock and run whichever step source is outstanding. Both
 * are drained, so the same helper drives a visible run (rAF) and a hidden one
 * (the timer pump) without the test having to know which is in play.
 */
function advance(seconds: number, stepSeconds = 1 / 60) {
  const target = now + seconds * 1000;
  while (now < target) {
    now = Math.min(target, now + stepSeconds * 1000);
    act(() => {
      const pendingFrames = frames;
      const pendingTimers = timers;
      frames = [];
      timers = [];
      pendingFrames.forEach((cb) => cb(now));
      pendingTimers.forEach((cb) => cb());
    });
  }
}

/** Put the document into the hidden state and fire the event the stage listens for. */
function hideDocument() {
  hidden = true;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function fakeEngine() {
  return {
    tick: vi.fn(),
    retireTrail: vi.fn(),
    triggerNavigation: vi.fn(),
    setSoundNoticeListener: vi.fn(),
    setCanvasWidth: vi.fn(),
  } as unknown as SoundEngine & {
    tick: ReturnType<typeof vi.fn>;
    retireTrail: ReturnType<typeof vi.fn>;
    triggerNavigation: ReturnType<typeof vi.fn>;
    setSoundNoticeListener: ReturnType<typeof vi.fn>;
    setCanvasWidth: ReturnType<typeof vi.fn>;
  };
}

async function renderStage(engine: SoundEngine) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(GestureStage, {
        getEngine: async () => engine,
      }),
    );
  });
  return { root, container };
}

/** Press one of the stage's buttons by its visible label. */
async function press(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`no stage button labelled "${label}"`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  frames = [];
  timers = [];
  now = 0;
  hidden = false;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // Only the stage's own pump is intercepted, recognised by the exact interval
  // it asks for. React's scheduler keeps the real timers it needs to flush its
  // work, which a blanket `setTimeout` stub would take away.
  const realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal(
    "setTimeout",
    vi.fn((cb: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === PUMP_INTERVAL_MS) {
        timers.push(cb);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      }
      return (realSetTimeout as typeof globalThis.setTimeout)(
        cb,
        ms,
        ...(rest as []),
      );
    }),
  );
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GestureStage", () => {
  it("sounds an arrival through the engine's own tick path", async () => {
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "arrival + gathering");
    // Before the arrival beat lands the stage holds no trail, so the engine is
    // told nothing — an arrival is a newly-active frame, not a bare call.
    advance(0.2);
    expect(engine.tick).not.toHaveBeenCalled();

    advance(0.5);
    expect(engine.tick).toHaveBeenCalled();
    const [, firstFrames] = engine.tick.mock.calls[0];
    expect(firstFrames).toHaveLength(1);
    expect(firstFrames[0].isNewlyActive).toBe(true);

    // Only the first frame announces the trail; the rest are it still being here.
    const later = engine.tick.mock.calls.at(-1)![1];
    expect(later[0].isNewlyActive).toBe(false);

    act(() => root.unmount());
    container.remove();
  });

  it("leaves through retireTrail, which is what sounds a departure", async () => {
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "departure + gathering");
    advance(0.4);
    expect(engine.retireTrail).not.toHaveBeenCalled();

    advance(0.4);
    expect(engine.retireTrail).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  it("marks a navigation with the engine's gong, at the trail it names", async () => {
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "navigation + knot");
    advance(1);
    expect(engine.triggerNavigation).not.toHaveBeenCalled();

    advance(0.7);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);
    const event = engine.triggerNavigation.mock.calls[0][0];
    expect(event.trailIndex).toBeTypeOf("number");
    // Panned from where the cursor actually is on the stage, not from centre.
    expect(event.x).toBeGreaterThan(0);

    act(() => root.unmount());
    container.remove();
  });

  it("hands the shared engine's notice listener back when a gesture ends", async () => {
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "arrival + gathering");
    expect(engine.setSoundNoticeListener).toHaveBeenLastCalledWith(
      expect.any(Function),
    );

    // Past the gesture's own length. The engine is shared with the replay
    // below, so a finished stage run must not keep drawing into it.
    advance(4);
    expect(engine.setSoundNoticeListener).toHaveBeenLastCalledWith(null);

    act(() => root.unmount());
    container.remove();
  });

  it("runs a gesture to its end in a hidden tab, where rAF never fires", async () => {
    hidden = true;
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "navigation + knot");
    // A hidden tab gets no animation frames at all. The stage must not be
    // waiting on one, or the gong would never sound.
    expect(frames).toHaveLength(0);
    expect(timers.length).toBeGreaterThan(0);

    advance(1.7);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);

    advance(3);
    expect(engine.setSoundNoticeListener).toHaveBeenLastCalledWith(null);

    act(() => root.unmount());
    container.remove();
  });

  it("moves a running gesture onto the pump when the tab is hidden mid-run", async () => {
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "navigation + knot");
    advance(0.5);
    expect(timers).toHaveLength(0);

    hideDocument();
    // From here the tab delivers no frames, so the pump has to be the thing
    // carrying the run to its navigation beat.
    frames = [];
    advance(1.5);
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  it("never hands the engine more travel per frame than a live cursor would", async () => {
    // A hidden tab clamps the pump to about a second whatever interval it asks
    // for, and a blocked main thread stretches an animation frame the same way.
    // Stepping that whole gap at once would put a hundred pixels of travel into
    // one frame, which the engine's distance-gated paths hear as a sprint and
    // sound at the top of their range — the blast this stage was reported for.
    hidden = true;
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "all together");
    // One step per second, which is all a hidden tab actually delivers.
    advance(11, 1);

    const travels = engine.tick.mock.calls.map(([, frames]) => {
      const f = frames[0];
      return Math.hypot(f.x - f.prevX, f.y - f.prevY);
    });
    // A 60fps frame on this wander carries about 2.3px. Nothing may exceed the
    // travel one 1/30s slice covers, whatever the step source did.
    expect(Math.max(...travels)).toBeLessThan(6);

    act(() => root.unmount());
    container.remove();
  });

  it("fires each scripted beat exactly once, however coarsely it is stepped", async () => {
    hidden = true;
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "all together");
    advance(12, 1);

    // The script is one arrival, two navigations and one departure. A beat
    // replayed per step would stack gongs on a single press.
    expect(engine.triggerNavigation).toHaveBeenCalledTimes(2);
    const newlyActive = engine.tick.mock.calls.filter(
      ([, frames]) => frames[0].isNewlyActive,
    );
    expect(newlyActive).toHaveLength(1);

    act(() => root.unmount());
    container.remove();
  });

  it("gives the shared engine its own canvas width back when a gesture ends", async () => {
    // The stage narrows the engine to its 360px scene while it plays. Left
    // there, every later pan on the page collapses into the stage's width.
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "arrival + gathering");
    expect(engine.setCanvasWidth).toHaveBeenLastCalledWith(360);

    advance(4);
    expect(engine.setCanvasWidth).toHaveBeenLastCalledWith(window.innerWidth);

    act(() => root.unmount());
    container.remove();
  });

  it("restarts from a clean stage when a second gesture is pressed", async () => {
    const engine = fakeEngine();
    const { root, container } = await renderStage(engine);

    await press(container, "navigation + knot");
    advance(0.5);
    engine.triggerNavigation.mockClear();

    // The first run still has its navigation beat pending. Starting another
    // gesture must drop it rather than letting the two scripts overlap.
    await press(container, "arrival + gathering");
    advance(3);
    expect(engine.triggerNavigation).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
