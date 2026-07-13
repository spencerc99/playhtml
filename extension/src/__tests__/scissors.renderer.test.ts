// ABOUTME: Tests that persisted scissors cuts hide their source and render two restorable DOM pieces.
// ABOUTME: Verifies effect identity is isolated from the page and cleanup returns original inline state.

import { afterEach, describe, expect, it } from "vitest";
import { CutRenderer } from "../features/scissors/CutRenderer";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CutRenderer", () => {
  it("renders two clipped clones and restores the source on clear", () => {
    const source = document.createElement("button");
    source.id = "cut-me";
    source.textContent = "cut me";
    source.style.visibility = "visible";
    source.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 20,
        width: 120,
        height: 40,
        right: 130,
        bottom: 60,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(source);

    const renderer = new CutRenderer();
    renderer.render([
      {
        id: "cut-1",
        selector: "#cut-me",
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        gap: 20,
        createdAt: 1,
      },
    ]);

    const effect = document.querySelector('[data-wwo-scissors-effect="cut-1"]');
    expect(effect).not.toBeNull();
    expect(effect!.children).toHaveLength(2);
    expect(effect!.querySelectorAll("#cut-me")).toHaveLength(0);
    expect(source.style.visibility).toBe("hidden");

    renderer.clear();
    expect(document.querySelector("[data-wwo-scissors-effect]")).toBeNull();
    expect(source.style.visibility).toBe("visible");
  });
});
