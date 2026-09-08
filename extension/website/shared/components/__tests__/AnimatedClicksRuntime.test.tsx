// ABOUTME: Exercises SVG ripple animation with real frames and DOM elements.
// ABOUTME: Checks settling, settings updates, shared scheduling, and cleanup.
import { act, Profiler, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnimatedClicks } from "../AnimatedClicks";
import { RippleEffect } from "../ClickRipple";
import { subscribeRippleFrame } from "../rippleFrames";
import { CLICK_DEFAULTS } from "../clickDefaults";

const testGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const effect = {
  id: "click",
  x: 10,
  y: 20,
  color: "#123456",
  radiusFactor: 0.5,
  durationFactor: 0.5,
  startTime: 0,
  trailIndex: 0,
};

function frame() {
  return new Promise<number>((resolve) => requestAnimationFrame(resolve));
}

describe("RippleEffect SVG animation", () => {
  it("settles once and redraws retained marks when ring settings change", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const completed: string[] = [];
    const render = (rings: number) => (
      <StrictMode>
        <svg>
          <RippleEffect
            effect={effect}
            settings={{ ...CLICK_DEFAULTS, clickNumRings: rings }}
            onComplete={(id) => completed.push(id)}
          />
        </svg>
      </StrictMode>
    );
    try {
      await act(async () => root.render(render(6)));
      expect(container.querySelectorAll("circle")).toHaveLength(6);
      const radii = [...container.querySelectorAll("circle")].map((c) =>
        Number(c.getAttribute("r")),
      );
      expect(radii[0]).toBe(CLICK_DEFAULTS.clickCoreRadius);
      expect(radii[5]).toBeGreaterThan(radii[0]);
      expect(completed).toEqual(["click"]);
      await act(async () => root.render(render(1)));
      expect(container.querySelectorAll("circle")).toHaveLength(1);
      expect(Number(container.querySelector("circle")!.getAttribute("r"))).toBe(
        radii[5],
      );
      expect(completed).toEqual(["click"]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("expands on real frames without React commits and stops after unmount", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    let commits = 0;
    try {
      await act(async () =>
        root.render(
          <Profiler id="ripple" onRender={() => commits++}>
            <svg>
              <RippleEffect
                effect={{ ...effect, startTime: Date.now() }}
                settings={{
                  ...CLICK_DEFAULTS,
                  clickNumRings: 1,
                  clickExpansionDuration: 1000,
                }}
              />
            </svg>
          </Profiler>,
        ),
      );
      const circle = container.querySelector("circle")!;
      const initial = Number(circle.getAttribute("r"));
      const initialCommits = commits;
      await frame();
      await frame();
      expect(Number(circle.getAttribute("r"))).toBeGreaterThan(initial);
      expect(commits).toBe(initialCommits);
      await act(async () => root.unmount());
      const radius = circle.getAttribute("r");
      await frame();
      expect(circle.getAttribute("r")).toBe(radius);
    } finally {
      if (container.childNodes.length) await act(async () => root.unmount());
    }
  });

  it("shares a timestamp and retires completed and unsubscribed callbacks", async () => {
    const first: number[] = [];
    const second: number[] = [];
    const stopFirst = subscribeRippleFrame((now) => {
      first.push(now);
      return false;
    });
    const stopSecond = subscribeRippleFrame((now) => {
      second.push(now);
      return true;
    });
    try {
      await frame();
      expect(first).toHaveLength(1);
      expect(second).toEqual(first);
      stopSecond();
      await frame();
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
    } finally {
      stopFirst();
      stopSecond();
    }
  });
});

describe("AnimatedClicks playback", () => {
  it("replays finished clicks while retaining earlier marks", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <AnimatedClicks
            scheduledClicks={[
              { id: "repeat", x: 20, y: 30, color: "#123456", spawnAtMs: 0 },
            ]}
            timeRange={{ duration: 1 }}
            settings={{
              ...CLICK_DEFAULTS,
              animationSpeed: 1,
              clickNumRings: 1,
              clickMinDuration: 1,
              clickMaxDuration: 1,
              clickExpansionDuration: 1,
            }}
          />,
        ),
      );
      for (let i = 0; i < 8; i++)
        await act(async () => {
          await frame();
        });
      expect(container.querySelectorAll("circle").length).toBeGreaterThan(1);
      expect(
        [...container.querySelectorAll("circle")].some(
          (circle) => Number(circle.getAttribute("r")) > 0,
        ),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("spawns an unsorted schedule in time order and deduplicates event ids", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <AnimatedClicks
            scheduledClicks={[
              { id: "later", x: 90, y: 30, color: "#123456", spawnAtMs: 60 },
              { id: "first", x: 20, y: 30, color: "#123456", spawnAtMs: 0 },
              { id: "first", x: 20, y: 30, color: "#123456", spawnAtMs: 0 },
            ]}
            timeRange={{ duration: 100000 }}
            settings={{
              ...CLICK_DEFAULTS,
              animationSpeed: 1,
              clickNumRings: 1,
            }}
          />,
        ),
      );
      for (let i = 0; i < 10; i++)
        await act(async () => {
          await frame();
        });
      expect(
        [...container.querySelectorAll("circle")].map((circle) =>
          circle.getAttribute("cx"),
        ),
      ).toEqual(["20", "90"]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
