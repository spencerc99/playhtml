// ABOUTME: Verifies the visitor-dot band only auto-scrolls while it is on screen and the tab is visible.
// ABOUTME: Drives intersection and visibility changes and counts the animation frames requested.
// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startBandAutoScroll } from "../bandAutoScroll";

let observerCallback: ((entries: { isIntersecting: boolean }[]) => void) | null;
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let visibility: DocumentVisibilityState;

function viewport(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollWidth", { value: 1000 });
  Object.defineProperty(el, "clientWidth", { value: 300 });
  return el;
}

function runFrame(now: number) {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, cb] of pending) cb(now);
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  observerCallback = null;
  frames = new Map();
  nextFrameId = 1;
  visibility = "visible";
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        observerCallback = cb;
      }
      observe() {}
      disconnect() {
        observerCallback = null;
      }
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("requests no frames until the band is on screen", () => {
  const el = viewport();
  const stop = startBandAutoScroll(el);
  expect(frames.size).toBe(0);

  observerCallback!([{ isIntersecting: true }]);
  expect(frames.size).toBe(1);
  runFrame(performance.now() + 1000);
  expect(el.scrollLeft).toBeGreaterThan(0);
  expect(frames.size).toBe(1);
  stop();
  expect(frames.size).toBe(0);
});

it("stops scrolling while offscreen and resumes when it returns", () => {
  const el = viewport();
  const stop = startBandAutoScroll(el);
  observerCallback!([{ isIntersecting: true }]);
  observerCallback!([{ isIntersecting: false }]);
  expect(frames.size).toBe(0);

  observerCallback!([{ isIntersecting: true }]);
  expect(frames.size).toBe(1);
  stop();
});

it("stops scrolling while the tab is hidden", () => {
  const el = viewport();
  const stop = startBandAutoScroll(el);
  observerCallback!([{ isIntersecting: true }]);

  setVisibility("hidden");
  expect(frames.size).toBe(0);
  setVisibility("visible");
  expect(frames.size).toBe(1);
  stop();
  setVisibility("hidden");
  setVisibility("visible");
  expect(frames.size).toBe(0);
});

it("does nothing when the band already fits", () => {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollWidth", { value: 300 });
  Object.defineProperty(el, "clientWidth", { value: 300 });
  const stop = startBandAutoScroll(el);
  expect(observerCallback).toBeNull();
  stop();
});
