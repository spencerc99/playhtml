// ABOUTME: Verifies a chosen bottle anchor remains bound to one page position while scrolling.
// ABOUTME: Distinguishes offscreen anchors from elements that were removed from the document.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anchorFromPoint,
  pickBottleAnchor,
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

describe("anchorFromPoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("binds to the nearest content element and encodes the point as an offset", () => {
    // jsdom in this suite doesn't provide CSS.escape (used to build id
    // selectors); real browsers do. Stub it for the id-anchor path.
    if (typeof (globalThis as any).CSS === "undefined") {
      (globalThis as any).CSS = { escape: (s: string) => s };
    } else if (typeof (globalThis as any).CSS.escape !== "function") {
      (globalThis as any).CSS.escape = (s: string) => s;
    }
    const para = document.createElement("p");
    para.id = "para";
    para.textContent = "some content to anchor against";
    document.body.appendChild(para);
    vi.spyOn(para, "getBoundingClientRect").mockReturnValue({
      x: 100, y: 200, top: 200, left: 100, right: 300, bottom: 240,
      width: 200, height: 40,
      toJSON() {},
    } as DOMRect);

    // A point at the element's center resolves back to (offsetX,offsetY)=(.5,.5).
    const a = anchorFromPoint(200, 220);
    expect(a.selector).toBe("#para");
    expect(a.offsetX).toBeCloseTo(0.5);
    expect(a.offsetY).toBeCloseTo(0.5);
  });

  it("falls back to a body-relative anchor when no content is near", () => {
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 800,
      width: 1000, height: 800,
      toJSON() {},
    } as DOMRect);
    const a = anchorFromPoint(500, 400);
    expect(a.selector).toBe("body");
    expect(a.offsetX).toBeCloseTo(0.5);
    expect(a.offsetY).toBeCloseTo(0.5);
  });
});

describe("pickBottleAnchor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("places beside substantial readable content when a wide margin is clear", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    const paragraph = document.createElement("p");
    paragraph.id = "essay";
    paragraph.textContent =
      "A long essay paragraph provides enough readable prose to establish that this page has a content column.";
    document.body.appendChild(paragraph);
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(300, 180, 600, 120));
    mockElementsFromPoint((x, y) => {
      if (x >= 300 && x <= 900 && y >= 180 && y <= 300) return [paragraph, document.body];
      return [document.body];
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    const picked = pickBottleAnchor();
    const position = picked ? resolveBottlePosition(picked) : null;

    expect(picked).not.toBeNull();
    expect(position).not.toBeNull();
    expect(position!.x < 300 || position!.x > 900).toBe(true);
  });

  it("does not place on a full-width application layout without a content margin", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    const paragraph = document.createElement("p");
    paragraph.id = "app-copy";
    paragraph.textContent =
      "A long application status message can contain prose without making the surrounding interface a reading page.";
    document.body.appendChild(paragraph);
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(40, 180, 1120, 80));
    mockElementsFromPoint(() => [document.body]);

    expect(pickBottleAnchor()).toBeNull();
  });

  it("rejects margin space owned by semantic buttons and tabs", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    const paragraph = document.createElement("p");
    paragraph.id = "newsletter";
    paragraph.textContent =
      "A newsletter paragraph is long enough to qualify, but its apparent margin is occupied by an application control.";
    const tab = document.createElement("div");
    tab.setAttribute("role", "tab");
    const tabChild = document.createElement("span");
    tab.appendChild(tabChild);
    document.body.append(paragraph, tab);
    vi.spyOn(paragraph, "getBoundingClientRect").mockReturnValue(rect(300, 180, 600, 120));
    mockElementsFromPoint((x) => {
      const hitsNarrowControl =
        (x >= 185 && x <= 187) || (x >= 953 && x <= 955);
      return hitsNarrowControl
        ? [tabChild, tab, document.body]
        : [document.body];
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(pickBottleAnchor()).toBeNull();
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON() {},
  } as DOMRect;
}

function mockElementsFromPoint(implementation: (x: number, y: number) => Element[]): void {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: vi.fn(implementation),
  });
}
