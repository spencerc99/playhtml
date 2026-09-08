// ABOUTME: Verifies the live portrait always applies the saved (or shipped-default)
// ABOUTME: sound arrangement automatically, never persists it, and never sounds the nav gong

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../../types";

const STORAGE_KEY = "playhtml-sound-playground-config";

const setConfigMock = vi.fn();
const setCantusMock = vi.fn();
const setVolumeMock = vi.fn();
const triggerNavigationMock = vi.fn();
const setCanvasWidthMock = vi.fn();
const initMock = vi.fn(() => Promise.resolve());

vi.mock("../../sound/SoundEngine", () => {
  class FakeSoundEngine {
    init = initMock;
    setCanvasWidth = setCanvasWidthMock;
    setConfig = setConfigMock;
    setCantus = setCantusMock;
    setVolume = setVolumeMock;
    triggerNavigation = triggerNavigationMock;
    resume = vi.fn(() => Promise.resolve());
    dispose = vi.fn();
  }
  return { SoundEngine: FakeSoundEngine };
});

import { MovementCanvas } from "../MovementCanvas";

const EVENTS: CollectionEvent[] = [];

function renderCanvas(props: { live?: boolean }) {
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
        defaultSoundEnabled: true,
        live: props.live ?? false,
      }),
    );
  });
  return { root, container };
}

beforeEach(() => {
  vi.useFakeTimers();
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  setConfigMock.mockClear();
  setCantusMock.mockClear();
  setVolumeMock.mockClear();
  triggerNavigationMock.mockClear();
  setCanvasWidthMock.mockClear();
  initMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

/** Wait for the SoundEngine's async init().then(...) chain to settle and for
 * React to commit the state update that follows. */
async function flushEngineInit() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("MovementCanvas live-path sound arrangement", () => {
  it("applies a stored arrangement automatically on the live path", async () => {
    // The saved mode is "notes", which no longer exists. A save on disk still
    // carries it, so what has to reach the engine is the migrated mode rather
    // than the dead one.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: "2026-01-01T00:00:00.000Z",
        config: {
          v: 1,
          globals: {
            mode: "notes",
            chordRotation: true,
            progression: "aeolian",
            energyArc: true,
            trailVoices: true,
            swells: true,
            choralTimbre: false,
            cursorInstruments: true,
            soloistVoice: "bells",
            traceability: 0,
            volume: 0.5,
          },
          layers: {
            bassPedal: false,
            trailArrivals: true,
            navigationSounds: true,
            crossings: "off",
            cantus: null,
          },
          voicing: { click: "bells", hold: "bell" },
          visuals: {
            gathering: true,
            knot: true,
            lightnessSurge: true,
            hueTilt: false,
          },
        },
      }),
    );

    const { root, container } = renderCanvas({ live: true });
    await flushEngineInit();

    expect(setConfigMock).toHaveBeenCalled();
    const lastCall =
      setConfigMock.mock.calls[setConfigMock.mock.calls.length - 1][0];
    expect(lastCall.mode).toBe("sustained");

    act(() => root.unmount());
    container.remove();
  });

  it("applies the shipped default arrangement on the live path when nothing is saved", async () => {
    const { root, container } = renderCanvas({ live: true });
    await flushEngineInit();

    expect(setConfigMock).toHaveBeenCalled();
    const lastCall =
      setConfigMock.mock.calls[setConfigMock.mock.calls.length - 1][0];
    // SCENE_DEFAULTS.mode in persistedConfig.ts
    expect(lastCall.mode).toBe("spotlight");

    act(() => root.unmount());
    container.remove();
  });

  it("does not persist the auto-applied arrangement back to storage on the live path", async () => {
    const { root, container } = renderCanvas({ live: true });
    await flushEngineInit();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("leaves the archive path unaffected without the sounddev flag", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: "2026-01-01T00:00:00.000Z",
        config: {
          v: 1,
          globals: {
            mode: "spotlight",
            chordRotation: true,
            progression: "aeolian",
            energyArc: true,
            trailVoices: true,
            swells: true,
            choralTimbre: false,
            cursorInstruments: true,
            soloistVoice: "bells",
            traceability: 0,
            volume: 0.5,
          },
          layers: {
            bassPedal: false,
            trailArrivals: true,
            navigationSounds: true,
            crossings: "off",
            cantus: null,
          },
          voicing: { click: "bells", hold: "bell" },
          visuals: {
            gathering: true,
            knot: true,
            lightnessSurge: true,
            hueTilt: false,
          },
        },
      }),
    );

    const { root, container } = renderCanvas({ live: false });
    await flushEngineInit();

    // Without ?sounddev=1, the archive's own settings.sound* fields (from
    // DEFAULT_SETTINGS, soundMode: "sustained") drive the engine — the saved
    // arrangement's "spotlight" mode is never read.
    expect(setConfigMock).toHaveBeenCalled();
    const lastCall =
      setConfigMock.mock.calls[setConfigMock.mock.calls.length - 1][0];
    expect(lastCall.mode).toBe("sustained");

    act(() => root.unmount());
    container.remove();
  });

  it("never triggers the navigation gong from the live path", async () => {
    const { root, container } = renderCanvas({ live: true });
    await flushEngineInit();

    // Give any scheduled rAF-driven navigation driver a chance to run.
    await act(async () => {
      await Promise.resolve();
    });

    expect(triggerNavigationMock).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
