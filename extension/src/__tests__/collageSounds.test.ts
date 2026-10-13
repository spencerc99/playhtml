// ABOUTME: Tests that collage sounds remember muting and stay silent or harmless without audio.
// ABOUTME: Each case loads the module fresh so its cached mute setting starts from storage.

import { afterEach, describe, expect, it, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return import("../entrypoints/scraps/collageSounds");
}

describe("collage sounds", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("starts on and remembers being muted", async () => {
    const first = await freshModule();
    expect(first.collageSoundsMuted()).toBe(false);
    first.setCollageSoundsMuted(true);

    const reloaded = await freshModule();
    expect(reloaded.collageSoundsMuted()).toBe(true);
  });

  it("does nothing while muted", async () => {
    const AudioContext = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    const sounds = await freshModule();
    sounds.setCollageSoundsMuted(true);
    sounds.playCollageSound("place");
    expect(AudioContext).not.toHaveBeenCalled();
  });

  it("never throws when the browser has no audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const sounds = await freshModule();
    expect(() => sounds.playCollageSound("cutout", 0.5)).not.toThrow();
  });
});
