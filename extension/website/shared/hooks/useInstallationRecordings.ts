// ABOUTME: Keeps complete scrolling and typing recordings available for continuous playback.
// ABOUTME: Samples live arrivals and preserves archive supply while live groups are still forming.
import { useEffect, useRef, useState } from "react";
import type { CollectionEvent } from "../types";
import { groupScrollEvents } from "../utils/scrollEventGroups";
import { groupTypingEvents } from "../utils/typingEventGroups";

export interface InstallationRecordings {
  events: CollectionEvent[];
  liveEventIds: ReadonlySet<string>;
}

export function collectInstallationRecordings(
  archive: readonly CollectionEvent[],
  live: readonly CollectionEvent[],
  kind: "scrolling" | "typing",
  now: number,
): InstallationRecordings {
  const liveIds = new Set(live.map((event) => event.id));
  const events = new Map(archive.map((event) => [event.id, event]));
  for (const event of live) events.set(event.id, event);
  const group = kind === "scrolling" ? groupScrollEvents : groupTypingEvents;
  const groups = group([...events.values()]).filter(
    (recording) =>
      !recording.events.some((event) => liveIds.has(event.id)) ||
      recording.endTs <= now - 35_000,
  );
  return {
    events: groups.flatMap((recording) => recording.events),
    liveEventIds: liveIds,
  };
}

export function useInstallationRecordings(
  archive: CollectionEvent[],
  live: CollectionEvent[],
  kind: "scrolling" | "typing" | null,
  contextKey: string,
): InstallationRecordings {
  const inputs = useRef({ archive, live });
  inputs.current = { archive, live };
  const [recordings, setRecordings] = useState<InstallationRecordings>({
    events: [],
    liveEventIds: new Set(),
  });
  useEffect(() => {
    setRecordings({ events: [], liveEventIds: new Set() });
    if (!kind) return;
    const retainedLive = new Map<string, CollectionEvent>();
    let signature = "";
    let previousArchive: CollectionEvent[] | undefined;
    let latestLiveTimestamp = 0;
    let settled = false;
    const update = () => {
      let changed = inputs.current.archive !== previousArchive;
      for (const event of inputs.current.live) {
        if (
          (kind === "typing" && event.type === "keyboard") ||
          (kind === "scrolling" && event.type === "viewport")
        ) {
          if (!retainedLive.has(event.id)) {
            retainedLive.set(event.id, event);
            latestLiveTimestamp = Math.max(latestLiveTimestamp, event.ts);
            changed = true;
          }
        }
      }
      if (!changed && settled) return;
      previousArchive = inputs.current.archive;
      const now = Date.now();
      settled = now >= latestLiveTimestamp + 35_000;
      // Bound retained live footage independently of the fetched archive.
      while (retainedLive.size > 10_000) {
        retainedLive.delete(retainedLive.keys().next().value!);
      }
      const next = collectInstallationRecordings(
        inputs.current.archive,
        [...retainedLive.values()],
        kind,
        now,
      );
      const nextSignature = next.events
        .map(
          (event) => `${event.id}:${next.liveEventIds.has(event.id) ? 1 : 0}`,
        )
        .join("|");
      if (nextSignature === signature) return;
      signature = nextSignature;
      setRecordings(next);
    };
    update();
    const interval = window.setInterval(update, 2000);
    return () => window.clearInterval(interval);
  }, [kind, contextKey]);
  return recordings;
}
