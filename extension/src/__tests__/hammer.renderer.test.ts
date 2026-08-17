// ABOUTME: Tests persistent hammer dents and crack overlays on host-page elements.
// ABOUTME: Verifies cumulative damage, effect isolation, and complete inline-style restoration.

import { afterEach, describe, expect, it } from "vitest";
import { HammerRenderer } from "../features/hammer/HammerRenderer";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("HammerRenderer", () => {
  it("dents a target, renders every impact, and restores its inline styles", () => {
    const source = document.createElement("button");
    source.id = "smash-me";
    source.style.translate = "2px 3px";
    source.style.rotate = "1deg";
    source.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 120,
        height: 60,
        right: 130,
        bottom: 80,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(source);

    const renderer = new HammerRenderer();
    renderer.render([
      { id: "hit-1", selector: "#smash-me", point: { x: 0.2, y: 0.4 }, createdAt: 1 },
      { id: "hit-2", selector: "#smash-me", point: { x: 0.8, y: 0.6 }, createdAt: 2 },
    ]);

    expect(document.querySelectorAll("[data-wwo-hammer-impact]")).toHaveLength(2);
    expect(source.style.translate).not.toBe("2px 3px");
    expect(source.style.rotate).not.toBe("1deg");

    renderer.clear();
    expect(document.querySelector("[data-wwo-hammer-effect]")).toBeNull();
    expect(source.style.translate).toBe("2px 3px");
    expect(source.style.rotate).toBe("1deg");
  });
});
