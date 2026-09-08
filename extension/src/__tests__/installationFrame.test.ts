// ABOUTME: Covers the installation frame's pure trace and sound helpers.
// ABOUTME: Stroke splitting, fade math, and instrument choice run without a browser.

import { describe, it, expect } from "vitest";
import {
  liveAlpha,
  toPreviousStrokes,
} from "../entrypoints/content/installationFrame";
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

describe("liveAlpha", () => {
  it("fades a point from solid to gone", () => {
    expect(liveAlpha(0)).toBe(1);
    expect(liveAlpha(-50)).toBe(1);
    expect(liveAlpha(4500)).toBeCloseTo(0.5, 5);
    expect(liveAlpha(9000)).toBe(0);
    expect(liveAlpha(60000)).toBe(0);
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
