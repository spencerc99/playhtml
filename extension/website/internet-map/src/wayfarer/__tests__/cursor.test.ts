// ABOUTME: Checks which cursor colours the walker will accept from a URL or a message.
// ABOUTME: The value becomes a canvas fill, so only plain colour syntaxes get through.

import { describe, expect, it } from "vitest";
import { parseCursorColor } from "../cursor";

describe("parseCursorColor", () => {
  it("accepts the colours a playhtml cursor can have", () => {
    expect(parseCursorColor("#f80")).toBe("#f80");
    expect(parseCursorColor("#FF8800")).toBe("#FF8800");
    expect(parseCursorColor("#ff880080")).toBe("#ff880080");
    expect(parseCursorColor("hsl(210, 70%, 60%)")).toBe("hsl(210, 70%, 60%)");
    expect(parseCursorColor(" rgb(12, 200, 3) ")).toBe("rgb(12, 200, 3)");
    expect(parseCursorColor("rgba(12,200,3,0.5)")).toBe("rgba(12,200,3,0.5)");
    expect(parseCursorColor("hsl(210deg 70% 60% / 0.8)")).toBe("hsl(210deg 70% 60% / 0.8)");
  });

  it("refuses anything that is not a plain colour", () => {
    expect(parseCursorColor("red")).toBeNull();
    expect(parseCursorColor("url(evil)")).toBeNull();
    expect(parseCursorColor("#ggg")).toBeNull();
    expect(parseCursorColor("hsl(210, 70%, 60%); background: red")).toBeNull();
    expect(parseCursorColor(42)).toBeNull();
    expect(parseCursorColor(null)).toBeNull();
    expect(parseCursorColor("")).toBeNull();
  });
});
