// ABOUTME: Verifies when light scrap ink gets a dark backing and which shade it gets.
// ABOUTME: Covers text colors, own fills, and icon paint read from SVG markup.

import { describe, expect, it } from "vitest";
import {
  backingFor,
  hasOwnFill,
  inkNeedsBacking,
  lightIconInk,
} from "../scrapLegibility";

describe("scrap legibility", () => {
  it("backs light ink and leaves dark ink alone", () => {
    expect(inkNeedsBacking("rgb(255, 255, 255)")).toBe(true);
    expect(inkNeedsBacking("#f5e6a3")).toBe(true);
    expect(inkNeedsBacking("rgb(2, 120, 253)")).toBe(false);
    expect(inkNeedsBacking("#3d3833")).toBe(false);
  });

  it("leaves unparseable or see-through ink as the page drew it", () => {
    expect(inkNeedsBacking(undefined)).toBe(false);
    expect(inkNeedsBacking("color(display-p3 1 1 1)")).toBe(false);
    expect(inkNeedsBacking("rgba(255, 255, 255, 0.2)")).toBe(false);
  });

  it("backs grey ink in warm charcoal and colored ink in its own hue", () => {
    expect(backingFor("rgb(255, 255, 255)")).toBe("#2a2622");
    expect(backingFor("#cfe8ff")).toMatch(/^hsl\(20\d 45% 15%\)$/);
  });

  it("treats only an opaque background as a fill of its own", () => {
    expect(hasOwnFill("rgb(74, 154, 138)")).toBe(true);
    expect(hasOwnFill("rgba(0, 0, 0, 0)")).toBe(false);
    expect(hasOwnFill(undefined)).toBe(false);
  });

  it("finds icons painted only in light ink", () => {
    expect(lightIconInk('<svg><path fill="#fff" d="M0 0"/></svg>')).toBe("#fff");
    expect(
      lightIconInk('<svg><path style="stroke: white; fill: none"/></svg>'),
    ).toBe("white");
    expect(
      lightIconInk('<svg><path fill="#fff"/><path fill="#222"/></svg>'),
    ).toBeNull();
    expect(lightIconInk('<svg><path d="M0 0"/></svg>')).toBeNull();
    expect(lightIconInk('<svg><path fill="currentColor"/></svg>')).toBeNull();
  });
});
