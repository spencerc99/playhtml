// ABOUTME: Tests how a heading or button piece scales its lettering with its box.
// ABOUTME: Resizing a piece of words must resize the words, never stretch them.

import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  isLettered,
  letteringLayout,
  naturalScrapSize,
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
