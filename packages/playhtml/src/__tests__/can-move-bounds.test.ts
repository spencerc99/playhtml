// ABOUTME: Drag-clamp tests for the `can-move-bounds` attribute — verifies the
// ABOUTME: "at least some of the element stays grabbable" semantics.

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
}: {
  elementWidth: number;
  elementHeight: number;
  containerWidth: number;
  containerHeight: number;
  minVisible?: number;
  minVisiblePx?: number;
  startX?: number;
  startY?: number;
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

  it("keeps the default fraction (25%) of the element visible when dragging past the right edge", () => {
    // 200x200 element in a 500x500 container. Default minVisible = 0.25,
    // floor = 60px. Slice = max(50, 60) = 60. Max x = 500 - 60 = 440.
    // Use 200x200 so the fraction (50) is larger than the floor (60)? No:
    // 50 < 60 still. Use 400x400 so fraction (100) dominates floor.
    const { drag, state } = makeDragHarness({
      elementWidth: 400,
      elementHeight: 400,
      containerWidth: 1000,
      containerHeight: 1000,
    });
    drag(10_000, 0);
    // Slice = max(400 * 0.25, 60) = max(100, 60) = 100. Max x = 1000 - 100 = 900.
    expect(state.data.x).toBe(900);
    expect(state.data.y).toBe(0);
  });

  it("keeps the default fraction visible when dragging past the left edge", () => {
    // Slice = 100, min x = -(400 - 100) = -300.
    const { drag, state } = makeDragHarness({
      elementWidth: 400,
      elementHeight: 400,
      containerWidth: 1000,
      containerHeight: 1000,
    });
    drag(-10_000, 0);
    expect(state.data.x).toBe(-300);
  });

  it("60px absolute floor kicks in when fraction × size is smaller than 60", () => {
    // 100x100 element, default fraction 0.25 → fraction slice = 25, but
    // 25 < 60, so floor wins: slice = 60.
    // max x = 300 - 60 = 240, min x = -(100 - 60) = -40.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(240);
    drag(-20_000, 0);
    expect(state.data.x).toBe(-40);
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
      minVisiblePx: 200,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(800);
  });

  it("min-visible of 1 pins the element fully inside (legacy behavior)", () => {
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
    // raw cursor. 100x100 element, default fraction 0.25, default floor
    // 60px. Slice = 60, so max x = 300 - 60 = 240.
    // Sequence:
    //   1. Cursor from 0 → 10_000 in one tick (past right edge). Element
    //      clamps to 240. startMouseX advances only by 240 (the amount
    //      actually translated), not all the way to 10_000 — debt holds
    //      the unused cursor distance.
    //   2. Cursor back to 5_000. Still clamped at 240.
    //   3. Only when the cursor comes all the way back inside does the
    //      element start moving again.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(240);
    expect(state.localData.startMouseX).toBe(240);
    drag(5_000, 0);
    expect(state.data.x).toBe(240);
    // Cursor back to 200. newX = 240 + (200 - 240) = 200. Inside → moves.
    drag(200, 0);
    expect(state.data.x).toBe(200);
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
    // 80px element, fraction 0.25 → fraction slice = 20. Floor = 60.
    // Slice = max(20, 60) = 60. max x = 200 - 60 = 140.
    expect(setData).toHaveBeenCalledWith({ x: 140, y: 0 });
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
