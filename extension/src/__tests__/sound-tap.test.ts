// ABOUTME: Tests the MAIN-world sound tap against real HTML media elements.
// ABOUTME: Covers play wrapping, document play-event redundancy, and cleanup.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SoundTapModule {
  SOUND_PLAY_MESSAGE_TYPE: string;
  installSoundTap: () => () => void;
  default: {
    matches: string[];
    runAt: string;
    allFrames: boolean;
    world: string;
  };
}

describe("MAIN-world sound tap", () => {
  let soundTap: SoundTapModule;
  let cleanup: (() => void) | undefined;
  let originalPlayDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
    originalPlayDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "play",
    );
    soundTap = (await import("../entrypoints/sound-tap.content")) as SoundTapModule;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    if (originalPlayDescriptor) {
      Object.defineProperty(
        HTMLMediaElement.prototype,
        "play",
        originalPlayDescriptor,
      );
    }
    vi.restoreAllMocks();
  });

  it("registers as a top-frame document-start MAIN-world content script", () => {
    expect(soundTap.default).toMatchObject({
      matches: ["http://*/*", "https://*/*"],
      runAt: "document_start",
      allFrames: false,
      world: "MAIN",
    });
  });

  it("posts detached media metadata and preserves the original play return value", () => {
    const playResult = Promise.resolve();
    const originalPlay = vi.fn(function () {
      return playResult;
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      value: originalPlay,
      writable: true,
      configurable: true,
    });
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    cleanup = soundTap.installSoundTap();

    const audio = document.createElement("audio");
    audio.src = "https://cdn.example.com/chime.mp3?token=secret";
    Object.defineProperty(audio, "duration", {
      value: 2.5,
      configurable: true,
    });

    const result = audio.play();

    expect(result).toBe(playResult);
    expect(originalPlay).toHaveBeenCalledOnce();
    expect(originalPlay.mock.instances[0]).toBe(audio);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: soundTap.SOUND_PLAY_MESSAGE_TYPE,
        src: "https://cdn.example.com/chime.mp3?token=secret",
        mediaKind: "audio",
        detached: true,
        duration: 2.5,
        timestamp: expect.any(Number),
      },
      "*",
    );
  });

  it("posts metadata from a capture-phase play event as the autoplay fallback", () => {
    const originalPlay = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      value: originalPlay,
      writable: true,
      configurable: true,
    });
    const postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    cleanup = soundTap.installSoundTap();

    const video = document.createElement("video");
    video.src = "https://cdn.example.com/ambient.mp4#scene";
    Object.defineProperty(video, "duration", {
      value: 12.25,
      configurable: true,
    });
    document.body.appendChild(video);

    video.dispatchEvent(new Event("play"));

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: soundTap.SOUND_PLAY_MESSAGE_TYPE,
        src: "https://cdn.example.com/ambient.mp4#scene",
        mediaKind: "video",
        detached: false,
        duration: 12.25,
        timestamp: expect.any(Number),
      },
      "*",
    );
  });

  it("does not overwrite a page patch installed after the tap", () => {
    const originalPlay = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      value: originalPlay,
      writable: true,
      configurable: true,
    });
    cleanup = soundTap.installSoundTap();
    const pagePlay = vi.fn().mockResolvedValue(undefined);

    HTMLMediaElement.prototype.play = pagePlay;
    cleanup();
    cleanup = undefined;

    expect(HTMLMediaElement.prototype.play).toBe(pagePlay);
  });
});
