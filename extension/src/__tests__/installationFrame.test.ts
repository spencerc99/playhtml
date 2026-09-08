// ABOUTME: Covers the installation frame's pure trace and sound helpers.
// ABOUTME: Stroke splitting, fade math, and instrument choice run without a browser.

import { describe, it, expect } from "vitest";
import { toPreviousStrokes } from "../entrypoints/content/installationFrame";
import {
  LIVE_ALPHA,
  SETTLED_ALPHA,
  rippleRings,
  settledAlpha,
} from "../entrypoints/content/installationTrace";
import { cursorTypeForTarget } from "../entrypoints/content/installationSound";

const size = { width: 1000, height: 500 };

describe("toPreviousStrokes", () => {
  it("scales normalized points into viewport space", () => {
    const strokes = toPreviousStrokes(
      [
        { type: "cursor", ts: 1000, data: { x: 0.25, y: 0.5 } },
        { type: "cursor", ts: 1200, data: { x: 0.75, y: 1 } },
      ],
      size,
    );

    expect(strokes).toEqual([
      [
        { x: 250, y: 250, t: 1000 },
        { x: 750, y: 500, t: 1200 },
      ],
    ]);
  });

  it("splits strokes where browsing paused", () => {
    const strokes = toPreviousStrokes(
      [
        { type: "cursor", ts: 0, data: { x: 0, y: 0 } },
        { type: "cursor", ts: 300, data: { x: 0.1, y: 0.1 } },
        { type: "cursor", ts: 9000, data: { x: 0.2, y: 0.2 } },
        { type: "cursor", ts: 9200, data: { x: 0.3, y: 0.3 } },
      ],
      size,
    );

    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toHaveLength(2);
    expect(strokes[1]).toHaveLength(2);
  });

  it("drops single-point strokes, other event types, and invalid points", () => {
    const strokes = toPreviousStrokes(
      [
        { type: "keyboard", ts: 0, data: { x: 0.5, y: 0.5 } },
        { type: "cursor", ts: 100, data: { x: 0.5, y: 0.5 } },
        { type: "cursor", ts: 20000, data: { x: 4, y: 0.5 } },
        { type: "cursor", ts: 20100, data: null },
      ],
      size,
    );

    expect(strokes).toEqual([]);
  });

  it("orders out-of-sequence events before splitting", () => {
    const strokes = toPreviousStrokes(
      [
        { type: "cursor", ts: 400, data: { x: 0.4, y: 0.4 } },
        { type: "cursor", ts: 100, data: { x: 0.1, y: 0.1 } },
      ],
      size,
    );

    expect(strokes[0].map((point) => point.t)).toEqual([100, 400]);
  });
});

describe("settledAlpha", () => {
  it("settles a finished stroke, holds it, then lets it depart", () => {
    expect(settledAlpha(0)).toBe(LIVE_ALPHA);
    expect(settledAlpha(600)).toBeCloseTo((LIVE_ALPHA + SETTLED_ALPHA) / 2, 5);
    expect(settledAlpha(1200)).toBeCloseTo(SETTLED_ALPHA, 5);
    // Held at the dim for the whole hold, then eased out.
    expect(settledAlpha(30_000)).toBeCloseTo(SETTLED_ALPHA, 5);
    expect(settledAlpha(46_500)).toBeCloseTo(SETTLED_ALPHA / 2, 5);
    expect(settledAlpha(48_000)).toBe(0);
    expect(settledAlpha(90_000)).toBe(0);
  });
});

describe("rippleRings", () => {
  const ripple = {
    x: 10,
    y: 10,
    startTime: 1000,
    radiusFactor: 0.5,
    durationFactor: 0.5,
  };

  it("opens rings one after another, each freezing at its own radius", () => {
    expect(rippleRings(ripple, 1000)).toEqual([]);
    const early = rippleRings(ripple, 1100);
    expect(early).toHaveLength(1);
    expect(early[0].radius).toBeGreaterThan(0);
    expect(rippleRings(ripple, 1500)).toHaveLength(3);

    // Every ring expands at the same velocity, so the outer ones start later
    // and overtake the core, which has already stopped.
    const late = rippleRings(ripple, 3600);
    expect(late[0].radius).toBeLessThan(late[2].radius);
    expect(rippleRings(ripple, 2000)[0].radius).toBeCloseTo(
      rippleRings(ripple, 3000)[0].radius,
      5,
    );
  });

  it("fades out and then stops drawing", () => {
    const late = rippleRings(ripple, 3600);
    expect(late[0].alpha).toBeLessThan(rippleRings(ripple, 1500)[0].alpha);
    expect(rippleRings(ripple, 10_000)).toEqual([]);
  });

  it("gives a held click a bigger, longer ripple", () => {
    const held = { ...ripple, holdDuration: 2000 };
    // The plain ripple is over by now; the held one is still opening.
    expect(rippleRings(ripple, 5000)).toEqual([]);
    expect(rippleRings(held, 5000)[2].radius).toBeGreaterThan(
      rippleRings(ripple, 3600)[2].radius,
    );
  });
});

describe("cursorTypeForTarget", () => {
  it("reads the instrument from the element under the cursor", () => {
    document.body.innerHTML = `
      <a href="#" id="link"><span id="inside-link">go</span></a>
      <button id="button">press</button>
      <input id="input" />
      <div id="plain">text</div>
    `;
    const at = (id: string) => document.getElementById(id);

    expect(cursorTypeForTarget(at("inside-link"))).toBe("pointer");
    expect(cursorTypeForTarget(at("button"))).toBe("pointer");
    expect(cursorTypeForTarget(at("input"))).toBe("text");
    expect(cursorTypeForTarget(at("plain"))).toBe("default");
    expect(cursorTypeForTarget(null)).toBe("default");
  });
});
