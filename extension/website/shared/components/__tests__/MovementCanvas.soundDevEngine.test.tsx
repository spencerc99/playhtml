// ABOUTME: Verifies the sound dev panel and the canvas share one sound engine.
// ABOUTME: Also covers a failed start and an engine that finishes starting after the canvas is gone.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../../types";

const engines: { dispose: ReturnType<typeof vi.fn> }[] = [];
// Each test may swap how the next engine's init() settles.
let initEngine: () => Promise<void> = () => Promise.resolve();

vi.mock("../../sound/SoundEngine", () => {
  class FakeSoundEngine {
    constructor() {
      engines.push(this);
    }
    init = vi.fn(() => initEngine());
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
  initEngine = () => Promise.resolve();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

function renderCanvas(container: HTMLElement) {
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
  return root;
}

it("starts one engine when the panel asks for sound while it is off", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = renderCanvas(container);
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

it("rejects the panel's request when the engine fails to start", async () => {
  const failure = new Error("audio context refused");
  initEngine = () => Promise.reject(failure);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = renderCanvas(container);

  let request: Promise<unknown> = Promise.resolve();
  let outcome: unknown = null;
  await act(async () => {
    request = getEngine!().catch((err: unknown) => {
      outcome = err;
    });
  });
  await request;

  expect(outcome).toBe(failure);
  expect(logged).toHaveBeenCalledWith(
    "[MovementCanvas] sound engine failed to start:",
    failure,
  );
  act(() => root.unmount());
  container.remove();
});

it("disposes an engine that finishes starting after the canvas is gone", async () => {
  let finishInit: () => void = () => {};
  initEngine = () =>
    new Promise<void>((resolve) => {
      finishInit = resolve;
    });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = renderCanvas(container);

  let request: Promise<unknown> = Promise.resolve();
  let outcome: unknown = null;
  await act(async () => {
    request = getEngine!().catch((err: unknown) => {
      outcome = err;
    });
  });
  expect(engines).toHaveLength(1);

  act(() => root.unmount());
  container.remove();
  await request;
  expect(outcome).toEqual(new Error("Sound was turned off before it started"));

  finishInit();
  await Promise.resolve();
  await Promise.resolve();
  expect(engines[0].dispose).toHaveBeenCalledTimes(1);
});
