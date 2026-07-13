// ABOUTME: Verifies a chosen bottle anchor remains bound to one page position while scrolling.
// ABOUTME: Distinguishes offscreen anchors from elements that were removed from the document.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBottleOccluded,
  resolveBottlePosition,
  type BottleAnchor,
} from "../features/bottle-anchor";

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

describe("isBottleOccluded", () => {
  const originalElementsFromPoint = document.elementsFromPoint;

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    if (originalElementsFromPoint) {
      document.elementsFromPoint = originalElementsFromPoint;
    } else {
      delete (document as Partial<Document>).elementsFromPoint;
    }
  });

  it.each(["fixed", "sticky"])(
    "detects %s page chrome covering part of the bottle footprint",
    (position) => {
      const extensionHost = document.createElement("div");
      extensionHost.id = "we-were-online-bottles";
      const header = document.createElement("header");
      header.style.position = position;
      document.body.append(extensionHost, header);
      document.elementsFromPoint = (_x, y) =>
        y < 150 ? [extensionHost, header, document.body] : [document.body];

      expect(isBottleOccluded({ x: 300, y: 180 })).toBe(true);
    },
  );

  it("keeps the bottle visible over normal page content", () => {
    const extensionHost = document.createElement("div");
    extensionHost.id = "we-were-online-bottles";
    extensionHost.style.position = "fixed";
    const main = document.createElement("main");
    document.body.append(extensionHost, main);
    document.elementsFromPoint = () => [extensionHost, main, document.body];

    expect(isBottleOccluded({ x: 300, y: 400 })).toBe(false);
  });
});
