// ABOUTME: Verifies rendered ripple geometry and completion across animation frames.
// ABOUTME: Covers staggered rings, settings changes, residue, and effect cleanup.

import { act, Profiler, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RippleEffect } from "../ClickRipple";
import { CLICK_DEFAULTS } from "../clickDefaults";

const testGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const effect = {
  id: "ripple",
  x: 10,
  y: 20,
  color: "#123456",
  radiusFactor: 0.5,
  durationFactor: 0,
  startTime: 1000,
  trailIndex: 0,
};
const settings = {
  ...CLICK_DEFAULTS,
  clickMinRadius: 100,
  clickMaxRadius: 100,
  clickCoreRadius: 4,
  clickAnimationStopPoint: 1,
  clickExpansionDuration: 1000,
  clickRingDelayMs: 200,
  clickMinDuration: 3000,
  clickMaxDuration: 3000,
};

describe("RippleEffect", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    delete testGlobal.IS_REACT_ACT_ENVIRONMENT;
  });

  it("animates staggered radii without React commits and preserves completed residue", () => {
    let commits = 0;
    const completed: string[] = [];
    act(() =>
      root.render(
        <Profiler
          id="ripple"
          onRender={() => {
            commits++;
          }}
        >
          <svg>
            <RippleEffect
              effect={effect}
              settings={settings}
              onComplete={(id) => completed.push(id)}
            />
          </svg>
        </Profiler>,
      ),
    );
    expect(
      [...container.querySelectorAll("circle")].filter(
        (ring) => ring.style.display !== "none",
      ),
    ).toHaveLength(1);
    const initialCommits = commits;
    act(() => vi.advanceTimersByTime(480));
    const circles = container.querySelectorAll("circle");
    expect(Number(circles[0].getAttribute("r"))).toBe(4);
    expect(Number(circles[2].getAttribute("r"))).toBeCloseTo(
      100 * (1 - 0.92 ** 3),
    );
    expect(circles[2].style.display).toBe("");
    expect(commits).toBe(initialCommits);
    expect(completed).toEqual([]);
    act(() => vi.advanceTimersByTime(2608));
    expect(completed).toEqual(["ripple"]);
    expect(Number(circles[2].getAttribute("r"))).toBe(100);
    expect(circles[2].getAttribute("opacity")).toBe(
      String(settings.clickOpacity),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("applies settings changes and cancels animation when unmounted", () => {
    act(() =>
      root.render(
        <svg>
          <RippleEffect effect={effect} settings={settings} />
        </svg>,
      ),
    );
    act(() => vi.advanceTimersByTime(480));
    act(() =>
      root.render(
        <svg>
          <RippleEffect
            effect={effect}
            settings={{
              ...settings,
              clickNumRings: 1,
              clickMaxRadius: 200,
              clickMinRadius: 200,
              clickOpacity: 0.2,
            }}
          />
        </svg>,
      ),
    );
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(1);
    expect(Number(circles[0].getAttribute("r"))).toBeCloseTo(
      200 * (1 - 0.52 ** 3),
    );
    expect(circles[0].getAttribute("opacity")).toBe("0.2");
    act(() => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("completes an already expired ripple once in Strict Mode", () => {
    const completed: string[] = [];
    vi.setSystemTime(5000);
    act(() =>
      root.render(
        <StrictMode>
          <svg>
            <RippleEffect
              effect={effect}
              settings={settings}
              onComplete={(id) => completed.push(id)}
            />
          </svg>
        </StrictMode>,
      ),
    );
    expect(completed).toEqual(["ripple"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("scales hold rings and keeps them until the hold lifetime expires", () => {
    const completed: string[] = [];
    act(() =>
      root.render(
        <svg>
          <RippleEffect
            effect={{ ...effect, holdDuration: 2000 }}
            settings={settings}
            onComplete={(id) => completed.push(id)}
          />
        </svg>,
      ),
    );
    act(() => vi.advanceTimersByTime(3504));
    expect(
      Number(container.querySelectorAll("circle")[2].getAttribute("r")),
    ).toBe(300);
    expect(completed).toEqual([]);
    act(() => vi.advanceTimersByTime(5504));
    expect(completed).toEqual(["ripple"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
