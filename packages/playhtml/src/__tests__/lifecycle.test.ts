// ABOUTME: Tests the playhtml lifecycle state machine and the readiness it exposes.
// ABOUTME: Covers pure transitions plus isLoading and ready across a room switch.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INITIAL_LIFECYCLE,
  hasRoomSynced,
  isConfigLocked,
  isLifecycleLoading,
  nextLifecycle,
  type Lifecycle,
  type LifecycleEvent,
} from "../lifecycle";
import { LOADING_CHANGE_EVENT, playhtml, resetPlayHTML } from "../index";

function run(events: LifecycleEvent[]): Lifecycle {
  return events.reduce(nextLifecycle, INITIAL_LIFECYCLE);
}

describe("lifecycle transitions", () => {
  it("walks the first connection from idle to ready", () => {
    expect(isConfigLocked(INITIAL_LIFECYCLE)).toBe(false);

    const loading = run([{ type: "connect", room: "a" }]);
    expect(isConfigLocked(loading)).toBe(true);
    expect(hasRoomSynced(loading)).toBe(false);

    const synced = nextLifecycle(loading, { type: "providerSynced" });
    expect(hasRoomSynced(synced)).toBe(true);
    expect(isLifecycleLoading(synced)).toBe(true);

    const ready = nextLifecycle(synced, { type: "elementsReady" });
    expect(ready).toEqual({ phase: "ready", room: "a" });
    expect(isLifecycleLoading(ready)).toBe(false);
  });

  it("is loading and unsynced again after reconnecting to a new room", () => {
    const switching = run([
      { type: "connect", room: "a" },
      { type: "providerSynced" },
      { type: "elementsReady" },
      { type: "connect", room: "b" },
    ]);
    expect(switching).toEqual({ phase: "loading", room: "b", synced: false });
    expect(isLifecycleLoading(switching)).toBe(true);
    expect(hasRoomSynced(switching)).toBe(false);
    expect(isConfigLocked(switching)).toBe(true);
  });

  it("restarts the sync when a reset reconnects mid-load", () => {
    const reset = run([
      { type: "connect", room: "a" },
      { type: "providerSynced" },
      { type: "connect", room: "a" },
    ]);
    expect(reset).toEqual({ phase: "loading", room: "a", synced: false });
  });

  it("does not mark ready before the room has synced", () => {
    const early = run([
      { type: "connect", room: "a" },
      { type: "elementsReady" },
    ]);
    expect(early.phase).toBe("loading");
  });

  it("ignores events that do not apply to the phase", () => {
    expect(run([{ type: "providerSynced" }])).toBe(INITIAL_LIFECYCLE);
    expect(run([{ type: "elementsReady" }])).toBe(INITIAL_LIFECYCLE);
    expect(run([{ type: "delegate" }, { type: "connect", room: "a" }])).toEqual(
      {
        phase: "delegated",
        settled: false,
      },
    );
  });

  it("mirrors the owning instance when delegated", () => {
    const delegated = run([{ type: "delegate" }]);
    expect(isLifecycleLoading(delegated)).toBe(true);
    const settled = nextLifecycle(delegated, { type: "delegateSettled" });
    expect(isLifecycleLoading(settled)).toBe(false);
    expect(isConfigLocked(settled)).toBe(false);
  });
});

describe("readiness across a room switch", () => {
  const origPath = window.location.pathname + window.location.search;

  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  afterEach(() => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    history.replaceState(null, "", origPath);
  });

  it("reports loading with a fresh ready promise until the new room syncs", async () => {
    history.replaceState(null, "", "/room-one");
    await playhtml.init({ host: "http://localhost:1999" } as any);
    const firstReady = playhtml.ready;
    expect(playhtml.isLoading).toBe(false);

    const loadingChanges: boolean[] = [];
    const onChange = (event: Event) =>
      loadingChanges.push((event as CustomEvent).detail.isLoading);
    document.addEventListener(LOADING_CHANGE_EVENT, onChange);

    try {
      (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = true;
      history.replaceState(null, "", "/room-two");
      const navigation = playhtml.handleNavigation();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(playhtml.isLoading).toBe(true);
      const switchReady = playhtml.ready;
      expect(switchReady).not.toBe(firstReady);
      let switchResolved = false;
      switchReady.then(() => {
        switchResolved = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(switchResolved).toBe(false);

      const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS;
      providers[providers.length - 1].emit("sync", true);
      await navigation;

      expect(playhtml.isLoading).toBe(false);
      await expect(switchReady).resolves.toBeUndefined();
      expect(loadingChanges).toEqual([true, false]);
    } finally {
      document.removeEventListener(LOADING_CHANGE_EVENT, onChange);
    }
  });

  it("stays ready when navigation keeps the same room", async () => {
    history.replaceState(null, "", "/same-room");
    await playhtml.init({ host: "http://localhost:1999" } as any);
    const firstReady = playhtml.ready;

    await playhtml.handleNavigation();

    expect(playhtml.isLoading).toBe(false);
    expect(playhtml.ready).toBe(firstReady);
  });
});
