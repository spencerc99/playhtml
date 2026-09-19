// ABOUTME: Verifies unattended installation tabs respond once to reload generations.
// ABOUTME: Covers baseline seeding, polling failures, wake events, and persisted handoff.

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInstallationReload } from "../useInstallationReload";

const STORAGE_KEY = "wwo-installation-reload-generation";

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderReloadHook(options: Parameters<typeof useInstallationReload>[0]) {
  const container = document.createElement("div");
  const root = createRoot(container);
  function Harness() {
    useInstallationReload(options);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
  await flush();
  return async () => act(async () => root.unmount());
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("installation reload polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => vi.useRealTimers());

  it("seeds its first observation without reloading", async () => {
    const reloadPage = vi.fn();
    const unmount = await renderReloadHook({
      getControl: vi.fn().mockResolvedValue({ generation: 8, updatedAt: "now" }),
      reloadPage,
      random: () => 0,
    });

    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("8");
    expect(reloadPage).not.toHaveBeenCalled();
    await unmount();
  });

  it("does not poll or attach wake checks when disabled", async () => {
    const getControl = vi.fn();
    const unmount = await renderReloadHook({
      enabled: false,
      getControl,
      reloadPage: vi.fn(),
    });

    window.dispatchEvent(new Event("online"));
    setVisibility("visible");
    await act(async () => vi.advanceTimersByTime(65_000));
    await flush();

    expect(getControl).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    await unmount();
  });

  it("persists a higher generation before reloading and does not repeat it", async () => {
    sessionStorage.setItem(STORAGE_KEY, "8");
    const reloadPage = vi.fn(() => {
      expect(sessionStorage.getItem(STORAGE_KEY)).toBe("11");
    });
    const getControl = vi.fn().mockResolvedValue({ generation: 11, updatedAt: "later" });
    const unmount = await renderReloadHook({ getControl, reloadPage, random: () => 0 });

    expect(reloadPage).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(reloadPage).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("ignores failures and same or lower generations before retrying", async () => {
    sessionStorage.setItem(STORAGE_KEY, "8");
    const reloadPage = vi.fn();
    const getControl = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ generation: 7, updatedAt: "old" })
      .mockResolvedValueOnce({ generation: 8, updatedAt: "same" })
      .mockResolvedValueOnce({ generation: 9, updatedAt: "new" });
    const unmount = await renderReloadHook({ getControl, reloadPage, random: () => 0 });

    await act(async () => vi.advanceTimersByTime(55_000));
    await flush();
    setVisibility("visible");
    await flush();
    window.dispatchEvent(new Event("online"));
    await flush();

    expect(getControl).toHaveBeenCalledTimes(4);
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("9");
    await unmount();
  });

  it("does not check on a hidden visibility event", async () => {
    const getControl = vi.fn().mockResolvedValue({ generation: 1, updatedAt: "now" });
    const unmount = await renderReloadHook({ getControl, reloadPage: vi.fn(), random: () => 0 });

    setVisibility("hidden");
    await flush();
    expect(getControl).toHaveBeenCalledTimes(1);
    await unmount();
  });
});
