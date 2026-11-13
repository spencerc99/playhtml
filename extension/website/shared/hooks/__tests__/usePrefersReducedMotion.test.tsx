// ABOUTME: Verifies the reduced-motion hook reads the preference and follows live changes.
// ABOUTME: Also covers environments without matchMedia, where it reads false.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "../usePrefersReducedMotion";

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderProbe() {
  let latest: boolean | null = null;
  const Probe = () => {
    latest = usePrefersReducedMotion();
    return null;
  };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return { root, read: () => latest };
}

it("follows the preference as it changes", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const listeners = new Set<() => void>();
  const media = {
    matches: true,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(prefers-reduced-motion: reduce)");
    return media;
  });

  const { root, read } = renderProbe();
  expect(read()).toBe(true);
  media.matches = false;
  act(() => listeners.forEach((cb) => cb()));
  expect(read()).toBe(false);
  act(() => root.unmount());
  expect(listeners.size).toBe(0);
});

it("reads false without matchMedia", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", undefined);
  const { root, read } = renderProbe();
  expect(read()).toBe(false);
  act(() => root.unmount());
});
