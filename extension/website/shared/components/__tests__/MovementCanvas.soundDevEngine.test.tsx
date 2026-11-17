// ABOUTME: Verifies the sound dev panel and the canvas share one sound engine.
// ABOUTME: Starting sound from the panel must not build a second engine next to the canvas's own.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../../types";

const engines: unknown[] = [];

vi.mock("../../sound/SoundEngine", () => {
  class FakeSoundEngine {
    constructor() {
      engines.push(this);
    }
    init = vi.fn(() => Promise.resolve());
    setCanvasWidth = vi.fn();
    setConfig = vi.fn();
    setCantus = vi.fn();
    setVolume = vi.fn();
    triggerNavigation = vi.fn();
    enablePerformanceMonitoring = vi.fn();
    getPerformanceSnapshot = vi.fn(() => null);
    resume = vi.fn(() => Promise.resolve());
    dispose = vi.fn();
  }
  return { SoundEngine: FakeSoundEngine };
});

// The real controls drawer cannot mount under jsdom (downshift resolves its
// own React copy), so this stands in for it and renders the panel slot only.
vi.mock("../Controls", () => ({
  Controls: (props: { soundSettingsOverride?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, props.soundSettingsOverride),
}));

let getEngine: (() => Promise<unknown>) | null = null;
vi.mock("../../sound/SoundDevSettings", () => ({
  SoundDevSettings: (props: { getEngine: () => Promise<unknown> }) => {
    getEngine = props.getEngine;
    return null;
  },
}));

import { MovementCanvas } from "../MovementCanvas";

const EVENTS: CollectionEvent[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  window.history.replaceState({}, "", "/archive/?sounddev=1");
  engines.length = 0;
  getEngine = null;
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

it("starts one engine when the panel asks for sound while it is off", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(MovementCanvas, {
        events: EVENTS,
        loading: false,
        error: null,
        fetchEvents: () => {},
        activeVisualizations: ["trails"],
        onSetActiveVisualizations: () => {},
        defaultSoundEnabled: false,
        live: false,
      }),
    );
  });
  expect(getEngine).not.toBeNull();
  expect(engines).toHaveLength(0);

  // act only flushes the render getEngine schedules once its callback
  // returns, so the requests start inside it and are awaited after.
  let pending: Promise<unknown>[] = [];
  await act(async () => {
    pending = [getEngine!(), getEngine!()];
  });
  const [first, second] = await Promise.all(pending);

  expect(engines).toHaveLength(1);
  expect(first).toBe(engines[0]);
  expect(second).toBe(engines[0]);
  act(() => root.unmount());
  container.remove();
});
