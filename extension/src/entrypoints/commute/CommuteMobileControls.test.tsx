// ABOUTME: Verifies mobile commute boarding, joystick, and fullscreen controls.
// ABOUTME: Covers the screen-space input shell independently from train geometry.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_URL } from "@movement/config";
import {
  EXTENSION_INSTALL_ATTRIBUTE,
  markExtensionInstalled,
} from "../../utils/extensionInstallMarker";
import {
  CommuteMobileControls,
  keepCommuteCursorInCar,
  useCommuteBoardingGate,
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

function enterEmail(input: HTMLInputElement, email: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, email);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function BoardingGateProbe() {
  return <span>{useCommuteBoardingGate() ? "waiting" : "entering"}</span>;
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
    document.documentElement.removeAttribute(EXTENSION_INSTALL_ATTRIBUTE);
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("boards from a user gesture and requests landscape fullscreen", async () => {
    const onBoard = vi.fn();
    const { container, root } = renderControls({
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

  it("keeps boarding pending while the mobile gate is visible", () => {
    let notifyChange = () => {};
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(
        (_event: string, listener: () => void) => (notifyChange = listener),
      ),
      removeEventListener: vi.fn(),
    };
    const matchMedia = vi.fn(() => mediaQuery);
    vi.stubGlobal("matchMedia", matchMedia);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => root.render(<BoardingGateProbe />));
    expect(container.textContent).toBe("waiting");
    expect(matchMedia).toHaveBeenCalledWith(
      expect.stringContaining("orientation: landscape"),
    );

    act(() => {
      mediaQuery.matches = false;
      notifyChange();
    });
    expect(container.textContent).toBe("entering");
    act(() => root.unmount());
    expect(mediaQuery.removeEventListener).toHaveBeenCalledOnce();
  });

  it("publishes normalized joystick movement and resets on release", () => {
    const onMove = vi.fn();
    const { container, root } = renderControls({
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

  it("keeps the train unobstructed by contextual action buttons", () => {
    const { container, root } = renderControls({
      boarded: true,
      onBoard: vi.fn(),
      onMove: vi.fn(),
    });

    expect(container.querySelector(".commute-mobile-action")).toBeNull();
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

  it("keeps a collapsible transit-pass tab on public mobile rides", async () => {
    vi.useFakeTimers();
    const { container, root } = renderControls({
      boarded: true,
      onBoard: vi.fn(),
      onMove: vi.fn(),
    });

    await act(async () => vi.advanceTimersByTime(800));
    const tab = container.querySelector<HTMLButtonElement>(
      ".commute-mobile-transit-pass__tab",
    );
    expect(tab?.textContent).toContain("internet transit pass");
    expect(tab?.textContent).toContain("join the ride");

    act(() => tab?.click());
    expect(container.textContent).toContain(
      "the extension is desktop-only — we'll email you the install link for your computer",
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".commute-mobile-transit-pass__close")
        ?.click(),
    );
    expect(
      container.querySelector(".commute-mobile-transit-pass__panel"),
    ).toBeNull();
    expect(
      container.querySelector(".commute-mobile-transit-pass__tab"),
    ).not.toBeNull();
    act(() => root.unmount());
  });

  it("emails the install link and remembers a first-time subscription", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, alreadySubscribed: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderControls({
      boarded: true,
      onBoard: vi.fn(),
      onMove: vi.fn(),
    });

    await act(async () => vi.advanceTimersByTime(800));
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".commute-mobile-transit-pass__tab")!
        .click(),
    );
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      enterEmail(input, "  rider@example.com  ");
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(`${WORKER_URL}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "rider@example.com", source: "website" }),
    });
    expect(container.textContent).toContain(
      "sent to rider@example.com! excited to make internet feel more alive together :)",
    );
    expect(localStorage.getItem("wewere.subscribed")).toBe("1");
    act(() => root.unmount());
  });

  it("shows the saved success note instead of the form", async () => {
    vi.useFakeTimers();
    localStorage.setItem("wewere.subscribed", "1");
    const { container, root } = renderControls({
      boarded: true,
      onBoard: vi.fn(),
      onMove: vi.fn(),
    });

    await act(async () => vi.advanceTimersByTime(800));
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          ".commute-mobile-transit-pass__tab",
        )!
        .click(),
    );

    expect(container.textContent).toContain(
      "install link sent — check your email :)",
    );
    expect(container.querySelector("form")).toBeNull();
    act(() => root.unmount());
  });

  it("shows the rate-limit message and stays hidden when installed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ ok: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = renderControls({
      boarded: true,
      onBoard: vi.fn(),
      onMove: vi.fn(),
    });
    await act(async () => vi.advanceTimersByTime(800));
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".commute-mobile-transit-pass__tab")!
        .click(),
    );
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      enterEmail(input, "rider@example.com");
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain(
      "slow down — try again in a minute",
    );
    act(() => root.unmount());

    markExtensionInstalled(document.documentElement);
    const installed = renderControls({
      boarded: true,
      onBoard: vi.fn(),
      onMove: vi.fn(),
    });
    await act(async () => vi.advanceTimersByTime(800));
    expect(
      installed.container.querySelector(".commute-mobile-transit-pass"),
    ).toBeNull();
    act(() => installed.root.unmount());
  });
});
