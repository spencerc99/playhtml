// ABOUTME: Verifies mobile commute boarding, joystick, action, and fullscreen controls.
// ABOUTME: Covers the screen-space input shell independently from train geometry.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommuteMobileControls,
  keepCommuteCursorInCar,
} from "./CommuteMobileControls";

function renderControls(
  props: React.ComponentProps<typeof CommuteMobileControls>,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CommuteMobileControls {...props} />));
  return { container, root };
}

describe("CommuteMobileControls", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("boards from a user gesture and requests landscape fullscreen", async () => {
    const onBoard = vi.fn();
    const { container, root } = renderControls({
      action: null,
      boarded: false,
      onBoard,
      onMove: vi.fn(),
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".commute-mobile-board button")!
        .click();
      await Promise.resolve();
    });

    expect(onBoard).toHaveBeenCalledOnce();
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("boards without forcing fullscreen in a precise-pointer preview", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    const onBoard = vi.fn();
    const { container, root } = renderControls({
      action: null,
      boarded: false,
      onBoard,
      onMove: vi.fn(),
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".commute-mobile-board button")!
        .click();
      await Promise.resolve();
    });

    expect(onBoard).toHaveBeenCalledOnce();
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("publishes normalized joystick movement and resets on release", () => {
    const onMove = vi.fn();
    const { container, root } = renderControls({
      action: null,
      boarded: true,
      onBoard: vi.fn(),
      onMove,
    });
    const joystick = container.querySelector<HTMLDivElement>(
      ".commute-mobile-joystick",
    )!;
    Object.assign(joystick, {
      setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({
        top: 0,
        left: 0,
        right: 112,
        bottom: 112,
        width: 112,
        height: 112,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      joystick.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 90,
          clientY: 56,
          pointerId: 1,
        }),
      );
    });
    expect(onMove).toHaveBeenLastCalledWith({ x: 1, y: 0 });

    act(() => {
      joystick.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }),
      );
    });
    expect(onMove).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    act(() => root.unmount());
  });

  it("shows and invokes the contextual train action", () => {
    const onSelect = vi.fn();
    const { container, root } = renderControls({
      action: {
        label: "sit down",
        tone: "sit",
        onSelect,
      },
      boarded: true,
      onBoard: vi.fn(),
      onMove: vi.fn(),
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>(".commute-mobile-action")!
        .click();
    });
    expect(onSelect).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("keeps page pointer movement from replacing the in-carriage cursor", () => {
    const documentMove = vi.fn();
    document.addEventListener("mousemove", documentMove);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <main onMouseMove={keepCommuteCursorInCar}>
          <span data-testid="train-floor" />
        </main>,
      );
    });

    act(() => {
      container
        .querySelector<HTMLElement>('[data-testid="train-floor"]')!
        .dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });

    document.removeEventListener("mousemove", documentMove);
    expect(documentMove).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
