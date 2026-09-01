// ABOUTME: Defines deterministic screen ownership and live-chapter readiness for installations.
// ABOUTME: Keeps cross-computer followers disjoint without runtime coordination.

import type { CollectionEvent } from "../types";
import { hashString } from "./styleUtils";

export const LIVE_INSTALLATION_VISUALIZATIONS = [
  "trails",
  "clicks",
  "scrolling",
  "navigation",
] as const;

export type LiveInstallationView = "field" | "follow";

export interface LiveInstallationScreenConfig {
  view: LiveInstallationView;
  slot: number;
  slots: number;
}

const DEFAULT_FOLLOWER_COUNT = 4;
const MAX_FOLLOWER_COUNT = 32;
const MIN_LIVE_SPAN_MS = 30_000;
const DENSE_LIVE_EVENT_COUNT = 1000;

function parseInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseLiveInstallationScreen(
  search: string = window.location.search,
): LiveInstallationScreenConfig {
  const params = new URLSearchParams(search);
  const view = params.get("view") === "follow" ? "follow" : "field";
  const requestedSlots = parseInteger(params.get("slots"));
  const slots = Math.min(
    MAX_FOLLOWER_COUNT,
    Math.max(1, requestedSlots ?? DEFAULT_FOLLOWER_COUNT),
  );
  const requestedSlot = parseInteger(params.get("slot"));
  const slot = Math.min(slots - 1, requestedSlot ?? 0);

  return { view, slot, slots };
}

export function participantInstallationSlot(pid: string, slots: number): number {
  if (!Number.isInteger(slots) || slots < 1) {
    throw new Error("Installation follower count must be a positive integer");
  }
  return hashString(pid) % slots;
}

export function eventsForInstallationScreen(
  events: CollectionEvent[],
  screen: LiveInstallationScreenConfig,
): CollectionEvent[] {
  if (screen.view === "field") return events;
  return events.filter(
    (event) =>
      participantInstallationSlot(event.meta.pid, screen.slots) === screen.slot,
  );
}

export function unconsumedLiveEvents(
  events: CollectionEvent[],
  consumedIds: ReadonlySet<string>,
): CollectionEvent[] {
  return events
    .filter((event) => !consumedIds.has(event.id))
    .sort((a, b) => a.ts - b.ts);
}

function distinctParticipants(events: CollectionEvent[]): number {
  return new Set(events.map((event) => event.meta.pid)).size;
}

function distinctSessions(events: CollectionEvent[]): number {
  return new Set(events.map((event) => `${event.meta.pid}|${event.meta.sid}`))
    .size;
}

export function liveChapterIsReady(
  events: CollectionEvent[],
  activeVisualizations: readonly string[],
): boolean {
  if (events.length === 0) return false;
  let oldestTs = Infinity;
  let newestTs = -Infinity;
  for (const event of events) {
    oldestTs = Math.min(oldestTs, event.ts);
    newestTs = Math.max(newestTs, event.ts);
  }
  const spanMs = newestTs - oldestTs;
  if (spanMs < MIN_LIVE_SPAN_MS && events.length < DENSE_LIVE_EVENT_COUNT) {
    return false;
  }

  const enabled = new Set(activeVisualizations);
  const cursorMoves = events.filter(
    (event) => event.type === "cursor" && event.data.event === "move",
  );
  if (
    enabled.has("trails") &&
    cursorMoves.length >= 24 &&
    distinctParticipants(cursorMoves) >= 2
  ) {
    return true;
  }

  const clicks = events.filter(
    (event) =>
      event.type === "cursor" &&
      (event.data.event === "click" || event.data.event === "hold"),
  );
  if (enabled.has("clicks") && clicks.length >= 3) return true;

  const scrolls = events.filter(
    (event) => event.type === "viewport" && event.data.event === "scroll",
  );
  if (
    enabled.has("scrolling") &&
    scrolls.length >= 6 &&
    distinctSessions(scrolls) >= 2
  ) {
    return true;
  }

  const navigationSessions = new Map<string, number>();
  if (enabled.has("navigation")) {
    for (const event of events) {
      if (event.type !== "navigation") continue;
      const key = `${event.meta.pid}|${event.meta.sid}`;
      const count = (navigationSessions.get(key) ?? 0) + 1;
      if (count >= 3) return true;
      navigationSessions.set(key, count);
    }
  }

  return false;
}
