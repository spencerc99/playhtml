// ABOUTME: Tests wake-time audio resume listeners for movement visualizations.
// ABOUTME: Covers visible-page filtering, cached-page restoration, rejection, and cleanup.

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { attachSoundWakeListeners } from "../soundWake";

const originalVisibilityState = Object.getOwnPropertyDescriptor(
  document,
  "visibilityState",
);

function setVisibilityState(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

afterEach(() => {
  if (originalVisibilityState) {
    Object.defineProperty(document, "visibilityState", originalVisibilityState);
  } else {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  }
  vi.restoreAllMocks();
});

describe("attachSoundWakeListeners", () => {
  it("resumes on visible wake and pageshow, but not when becoming hidden", () => {
    const resume = vi.fn(() => Promise.resolve());
    const detach = attachSoundWakeListeners(resume);

    setVisibilityState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(resume).not.toHaveBeenCalled();

    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    expect(resume).toHaveBeenCalledTimes(2);

    detach();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("handles autoplay-policy rejection without an unhandled rejection", async () => {
    const resume = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    const detach = attachSoundWakeListeners(resume);

    window.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();
    await Promise.resolve();

    expect(resume).toHaveBeenCalledOnce();
    detach();
  });

  it("allows wake events before an engine has been created", () => {
    const resume = vi.fn(() => undefined);
    const detach = attachSoundWakeListeners(resume);

    window.dispatchEvent(new Event("pageshow"));

    expect(resume).toHaveBeenCalledOnce();
    detach();
  });
});
