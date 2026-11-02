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

  it("holds no slide while muted", async () => {
    const AudioContext = vi.fn();
    vi.stubGlobal("AudioContext", AudioContext);
    const sounds = await freshModule();
    sounds.setCollageSoundsMuted(true);
    expect(sounds.startCollageSlide(0)).toBeNull();
    expect(AudioContext).not.toHaveBeenCalled();
  });

  it("holds no slide when the browser has no audio", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const sounds = await freshModule();
    expect(sounds.startCollageSlide(0.5)).toBeNull();
  });

  it("pitches a restack higher the nearer the front it lands", async () => {
    const frequencies: number[] = [];
    const param = () => ({
      value: 0,
      setValueAtTime(v: number) {
        this.value = v;
        return this;
      },
      exponentialRampToValueAtTime() {},
      linearRampToValueAtTime() {},
      setTargetAtTime() {},
    });
    const node = () => ({
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
      gain: param(),
      frequency: param(),
      Q: param(),
      pan: param(),
      playbackRate: param(),
      threshold: param(),
      ratio: param(),
    });
    class FakeContext {
      state = "running";
      sampleRate = 8000;
      currentTime = 0;
      destination = node();
      resume = () => Promise.resolve();
      createGain = node;
      createDynamicsCompressor = node;
      createConvolver = node;
      createStereoPanner = node;
      createBiquadFilter = node;
      createBufferSource = node;
      createOscillator = () => {
        const osc = node();
        const set = osc.frequency.setValueAtTime.bind(osc.frequency);
        osc.frequency.setValueAtTime = (v: number) => {
          frequencies.push(v);
          return set(v);
        };
        return osc;
      };
      createBuffer = (_c: number, length: number) => ({
        duration: length / 8000,
        getChannelData: () => new Float32Array(length),
      });
    }
    vi.stubGlobal("AudioContext", FakeContext);
    const sounds = await freshModule();

    sounds.playCollageSound("layerUp", 0, { from: 0.5, to: 0.5 });
    const middle = frequencies[0];
    frequencies.length = 0;
    sounds.playCollageSound("layerUp", 0, { from: 1, to: 1 });
    const top = frequencies[0];
    frequencies.length = 0;
    sounds.playCollageSound("layerDown", 0, { from: 0, to: 0 });
    const bottom = frequencies[0];

    expect(bottom).toBeLessThan(middle);
    expect(middle).toBeLessThan(top);
  });

  it("waits for a gesture to wake audio, then stops listening", async () => {
    let state = "suspended";
    const resume = vi.fn(() => {
      state = "running";
      return Promise.resolve();
    });
    const created = vi.fn();
    class FakeContext {
      sampleRate = 8000;
      currentTime = 0;
      get state() {
        return state;
      }
      resume = resume;
      destination = {};
      constructor() {
        created();
      }
      createBuffer = (_c: number, length: number) => ({
        duration: length / 8000,
        getChannelData: () => new Float32Array(length),
      });
      createBufferSource = () => ({ connect() {}, start() {} });
      createGain = () => ({ gain: { value: 0 }, connect() {} });
      createDynamicsCompressor = () => ({
        threshold: { value: 0 },
        ratio: { value: 0 },
        connect() {},
      });
      createConvolver = () => ({ connect() {} });
    }
    vi.stubGlobal("AudioContext", FakeContext);
    const sounds = await freshModule();
    sounds.primeCollageSounds();
    expect(created).not.toHaveBeenCalled();

    document.dispatchEvent(new Event("pointerdown"));
    expect(created).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("pointerdown"));
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
