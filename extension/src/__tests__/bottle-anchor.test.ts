// ABOUTME: Verifies a chosen bottle anchor remains bound to one page position while scrolling.
// ABOUTME: Distinguishes offscreen anchors from elements that were removed from the document.

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBottlePosition, type BottleAnchor } from "../features/bottle-anchor";

const anchor: BottleAnchor = {
  selector: "#anchor",
  offsetX: 0.5,
  offsetY: 0.5,
};

describe("resolveBottlePosition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps resolving the same page position after it scrolls above the viewport", () => {
    const element = document.createElement("div");
    element.id = "anchor";
    document.body.appendChild(element);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: -900,
      top: -900,
      left: 100,
      right: 500,
      bottom: -700,
      width: 400,
      height: 200,
      toJSON() {},
    } as DOMRect);

    expect(resolveBottlePosition(anchor)).toMatchObject({ x: 300, y: -800 });
  });

  it("returns null when the anchor element is gone", () => {
    expect(resolveBottlePosition(anchor)).toBeNull();
  });
});
