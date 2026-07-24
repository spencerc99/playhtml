// ABOUTME: Maps captured sound timestamps onto a compressed day playback timeline.
// ABOUTME: Derives local sound days and finds events crossed by each animation frame.

import type { CollectionEvent, SoundEventData } from "../../collectors/types";

export const DEFAULT_DAY_PLAYBACK_DURATION_MS = 90_000;

export interface DayBounds {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export function getSoundPlayTime(event: CollectionEvent): number {
  const playedAtMs = (event.data as SoundEventData).playedAtMs;
  return typeof playedAtMs === "number" && Number.isFinite(playedAtMs)
    ? playedAtMs
    : event.ts;
}

export function getLocalDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDayBounds(day: string): DayBounds {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    durationMs: end.getTime() - start.getTime(),
  };
}

export function deriveSoundDays(events: CollectionEvent[]): string[] {
  return Array.from(
    new Set(
      events
        .filter((event) => event.type === "sound")
        .map((event) => getLocalDayKey(getSoundPlayTime(event))),
    ),
  ).sort((a, b) => b.localeCompare(a));
}

export function dayTimeToPlaybackMs(
  timestamp: number,
  bounds: DayBounds,
  playbackDurationMs: number,
): number {
  const dayProgress = Math.max(
    0,
    Math.min(1, (timestamp - bounds.startMs) / bounds.durationMs),
  );
  return dayProgress * playbackDurationMs;
}

export function playbackMsToDayTime(
  playbackMs: number,
  bounds: DayBounds,
  playbackDurationMs: number,
): number {
  const playbackProgress = Math.max(
    0,
    Math.min(1, playbackMs / playbackDurationMs),
  );
  return bounds.startMs + playbackProgress * bounds.durationMs;
}

export function findSoundEventsInPlaybackRange(
  events: CollectionEvent[],
  bounds: DayBounds,
  playbackDurationMs: number,
  previousPlaybackMs: number,
  currentPlaybackMs: number,
): CollectionEvent[] {
  if (currentPlaybackMs < previousPlaybackMs) return [];

  return events.filter((event) => {
    const playbackMs = dayTimeToPlaybackMs(
      getSoundPlayTime(event),
      bounds,
      playbackDurationMs,
    );
    const crossedStart =
      previousPlaybackMs === 0
        ? playbackMs >= previousPlaybackMs
        : playbackMs > previousPlaybackMs;
    return crossedStart && playbackMs <= currentPlaybackMs;
  });
}
