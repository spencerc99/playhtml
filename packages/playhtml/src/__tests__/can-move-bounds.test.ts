// ABOUTME: Drag-clamp tests for the `can-move-bounds` attribute — verifies the
// ABOUTME: "at least some of the element stays grabbable" semantics.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CanMoveBounds,
  CanMoveBoundsMinVisible,
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
  startX = 0,
  startY = 0,
}: {
  elementWidth: number;
  elementHeight: number;
  containerWidth: number;
  containerHeight: number;
  minVisible?: number;
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
    // 100x100 element in a 300x300 container. Default minVisible = 0.25.
    // Max x = 300 - 100 * 0.25 = 275 (75px of element hangs off to the right).
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
    });
    drag(10_000, 0); // cursor shoots far past the right edge
    expect(state.data.x).toBe(275);
    // No vertical movement yet, so y stays at 0.
    expect(state.data.y).toBe(0);
  });

  it("keeps the default fraction visible when dragging past the left edge", () => {
    // min x = -100 * (1 - 0.25) = -75 (75px hangs off to the left).
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
    });
    drag(-10_000, 0);
    expect(state.data.x).toBe(-75);
  });

  it("respects a custom min-visible fraction", () => {
    // minVisible = 0.5 → max x = 300 - 50 = 250, min x = -50.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
      minVisible: 0.5,
    });
    drag(10_000, -10_000);
    expect(state.data.x).toBe(250);
    expect(state.data.y).toBe(-50);
  });

  it("min-visible of 1 pins the element fully inside (legacy behavior)", () => {
    // min x = 0, max x = 300 - 100 = 200.
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

  it("min-visible of 0 lets the element leave entirely", () => {
    // min x = -100, max x = 300.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
      minVisible: 0,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(300);
    drag(-10_000, 0);
    expect(state.data.x).toBe(-100);
  });

  it("cursor debt: fast drag past an edge does not fling the element to the opposite edge on return", () => {
    // This is the regression guard for the bug where clientX-startMouseX
    // tracked the raw cursor. Sequence:
    //   1. Cursor from 50 → 10_000 in one tick (past right edge).
    //      Element clamps to 275. startMouseX advances only by 275 (the
    //      amount the element actually translated) — not all the way to
    //      10_000 — so we hold the "debt" of unused cursor distance.
    //   2. Cursor back to 5_000. Delta from the debt-adjusted anchor is
    //      small and the element stays clamped at 275.
    //   3. Only when the cursor drags all the way back inside the bounds
    //      does the element start moving again.
    const { drag, state } = makeDragHarness({
      elementWidth: 100,
      elementHeight: 100,
      containerWidth: 300,
      containerHeight: 300,
    });
    drag(10_000, 0);
    expect(state.data.x).toBe(275);
    // Anchor advanced by clamped delta (275 - 0) = 275, not the raw delta.
    expect(state.localData.startMouseX).toBe(275);
    // Return drag: cursor at 5_000. newX = 275 + (5000 - 275) = 5000. Still
    // clamped to 275.
    drag(5_000, 0);
    expect(state.data.x).toBe(275);
    // Keep coming back: cursor at 250 should start pulling the element in.
    // newX = 275 + (250 - 275) = 250. Inside bounds → element moves.
    drag(250, 0);
    expect(state.data.x).toBe(250);
  });

  it("falls back to 0 when min-visible × element is larger than the container (inverted clamp)", () => {
    // 100px element, minVisible = 1 → needs 100px visible. If the container
    // is only 40px wide, max (40-100=-60) < min (0) — the clamp range
    // inverts. The fallback pins at 0 so the element doesn't fly off into
    // negative space.
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
    // max x = 200 - 80 * 0.25 = 180.
    expect(setData).toHaveBeenCalledWith({ x: 180, y: 0 });
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
