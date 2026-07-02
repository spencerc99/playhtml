// ABOUTME: Drag-clamp tests for the `can-move-bounds` attribute.
// ABOUTME: Verifies strict default bounds and explicit partial-overhang options.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CanMoveBounds,
  CanMoveBoundsMinVisible,
  CanMoveBoundsMinVisiblePx,
  TagType,
  TagTypeToElement,
} from "@playhtml/common";

/**
 * The handler we're testing receives `{ data, localData, setData, setLocalData, element }`
 * and mutates via setData. This helper wires up a minimal dragging harness so
 * we can drive `onDrag` directly and observe the clamped result.
 */
function makeDragHarness({
  elementWidth,
  elementHeight,
  containerWidth,
  containerHeight,
  minVisible,
  minVisiblePx,
  startX = 0,
  startY = 0,
  elementLeft = 0,
  elementTop = 0,
}: {
  elementWidth: number;
  elementHeight: number;
  containerWidth: number;
  containerHeight: number;
  minVisible?: number;
  minVisiblePx?: number;
  startX?: number;
  startY?: number;
  elementLeft?: number;
  elementTop?: number;
}) {
  const container = document.createElement("div");
  container.id = "arena";
  // jsdom honors clientWidth/clientHeight when we set them via defineProperty,
  // since it doesn't compute layout.
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: containerWidth,
  });
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: containerHeight,
  });
  container.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: containerWidth,
      bottom: containerHeight,
      width: containerWidth,
      height: containerHeight,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(container);

  const element = document.createElement("div");
  element.setAttribute(CanMoveBounds, "arena");
  if (minVisible !== undefined) {
    element.setAttribute(CanMoveBoundsMinVisible, String(minVisible));
  }
  if (minVisiblePx !== undefined) {
    element.setAttribute(CanMoveBoundsMinVisiblePx, String(minVisiblePx));
  }
  Object.defineProperty(element, "offsetWidth", {
    configurable: true,
    value: elementWidth,
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    value: elementHeight,
  });
  container.appendChild(element);

  const state = {
    data: { x: startX, y: startY },
    localData: { startMouseX: 0, startMouseY: 0 },
  };
  element.getBoundingClientRect = () =>
    ({
      x: elementLeft + state.data.x,
      y: elementTop + state.data.y,
      top: elementTop + state.data.y,
      left: elementLeft + state.data.x,
      right: elementLeft + state.data.x + elementWidth,
      bottom: elementTop + state.data.y + elementHeight,
      width: elementWidth,
      height: elementHeight,
      toJSON: () => ({}),
    }) as DOMRect;

  const setData = vi.fn((next: { x: number; y: number }) => {
    state.data = next;
  });
  const setLocalData = vi.fn(
    (next: { startMouseX: number; startMouseY: number }) => {
      state.localData = next;
    },
  );

  const drag = (mouseX: number, mouseY: number) => {
    const onDrag = TagTypeToElement[TagType.CanMove].onDrag!;
    onDrag(
      { clientX: mouseX, clientY: mouseY } as MouseEvent,
      {
        data: state.data,
        localData: state.localData,
        setData,
        setLocalData,
        element,
      } as any,
    );
  };

  return { container, element, state, setData, setLocalData, drag };
}

describe("can-move bounds clamp", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the whole element inside by default when dragging past the right edge", () => {
    // 400px element in a 1000px container. Default minVisible = 1, so
    // max x = 1000 - 400 = 600.
    const { drag, state } = makeDragHarness({
      elementWidth: 400,
      elementHeight: 400,
      containerWidth: 1000,
      containerHeight: 1000,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(600);
    expect(state.data.y).toBe(0);
  });

  it("keeps the whole element inside by default when dragging past the left edge", () => {
    const { drag, state } = makeDragHarness({
      elementWidth: 400,
      elementHeight: 400,
      containerWidth: 1000,
      containerHeight: 1000,
    });
    drag(-10_000, 0);
    expect(state.data.x).toBe(0);
  });

  it("accounts for the element's starting position inside the bounds", () => {
    // Element starts 80px from the left and 30px from the top. A strict
    // clamp must translate relative to that starting layout position.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 250,
      minVisible: 1,
      elementLeft: 80,
      elementTop: 30,
    });
    drag(10_000, 10_000);
    expect(state.data.x).toBe(120);
    expect(state.data.y).toBe(120);
    drag(-10_000, -10_000);
    expect(state.data.x).toBe(-80);
    expect(state.data.y).toBe(-30);
  });

  it("respects a custom min-visible fraction (floor disabled)", () => {
    // minVisible = 0.5, floor explicitly 0 so fraction always wins.
    // Slice = 50, max x = 300 - 50 = 250, min y = -50.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
      minVisible: 0.5,
      minVisiblePx: 0,
    });
    drag(10_000, -10_000);
    expect(state.data.x).toBe(250);
    expect(state.data.y).toBe(-50);
  });

  it("respects a custom min-visible-px floor", () => {
    // Large element so fraction would dominate: 400x400, fraction 0.25 → 100.
    // Override floor to 200px: slice = max(100, 200) = 200.
    // max x = 1000 - 200 = 800.
    const { drag, state } = makeDragHarness({
      elementWidth: 400,
      elementHeight: 400,
      containerWidth: 1000,
      containerHeight: 1000,
      minVisible: 0.25,
      minVisiblePx: 200,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(800);
  });

  it("min-visible of 1 pins the element fully inside", () => {
    // Slice = max(100, 60) = 100 (the whole element). max x = 300 - 100 = 200.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
      minVisible: 1,
    });
    drag(-10_000, 10_000);
    expect(state.data.x).toBe(0);
    expect(state.data.y).toBe(200);
  });

  it("both attributes set to 0 lets the element leave entirely", () => {
    // Opt fully out of the keep-visible guarantee.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
      minVisible: 0,
      minVisiblePx: 0,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(300);
    drag(-10_000, 0);
    expect(state.data.x).toBe(-100);
  });

  it("cursor debt: fast drag past an edge does not fling the element to the opposite edge on return", () => {
    // Regression guard for the bug where clientX-startMouseX tracked the
    // raw cursor. 100x100 element in a 300px container has max x = 200.
    // Sequence:
    //   1. Cursor from 0 → 10_000 in one tick (past right edge). Element
    //      clamps to 200. startMouseX advances only by 200 (the amount
    //      actually translated), not all the way to 10_000 — debt holds
    //      the unused cursor distance.
    //   2. Cursor back to 5_000. Still clamped at 200.
    //   3. Only when the cursor comes all the way back inside does the
    //      element start moving again.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(200);
    expect(state.localData.startMouseX).toBe(200);
    drag(5_000, 0);
    expect(state.data.x).toBe(200);
    // Cursor back to 160. newX = 200 + (160 - 200) = 160. Inside → moves.
    drag(160, 0);
    expect(state.data.x).toBe(160);
  });

  it("falls back to 0 when the keep-visible slice is larger than the container (inverted clamp)", () => {
    // 100px element, minVisible = 1 → slice = max(100, 60) = 100. Container
    // is only 40px wide, so max (40-100=-60) < min (0) — the clamp range
    // inverts. Fallback pins at 0.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 40,
      containerHeight: 40,
      minVisible: 1,
    });
    drag(500, 500);
    expect(state.data.x).toBe(0);
    expect(state.data.y).toBe(0);
  });

  it("resolves the bounds target by `#id` prefix as well as bare id", () => {
    const container = document.createElement("div");
    container.id = "hash-arena";
    Object.defineProperty(container, "clientWidth", { value: 200 });
    Object.defineProperty(container, "clientHeight", { value: 200 });
    document.body.appendChild(container);

    const element = document.createElement("div");
    element.setAttribute(CanMoveBounds, "#hash-arena");
    Object.defineProperty(element, "offsetWidth", { value: 80 });
    Object.defineProperty(element, "offsetHeight", { value: 80 });
    container.appendChild(element);

    const setData = vi.fn();
    const setLocalData = vi.fn();
    const onDrag = TagTypeToElement[TagType.CanMove].onDrag!;
    onDrag(
      { clientX: 10_000, clientY: 0 } as MouseEvent,
      {
        data: { x: 0, y: 0 },
        localData: { startMouseX: 0, startMouseY: 0 },
        setData,
        setLocalData,
        element,
      } as any,
    );
    expect(setData).toHaveBeenCalledWith({ x: 120, y: 0 });
  });

  it("clamps to one decimal place (rounds for wire compactness)", () => {
    // Move by fractional amount; verify rounding applies.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
    });
    drag(37, 81);
    expect(Number.isInteger(state.data.x * 10)).toBe(true);
    expect(Number.isInteger(state.data.y * 10)).toBe(true);
  });
});
