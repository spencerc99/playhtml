// ABOUTME: Tests sound metadata validation, privacy filtering, and deduplication.
// ABOUTME: Exercises the real window message bridge handled by SoundCollector.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SOUND_DEDUP_WINDOW_MS,
  SOUND_PLAY_MESSAGE_TYPE,
  SoundCollector,
  isSoundCollectionDenied,
} from "../collectors/SoundCollector";
import type { SoundEventData } from "../collectors/types";

function dispatchSoundMessage(
  data: unknown,
  source: MessageEventSource | null = window,
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      source,
    }),
  );
}

function validSoundMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: SOUND_PLAY_MESSAGE_TYPE,
    src: "https://cdn.example.com/sounds/chime.mp3?token=secret#start",
    mediaKind: "audio",
    detached: true,
    duration: 1.234,
    timestamp: Date.now(),
    captureId: "capture-1",
    ...overrides,
  };
}

describe("SoundCollector", () => {
  let collector: SoundCollector;
  let emitCallback: ReturnType<typeof vi.fn>;
  let acquisition: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    acquire: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    Object.defineProperty(window, "location", {
      value: {
        href: "https://example.com/page?private=value",
        hostname: "example.com",
      },
      writable: true,
      configurable: true,
    });
    document.title = "Example sounds";

    emitCallback = vi.fn();
    acquisition = {
      start: vi.fn(),
      stop: vi.fn(),
      acquire: vi.fn().mockResolvedValue({ acquisition: "none" }),
    };
    collector = new SoundCollector(acquisition);
    collector.setEmitCallback(emitCallback);
    collector.enable();
  });

  afterEach(() => {
    collector.disable();
    vi.useRealTimers();
  });

  it("emits normalized metadata after acquisition completes", async () => {
    dispatchSoundMessage(validSoundMessage());
    await collector.waitForPendingEvents();

    expect(emitCallback).toHaveBeenCalledOnce();
    expect(emitCallback).toHaveBeenCalledWith({
      mediaSrc: "https://cdn.example.com/sounds/chime.mp3",
      mediaKind: "audio",
      detached: true,
      mediaDurationMs: 1234,
      pageTitle: "Example sounds",
      playedAtMs: expect.any(Number),
      acquisition: "none",
    } satisfies SoundEventData);
    expect(acquisition.acquire).toHaveBeenCalledWith({
      sourceUrl:
        "https://cdn.example.com/sounds/chime.mp3?token=secret#start",
      captureId: "capture-1",
      mediaDurationMs: 1234,
    });
  });

  it("caps stored source and page title strings", async () => {
    document.title = "t".repeat(600);
    dispatchSoundMessage(
      validSoundMessage({
        src: `https://cdn.example.com/${"a".repeat(3000)}.mp3?token=secret`,
      }),
    );
    await collector.waitForPendingEvents();

    const data = emitCallback.mock.calls[0][0] as SoundEventData;
    expect(data.mediaSrc).toHaveLength(2048);
    expect(data.mediaSrc).not.toContain("token=secret");
    expect(data.pageTitle).toHaveLength(512);
  });

  it("rejects messages from another window or with malformed fields", () => {
    dispatchSoundMessage(validSoundMessage(), null);
    dispatchSoundMessage(validSoundMessage({ type: "sound-play" }));
    dispatchSoundMessage(validSoundMessage({ mediaKind: "speech" }));
    dispatchSoundMessage(validSoundMessage({ detached: "yes" }));
    dispatchSoundMessage(validSoundMessage({ duration: Number.POSITIVE_INFINITY }));
    dispatchSoundMessage(validSoundMessage({ timestamp: 1.5 }));
    dispatchSoundMessage(validSoundMessage({ src: "x".repeat(16385) }));
    dispatchSoundMessage({ ...validSoundMessage(), unexpected: true });

    expect(emitCallback).not.toHaveBeenCalled();
  });

  it("deduplicates the same normalized source within the collection window", async () => {
    dispatchSoundMessage(validSoundMessage());
    dispatchSoundMessage(
      validSoundMessage({
        src: "https://cdn.example.com/sounds/chime.mp3?token=different#later",
      }),
    );
    await collector.waitForPendingEvents();

    expect(emitCallback).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(SOUND_DEDUP_WINDOW_MS);
    dispatchSoundMessage(validSoundMessage());
    await collector.waitForPendingEvents();

    expect(emitCallback).toHaveBeenCalledTimes(2);
  });

  it("attaches acquired clip metadata to the emitted event", async () => {
    acquisition.acquire.mockResolvedValue({
      acquisition: "refetch",
      clipId: "sound_clip_1",
      mimeType: "audio/mpeg",
      clipDurationMs: 1234,
      sizeBytes: 4096,
    });

    dispatchSoundMessage(validSoundMessage());
    await collector.waitForPendingEvents();

    expect(emitCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        acquisition: "refetch",
        clipId: "sound_clip_1",
        mimeType: "audio/mpeg",
        clipDurationMs: 1234,
        sizeBytes: 4096,
      }),
    );
  });

  it("removes its message listener when disabled", () => {
    collector.disable();
    dispatchSoundMessage(validSoundMessage());

    expect(emitCallback).not.toHaveBeenCalled();
  });
});

describe("sound conferencing denylist", () => {
  it("matches exact hosts and subdomains without matching lookalikes", () => {
    expect(isSoundCollectionDenied("meet.google.com")).toBe(true);
    expect(isSoundCollectionDenied("us02.zoom.us")).toBe(true);
    expect(isSoundCollectionDenied("chat.teams.microsoft.com")).toBe(true);
    expect(isSoundCollectionDenied("discord.com")).toBe(true);
    expect(isSoundCollectionDenied("app.slack.com")).toBe(true);
    expect(isSoundCollectionDenied("room.whereby.com")).toBe(true);
    expect(isSoundCollectionDenied("notdiscord.com")).toBe(false);
  });

  it("does not attach a collector listener on a denied host", () => {
    Object.defineProperty(window, "location", {
      value: {
        href: "https://meet.google.com/abc-defg-hij",
        hostname: "meet.google.com",
      },
      writable: true,
      configurable: true,
    });
    const acquisition = {
      start: vi.fn(),
      stop: vi.fn(),
      acquire: vi.fn().mockResolvedValue({ acquisition: "none" as const }),
    };
    const collector = new SoundCollector(acquisition);
    const emitCallback = vi.fn();
    collector.setEmitCallback(emitCallback);
    collector.enable();

    dispatchSoundMessage(validSoundMessage());

    expect(emitCallback).not.toHaveBeenCalled();
    expect(acquisition.start).not.toHaveBeenCalled();
    expect(acquisition.acquire).not.toHaveBeenCalled();
    collector.disable();
  });
});
