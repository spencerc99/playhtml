// ABOUTME: Builds finite scrolling chapters from completed live and archived viewport sessions.
// ABOUTME: Keeps visible windows whole, prioritizes live work, and delays event repeats until exhaustion.

import type { CollectionEvent } from "../types";
import {
  groupScrollEvents,
  scrollEventGroupHasActivity,
  scrollEventGroupHasVisibleActivity,
  type ScrollEventGroup,
} from "./scrollEventGroups";

export const DEFAULT_SCROLL_INSTALLATION_CHAPTER_GROUPS = 1000;
export const SCROLL_INSTALLATION_QUIET_MS = 35_000;

export type ScrollReservoirOrigin = "archive" | "live";

export interface ScrollReservoirState {
  archiveEvents: readonly CollectionEvent[];
  liveEvents: readonly CollectionEvent[];
  seenEventIds: ReadonlySet<string>;
  nowMs: number;
  rotation: number;
}

export interface ScrollReservoirChapter {
  state: ScrollReservoirState;
  events: CollectionEvent[];
  rotation: number;
  repeated: boolean;
  hasLive: boolean;
}

export function createScrollReservoir(): ScrollReservoirState {
  return {
    archiveEvents: [],
    liveEvents: [],
    seenEventIds: new Set(),
    nowMs: 0,
    rotation: 0,
  };
}

function mergeUniqueEvents(
  existing: readonly CollectionEvent[],
  incoming: readonly CollectionEvent[],
): CollectionEvent[] {
  const byId = new Map(existing.map((event) => [event.id, event]));
  for (const event of incoming) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()];
}

export function addScrollReservoirEvents(
  state: ScrollReservoirState,
  events: readonly CollectionEvent[],
  origin: ScrollReservoirOrigin,
  nowMs: number,
): ScrollReservoirState {
  if (!Number.isFinite(nowMs)) {
    throw new Error("Scroll reservoir time must be finite");
  }

  return {
    ...state,
    archiveEvents:
      origin === "archive"
        ? mergeUniqueEvents(state.archiveEvents, events)
        : state.archiveEvents,
    liveEvents:
      origin === "live"
        ? mergeUniqueEvents(state.liveEvents, events)
        : state.liveEvents,
    nowMs: Math.max(state.nowMs, nowMs),
  };
}

function availableGroups(
  state: ScrollReservoirState,
  seenEventIds: ReadonlySet<string>,
): { live: ScrollEventGroup[]; archive: ScrollEventGroup[] } {
  const unseenEvents = mergeUniqueEvents(
    state.archiveEvents,
    state.liveEvents,
  ).filter((event) => !seenEventIds.has(event.id));
  const liveEventIds = new Set(state.liveEvents.map((event) => event.id));
  const completionCutoff = state.nowMs - SCROLL_INSTALLATION_QUIET_MS;
  const completedLive: ScrollEventGroup[] = [];
  const archived: ScrollEventGroup[] = [];

  for (const group of groupScrollEvents(unseenEvents)) {
    if (!scrollEventGroupHasActivity(group)) continue;
    const containsLiveEvent = group.events.some((event) =>
      liveEventIds.has(event.id),
    );
    if (!containsLiveEvent) {
      archived.push(group);
    } else if (group.endTs <= completionCutoff) {
      completedLive.push(group);
    }
  }

  const completedGroups = [...completedLive, ...archived];
  const hasVisibleGroup = completedGroups.some(
    scrollEventGroupHasVisibleActivity,
  );
  const eligible = (groups: ScrollEventGroup[]) =>
    hasVisibleGroup
      ? groups.filter(scrollEventGroupHasVisibleActivity)
      : groups;
  const live = eligible(completedLive);
  const archive = eligible(archived);
  live.sort((a, b) => a.startTs - b.startTs || a.id.localeCompare(b.id));
  archive.sort((a, b) => b.startTs - a.startTs || a.id.localeCompare(b.id));
  return { live, archive };
}

function selectGroups(
  groups: { live: ScrollEventGroup[]; archive: ScrollEventGroup[] },
  maxGroups: number,
): { selected: ScrollEventGroup[]; liveIds: Set<string> } {
  const selected: ScrollEventGroup[] = [];
  const liveIds = new Set<string>();
  for (const group of [...groups.live, ...groups.archive]) {
    if (selected.length >= maxGroups) break;
    selected.push(group);
    if (groups.live.includes(group)) liveIds.add(group.id);
  }
  return { selected, liveIds };
}

export function takeScrollReservoirChapter(
  state: ScrollReservoirState,
  maxGroups: number = DEFAULT_SCROLL_INSTALLATION_CHAPTER_GROUPS,
): ScrollReservoirChapter {
  if (!Number.isInteger(maxGroups) || maxGroups < 1) {
    throw new Error("Scroll reservoir chapter size must be a positive integer");
  }

  let seenEventIds = state.seenEventIds;
  let groups = availableGroups(state, seenEventIds);
  let selection = selectGroups(groups, maxGroups);
  let repeated = false;

  if (selection.selected.length === 0) {
    const resetGroups = availableGroups(state, new Set());
    const resetSelection = selectGroups(resetGroups, maxGroups);
    if (resetSelection.selected.length > 0) {
      seenEventIds = new Set();
      groups = resetGroups;
      selection = resetSelection;
      repeated = true;
    }
  }

  const nextSeenEventIds = new Set(seenEventIds);
  for (const group of selection.selected) {
    for (const event of group.events) nextSeenEventIds.add(event.id);
  }

  const rotation = repeated ? state.rotation + 1 : state.rotation;
  return {
    state: {
      ...state,
      seenEventIds: nextSeenEventIds,
      rotation,
    },
    events: selection.selected.flatMap((group) => group.events),
    rotation,
    repeated,
    hasLive: selection.selected.some((group) =>
      selection.liveIds.has(group.id),
    ),
  };
}
