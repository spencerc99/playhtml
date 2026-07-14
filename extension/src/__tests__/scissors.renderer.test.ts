// ABOUTME: Tests that persisted scissors cuts hide their source and render two restorable DOM pieces.
// ABOUTME: Verifies effect identity is isolated from the page and cleanup returns original inline state.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CutRenderer } from "../features/scissors/CutRenderer";

afterEach(() => {
  vi.unstubAllGlobals();
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
        style: "paper",
        seed: 42,
        createdAt: 1,
      },
    ]);

    const effect = document.querySelector('[data-wwo-scissors-effect="cut-1"]');
    expect(effect).not.toBeNull();
    expect(effect!.getAttribute("data-wwo-scissors-style")).toBe("paper");
    expect(effect!.querySelectorAll("[data-wwo-scissors-piece]")).toHaveLength(2);
    expect(effect!.querySelectorAll("[data-wwo-scissors-edge]")).toHaveLength(2);
    expect(effect!.querySelectorAll("#cut-me")).toHaveLength(0);
    expect(source.style.visibility).toBe("hidden");

    renderer.clear();
    expect(document.querySelector("[data-wwo-scissors-effect]")).toBeNull();
    expect(source.style.visibility).toBe("visible");
  });

  it("renders a black hole only when the page has no element beneath the tear", () => {
    const source = document.createElement("div");
    source.id = "last-layer";
    source.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 120,
        height: 80,
        right: 120,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(source);
    vi.stubGlobal("document", document);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => document.body),
    });

    const renderer = new CutRenderer();
    renderer.render([
      {
        id: "cut-hole",
        selector: "#last-layer",
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        gap: 24,
        style: "cloth",
        seed: 9,
        createdAt: 1,
      },
    ]);

    expect(document.querySelector("[data-wwo-scissors-hole]")).not.toBeNull();
    renderer.clear();
  });

  it("leaves the tear transparent when another element sits underneath", () => {
    const backing = document.createElement("div");
    backing.id = "backing";
    const source = document.createElement("div");
    source.id = "top-layer";
    source.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 120,
        height: 80,
        right: 120,
        bottom: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.append(backing, source);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [backing, document.body]),
    });

    const renderer = new CutRenderer();
    renderer.render([
      {
        id: "cut-reveal",
        selector: "#top-layer",
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        gap: 24,
        style: "paper",
        seed: 4,
        createdAt: 1,
      },
    ]);

    expect(document.querySelector("[data-wwo-scissors-hole]")).toBeNull();
    renderer.clear();
  });

  it("defers black-hole detection until a restored target enters the viewport", () => {
    const source = document.createElement("div");
    source.id = "offscreen-layer";
    let top = 2000;
    source.getBoundingClientRect = () =>
      ({
        left: 0,
        top,
        width: 120,
        height: 80,
        right: 120,
        bottom: top + 80,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(source);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [document.body]),
    });

    const renderer = new CutRenderer();
    renderer.render([
      {
        id: "cut-offscreen",
        selector: "#offscreen-layer",
        start: { x: 0, y: 0.5 },
        end: { x: 1, y: 0.5 },
        gap: 24,
        style: "paper",
        seed: 8,
        createdAt: 1,
      },
    ]);

    expect(document.querySelector("[data-wwo-scissors-hole]")).toBeNull();
    top = 0;
    renderer.refreshPositions();
    expect(document.querySelector("[data-wwo-scissors-hole]")).not.toBeNull();
    renderer.clear();
  });
});
