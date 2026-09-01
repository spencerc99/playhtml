// ABOUTME: Groups keyboard collection events into stable visible typing-box sessions.
// ABOUTME: Shares the renderer's input identity, merge window, and event eligibility rules.

import type { CollectionEvent, KeyboardEventData } from "../types";

export const TYPING_EVENT_MERGE_THRESHOLD_MS = 35_000;

export interface TypingEventGroup {
  id: string;
  inputId: string;
  events: CollectionEvent[];
  startTs: number;
  endTs: number;
}

function typingEventText(event: CollectionEvent): string {
  const data = event.data as KeyboardEventData;
  return (data.sequence ?? []).reduce(
    (text, action) => text + (action.text ?? ""),
    "",
  );
}

function isVisibleTypingEvent(event: CollectionEvent): boolean {
  if (event.type !== "keyboard" || !event.id) return false;
  const data = event.data as KeyboardEventData;
  if (!data.sequence || data.sequence.length === 0) return false;
  return typingEventText(event) !== "elizabeth";
}

function typingInputId(event: CollectionEvent): string {
  const data = event.data as KeyboardEventData;
  return JSON.stringify([
    event.meta.pid,
    event.meta.sid,
    event.meta.url || "",
    data.t || "unknown",
  ]);
}

function createTypingEventGroup(
  inputId: string,
  events: CollectionEvent[],
): TypingEventGroup {
  const first = events[0];
  const last = events.at(-1) ?? first;
  return {
    id: `${inputId}:${first.id}`,
    inputId,
    events,
    startTs: first.ts,
    endTs: last.ts,
  };
}

/**
 * Returns visible typing-box groups in chronological order. Events within each
 * group are chronological, and fragmented captures merge when adjacent rows
 * for the same input are no more than 35 seconds apart.
 */
export function groupTypingEvents(
  events: readonly CollectionEvent[],
): TypingEventGroup[] {
  const eventsByInput = new Map<string, CollectionEvent[]>();

  for (const event of events) {
    if (!isVisibleTypingEvent(event)) continue;
    const inputId = typingInputId(event);
    const inputEvents = eventsByInput.get(inputId);
    if (inputEvents) {
      inputEvents.push(event);
    } else {
      eventsByInput.set(inputId, [event]);
    }
  }

  const groups: TypingEventGroup[] = [];
  for (const [inputId, inputEvents] of eventsByInput) {
    const chronological = [...inputEvents].sort(
      (a, b) => a.ts - b.ts || a.id.localeCompare(b.id),
    );
    let current: CollectionEvent[] = [];

    for (const event of chronological) {
      const previous = current.at(-1);
      if (
        previous &&
        event.ts - previous.ts > TYPING_EVENT_MERGE_THRESHOLD_MS
      ) {
        groups.push(createTypingEventGroup(inputId, current));
        current = [];
      }
      current.push(event);
    }

    if (current.length > 0) {
      groups.push(createTypingEventGroup(inputId, current));
    }
  }

  return groups.sort(
    (a, b) => a.startTs - b.startTs || a.id.localeCompare(b.id),
  );
}
