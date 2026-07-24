// ABOUTME: Tests sound-day derivation, compressed timeline scheduling, and seed WAV output.
// ABOUTME: Verifies authoritative play times, range crossing, inverse mapping, and RIFF headers.

import { describe, expect, it } from "vitest";
import type { CollectionEvent, SoundEventData } from "../collectors/types";
import { encodeMonoWav } from "../entrypoints/sounds/seedData";
import {
  dayTimeToPlaybackMs,
  deriveSoundDays,
  findSoundEventsInPlaybackRange,
  getDayBounds,
  playbackMsToDayTime,
} from "../entrypoints/sounds/timeline";

function soundEvent(
  id: string,
  ts: number,
  playedAtMs?: number,
): CollectionEvent {
  const data: SoundEventData = {
    mediaKind: "audio",
    detached: true,
  };
  if (playedAtMs !== undefined) data.playedAtMs = playedAtMs;
  return {
    id,
    type: "sound",
    ts,
    data,
    meta: {
      pid: "test",
      sid: "test",
      url: "https://sound.test",
      vw: 1000,
      vh: 800,
      tz: "America/Los_Angeles",
    },
  };
}

describe("sound timeline", () => {
  it("maps day timestamps to playback time and back", () => {
    const bounds = getDayBounds("2026-07-23");
    const noon = bounds.startMs + bounds.durationMs / 2;

    expect(dayTimeToPlaybackMs(noon, bounds, 90_000)).toBe(45_000);
    expect(playbackMsToDayTime(45_000, bounds, 90_000)).toBe(noon);
  });

  it("fires only events crossed by the current playback frame", () => {
    const bounds = getDayBounds("2026-07-23");
    const events = [
      soundEvent("early", bounds.startMs, bounds.startMs + 2 * 3_600_000),
      soundEvent("crossed", bounds.startMs, bounds.startMs + 12 * 3_600_000),
      soundEvent("late", bounds.startMs, bounds.startMs + 20 * 3_600_000),
    ];

    expect(
      findSoundEventsInPlaybackRange(
        events,
        bounds,
        120_000,
        50_000,
        70_000,
      ).map((event) => event.id),
    ).toEqual(["crossed"]);
    expect(
      findSoundEventsInPlaybackRange(
        events,
        bounds,
        120_000,
        70_000,
        30_000,
      ),
    ).toEqual([]);
  });

  it("derives days from playedAtMs before falling back to ts", () => {
    const firstDay = getDayBounds("2026-07-22");
    const secondDay = getDayBounds("2026-07-23");
    const events = [
      soundEvent("fallback", firstDay.startMs + 1000),
      soundEvent(
        "authoritative",
        firstDay.startMs + 2000,
        secondDay.startMs + 3000,
      ),
    ];

    expect(deriveSoundDays(events)).toEqual(["2026-07-23", "2026-07-22"]);
  });
});

describe("seed WAV encoder", () => {
  it("writes a valid mono 16-bit RIFF/WAVE header", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeMonoWav(samples, 22_050);
    const bytes = new Uint8Array(wav);
    const view = new DataView(wav);
    const ascii = (start: number, length: number) =>
      String.fromCharCode(...bytes.slice(start, start + length));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(22_050);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav.byteLength).toBe(44 + samples.length * 2);
  });
});
