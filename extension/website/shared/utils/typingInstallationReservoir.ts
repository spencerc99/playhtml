// ABOUTME: Builds finite typing chapters from completed live and archived input sessions.
// ABOUTME: Keeps groups whole, prioritizes live work, and delays repeats until exhaustion.

import type { CollectionEvent } from "../types";
import {
  groupTypingEvents,
  TYPING_EVENT_MERGE_THRESHOLD_MS,
  type TypingEventGroup,
} from "./typingEventGroups";

export const DEFAULT_TYPING_INSTALLATION_CHAPTER_GROUPS = 1000;

export type TypingReservoirOrigin = "archive" | "live";

export interface TypingReservoirState {
  archiveEvents: readonly CollectionEvent[];
  liveEvents: readonly CollectionEvent[];
  seenEventIds: ReadonlySet<string>;
  seenGroupIds: ReadonlySet<string>;
  nowMs: number;
  rotation: number;
}

export interface TypingReservoirChapter {
  state: TypingReservoirState;
  events: CollectionEvent[];
  rotation: number;
  repeated: boolean;
  hasLive: boolean;
}

export function createTypingReservoir(): TypingReservoirState {
  return {
    archiveEvents: [],
    liveEvents: [],
    seenEventIds: new Set(),
    seenGroupIds: new Set(),
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

export function addTypingReservoirEvents(
  state: TypingReservoirState,
  events: readonly CollectionEvent[],
  origin: TypingReservoirOrigin,
  nowMs: number,
): TypingReservoirState {
  if (!Number.isFinite(nowMs)) {
    throw new Error("Typing reservoir time must be finite");
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

function reservoirGroups(state: TypingReservoirState): {
  live: TypingEventGroup[];
  archive: TypingEventGroup[];
} {
  const completionCutoff = state.nowMs - TYPING_EVENT_MERGE_THRESHOLD_MS;
  const liveEventIds = new Set(state.liveEvents.map((event) => event.id));
  const allEvents = mergeUniqueEvents(state.archiveEvents, state.liveEvents);
  const live: TypingEventGroup[] = [];
  const archive: TypingEventGroup[] = [];

  for (const group of groupTypingEvents(allEvents)) {
    const containsLiveEvent = group.events.some((event) =>
      liveEventIds.has(event.id),
    );
    if (!containsLiveEvent) {
      archive.push(group);
    } else if (group.endTs <= completionCutoff) {
      live.push(group);
    }
  }

  live.sort((a, b) => a.startTs - b.startTs || a.id.localeCompare(b.id));
  archive.sort((a, b) => b.startTs - a.startTs || a.id.localeCompare(b.id));
  return { live, archive };
}

function groupIsUnseen(
  group: TypingEventGroup,
  seenGroupIds: ReadonlySet<string>,
  seenEventIds: ReadonlySet<string>,
): boolean {
  return (
    !seenGroupIds.has(group.id) &&
    group.events.every((event) => !seenEventIds.has(event.id))
  );
}

function selectChapterGroups(
  liveGroups: readonly TypingEventGroup[],
  archivedGroups: readonly TypingEventGroup[],
  seenGroupIds: ReadonlySet<string>,
  seenEventIds: ReadonlySet<string>,
  maxGroups: number,
): { groups: TypingEventGroup[]; liveGroupIds: Set<string> } {
  const groups: TypingEventGroup[] = [];
  const liveGroupIds = new Set<string>();
  const selectedGroupIds = new Set(seenGroupIds);
  const selectedEventIds = new Set(seenEventIds);

  const append = (group: TypingEventGroup, live: boolean) => {
    if (groups.length >= maxGroups) return;
    if (!groupIsUnseen(group, selectedGroupIds, selectedEventIds)) return;
    groups.push(group);
    selectedGroupIds.add(group.id);
    for (const event of group.events) selectedEventIds.add(event.id);
    if (live) liveGroupIds.add(group.id);
  };

  for (const group of liveGroups) append(group, true);
  for (const group of archivedGroups) append(group, false);

  return { groups, liveGroupIds };
}

export function takeTypingReservoirChapter(
  state: TypingReservoirState,
  maxGroups: number = DEFAULT_TYPING_INSTALLATION_CHAPTER_GROUPS,
): TypingReservoirChapter {
  if (!Number.isInteger(maxGroups) || maxGroups < 1) {
    throw new Error("Typing reservoir chapter size must be a positive integer");
  }

  const { live: liveGroups, archive: archivedGroups } = reservoirGroups(state);
  let repeated = false;
  let seenGroupIds = state.seenGroupIds;
  let seenEventIds = state.seenEventIds;
  let selection = selectChapterGroups(
    liveGroups,
    archivedGroups,
    seenGroupIds,
    seenEventIds,
    maxGroups,
  );

  if (
    selection.groups.length === 0 &&
    (liveGroups.length > 0 || archivedGroups.length > 0)
  ) {
    repeated = true;
    seenGroupIds = new Set();
    seenEventIds = new Set();
    selection = selectChapterGroups(
      liveGroups,
      archivedGroups,
      seenGroupIds,
      seenEventIds,
      maxGroups,
    );
  }

  const nextSeenGroupIds = new Set(seenGroupIds);
  const nextSeenEventIds = new Set(seenEventIds);
  for (const group of selection.groups) {
    nextSeenGroupIds.add(group.id);
    for (const event of group.events) nextSeenEventIds.add(event.id);
  }

  const rotation = repeated ? state.rotation + 1 : state.rotation;
  const nextState: TypingReservoirState = {
    ...state,
    seenGroupIds: nextSeenGroupIds,
    seenEventIds: nextSeenEventIds,
    rotation,
  };

  return {
    state: nextState,
    events: selection.groups.flatMap((group) => group.events),
    rotation,
    repeated,
    hasLive: selection.groups.some((group) =>
      selection.liveGroupIds.has(group.id),
    ),
  };
}
