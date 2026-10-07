// ABOUTME: Verifies ?sounddev=1 waives a route's enforced clean-level floor
// ABOUTME: so the installation screen can show the sound dev surfaces it otherwise hides

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../../types";

vi.mock("../../sound/SoundEngine", () => {
  class FakeSoundEngine {
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

import { MovementCanvas } from "../MovementCanvas";

const EVENTS: CollectionEvent[] = [];

/**
 * The `#sound-performance` readout stands in for the whole set of sound dev
 * surfaces here. It and the dev panel are gated on the same `printMode`, but
 * the panel lives inside the controls drawer, which this suite cannot mount
 * (downshift resolves its own React copy under jsdom). The readout hangs off
 * the canvas directly, so it shows the gate's real result with no stand-ins.
 */
const READOUT = "#sound-performance";

/** Put the page on a given query string. The sound flag and the clean level
 * are both read once at mount, so this has to be set before rendering. */
function setSearch(search: string) {
  window.history.replaceState({}, "", `/installation/live/${search}`);
}

function renderCanvas(props: {
  minimumCleanLevel?: 0 | 1 | 2;
  live?: boolean;
}) {
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
        minimumCleanLevel: props.minimumCleanLevel,
        live: props.live ?? true,
      }),
    );
  });
  return { root, container };
}

beforeEach(() => {
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  setSearch("");
});

afterEach(() => {
  window.localStorage.clear();
  setSearch("");
});

describe("the installation screen's clean-level floor", () => {
  it("hides the sound dev surfaces without the flag", () => {
    setSearch("?screen=cursors");
    const { root, container } = renderCanvas({ minimumCleanLevel: 2 });

    expect(document.querySelector(READOUT)).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("shows the sound dev surfaces with ?sounddev=1", () => {
    setSearch("?screen=cursors&sounddev=1");
    const { root, container } = renderCanvas({ minimumCleanLevel: 2 });

    expect(document.querySelector(READOUT)).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("still honours an explicit ?clean=2 alongside the flag", () => {
    // The waiver is of the route's floor, not of a clean level the URL asks
    // for outright — otherwise there would be no way to capture a bare frame
    // from a page that is also running the sound surfaces.
    setSearch("?screen=cursors&sounddev=1&clean=2");
    const { root, container } = renderCanvas({ minimumCleanLevel: 2 });

    expect(document.querySelector(READOUT)).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("leaves a page with no floor to waive exactly as it was", () => {
    // Nothing about the waiver reaches a route that never pinned a floor: a
    // live page with the flag showed the readout before and still does.
    setSearch("?sounddev=1");
    const { root, container } = renderCanvas({});

    expect(document.querySelector(READOUT)).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("keeps a flagless page with no floor bare", () => {
    setSearch("");
    const { root, container } = renderCanvas({});

    expect(document.querySelector(READOUT)).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
