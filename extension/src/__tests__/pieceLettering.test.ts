// ABOUTME: Tests how a heading or button piece scales its lettering with its box.
// ABOUTME: Resizing a piece of words must resize the words, never stretch them.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  isLettered,
  letteringLayout,
  naturalScrapSize,
  rewrapHeadingFromSide,
} from "../entrypoints/scraps/pieceLettering";

const base = {
  id: "scrap_1",
  key: "k",
  pageUrl: "https://example.test/a",
  pageTitle: "A page",
  domain: "example.test",
  ts: 1_000,
};

const heading = {
  ...base,
  kind: "heading",
  text: "Hello there",
  level: 1,
  styles: { fontSize: "32px", fontFamily: "serif" },
} as Extract<ScrapItem, { kind: "heading" }>;

const button = {
  ...base,
  kind: "button",
  text: "Subscribe",
  styles: { fontSize: "14px" },
} as Extract<ScrapItem, { kind: "button" }>;

describe("letteringLayout", () => {
  it("sets the words at their own size in a piece left at its natural box", () => {
    const natural = naturalScrapSize(heading);
    const layout = letteringLayout(heading, natural);
    expect(layout.scale).toBeCloseTo(1);
    expect(layout.width).toBeCloseTo(natural.width);
    expect(layout.height).toBeCloseTo(natural.height);
  });

  it("doubles the lettering when the piece is doubled", () => {
    const natural = naturalScrapSize(heading);
    const layout = letteringLayout(heading, {
      width: natural.width * 2,
      height: natural.height * 2,
    });
    expect(layout.scale).toBeCloseTo(2);
    // Laid out in the same box, so the words wrap exactly as before.
    expect(layout.width).toBeCloseTo(natural.width);
    expect(layout.height).toBeCloseTo(natural.height);
  });

  it("shrinks a button's lettering with its box", () => {
    const natural = naturalScrapSize(button);
    const layout = letteringLayout(button, {
      width: natural.width / 2,
      height: natural.height / 2,
    });
    expect(layout.scale).toBeCloseTo(0.5);
  });

  it("keeps letters unstretched when a piece is pulled out of proportion", () => {
    const natural = naturalScrapSize(heading);
    const box = { width: natural.width * 3, height: natural.height };
    const layout = letteringLayout(heading, box);
    // The shorter stretch sets the type size; the words get more room across.
    expect(layout.scale).toBeCloseTo(1);
    expect(layout.width * layout.scale).toBeCloseTo(box.width);
    expect(layout.height * layout.scale).toBeCloseTo(box.height);
  });

  it("refuses a box with no area", () => {
    expect(() => letteringLayout(heading, { width: 0, height: 10 })).toThrow();
  });
});

describe("isLettered", () => {
  it("covers headings and buttons, and nothing drawn from pixels", () => {
    expect(isLettered(heading)).toBe(true);
    expect(isLettered(button)).toBe(true);
    expect(
      isLettered({
        ...base,
        kind: "image",
        src: "https://example.test/a.png",
        naturalWidth: 10,
        naturalHeight: 10,
      } as ScrapItem),
    ).toBe(false);
  });
});

describe("rewrapping a heading from its side", () => {
  // Two lines' worth of height for every halving of the width, so the test
  // reads the rewrap without depending on a typeface.
  const measure = (_scrap: unknown, letteringWidth: number) =>
    letteringWidth >= 200 ? 40 : 80;
  const placed = { x: 100, y: 50, width: 400, height: 40, rotation: 0, flipY: false };

  it("sets the words at a fixed width once rewrapped, scaled to the box", () => {
    const layout = letteringLayout(heading, { width: 300, height: 120 }, 150);
    expect(layout.scale).toBeCloseTo(2);
    expect(layout.width).toBe(150);
    expect(layout.height).toBeCloseTo(60);
  });

  it("keeps the type size and grows downward when pulled narrower", () => {
    const before = letteringLayout(heading, placed, 400);
    const pulled = rewrapHeadingFromSide({
      box: placed,
      scrap: heading,
      letteringWidth: 400,
      edge: "right",
      pointer: { x: 250, y: 70 },
      aboutCenter: false,
      measure,
    });
    expect(pulled.width).toBeCloseTo(150);
    expect(pulled.letteringWidth).toBeCloseTo(150);
    // Same scale as before: the words did not shrink, they wrapped.
    expect(pulled.width / pulled.letteringWidth).toBeCloseTo(before.scale);
    expect(pulled.height).toBeCloseTo(80);
    // Left and top edges stay put.
    expect(pulled.x).toBeCloseTo(100);
    expect(pulled.y).toBeCloseTo(50);
  });

  it("keeps the opposite side when pulled from the left", () => {
    const pulled = rewrapHeadingFromSide({
      box: placed,
      scrap: heading,
      letteringWidth: 400,
      edge: "left",
      pointer: { x: 350, y: 70 },
      aboutCenter: false,
      measure,
    });
    expect(pulled.x + pulled.width).toBeCloseTo(500);
    expect(pulled.y).toBeCloseTo(50);
  });

  it("rewraps a turned heading along its own baseline, keeping its top-left", () => {
    const turned = { ...placed, rotation: 90 };
    // Turned a quarter, the piece's right side points down the frame.
    const center = { x: 300, y: 70 };
    const pulled = rewrapHeadingFromSide({
      box: turned,
      scrap: heading,
      letteringWidth: 400,
      edge: "right",
      pointer: { x: center.x, y: center.y - 200 + 150 },
      aboutCenter: false,
      measure,
    });
    expect(pulled.width).toBeCloseTo(150);
    // The turned top-left corner of the piece does not move.
    const corner = (box: { x: number; y: number; width: number; height: number }) => {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const dx = box.x - cx;
      const dy = box.y - cy;
      return { x: cx - dy, y: cy + dx };
    };
    expect(corner(pulled).x).toBeCloseTo(corner(turned).x);
    expect(corner(pulled).y).toBeCloseTo(corner(turned).y);
  });

  it("will not pull a heading narrower than about one letter", () => {
    const pulled = rewrapHeadingFromSide({
      box: placed,
      scrap: heading,
      letteringWidth: 400,
      edge: "right",
      pointer: { x: 90, y: 70 },
      aboutCenter: false,
      measure,
    });
    expect(pulled.width).toBeGreaterThan(20);
    expect(pulled.x).toBeCloseTo(100);
  });
});
