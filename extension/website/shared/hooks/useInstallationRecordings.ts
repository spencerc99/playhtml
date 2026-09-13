// ABOUTME: Keeps scrolling and typing recordings available for continuous playback.
// ABOUTME: Admits live footage while it is still being recorded and retires it once it goes quiet.
import { useEffect, useRef, useState } from "react";
import type { CollectionEvent } from "../types";
import { groupScrollEvents } from "../utils/scrollEventGroups";
import { groupTypingEvents } from "../utils/typingEventGroups";

/**
 * How long a purely-live recording stays in the reservoir after its last event.
 * A recording is admitted the moment it has any footage and keeps growing while
 * the person is still scrolling or typing; this window is only how long it
 * lingers once they stop, before the archive takes over as its source.
 */
export const LIVE_RECORDING_RETENTION_MS = 60_000;

/**
 * Memory bound on retained live events. Many times the retention window, so a
 * recording that is still being written is never truncated from the front while
 * it is on screen.
 */
const RETAINED_LIVE_MAX_AGE_MS = LIVE_RECORDING_RETENTION_MS * 10;
const RETAINED_LIVE_MAX_EVENTS = 10_000;

/** How often retention and growth are re-evaluated. */
const RESERVOIR_TICK_MS = 1000;

export interface InstallationRecordings {
  events: CollectionEvent[];
  liveEventIds: ReadonlySet<string>;
  /**
   * Changes whenever a recording is added, grows, or is retired. Cheap to
   * compare (one entry per recording, not per event) so the reservoir can tick
   * often without rebuilding React state on every pass.
   */
  signature: string;
  /**
   * Whether any recording here is still live-only, and so will retire once it
   * has been quiet long enough. The reservoir keeps re-evaluating while this is
   * true, because retirement is driven by the clock rather than by arrivals.
   */
  hasRetirableRecordings: boolean;
}

export function collectInstallationRecordings(
  archive: readonly CollectionEvent[],
  live: readonly CollectionEvent[],
  kind: "scrolling" | "typing",
  now: number,
): InstallationRecordings {
  const liveIds = new Set(live.map((event) => event.id));
  const archiveIds = new Set(archive.map((event) => event.id));
  const events = new Map(archive.map((event) => [event.id, event]));
  for (const event of live) events.set(event.id, event);
  const group = kind === "scrolling" ? groupScrollEvents : groupTypingEvents;
  // A recording plays as soon as it has footage, however partial. It is only
  // retired once no event in it came from the archive (so the archive is not
  // yet a source for it) AND nothing new has arrived for the retention window —
  // at which point the person has moved on and it stops reading as now.
  const kept = group([...events.values()]).flatMap((recording) => {
    const archiveBacked = recording.events.some((event) =>
      archiveIds.has(event.id),
    );
    if (archiveBacked) return [{ recording, retirable: false }];
    if (recording.endTs < now - LIVE_RECORDING_RETENTION_MS) return [];
    return [{ recording, retirable: true }];
  });
  const groups = kept.map((entry) => entry.recording);
  return {
    events: groups.flatMap((recording) => recording.events),
    liveEventIds: liveIds,
    hasRetirableRecordings: kept.some((entry) => entry.retirable),
    signature: groups
      .map(
        (recording) =>
          `${recording.id}:${recording.events.length}:${recording.endTs}`,
      )
      .join("|"),
  };
}

const EMPTY_RECORDINGS: InstallationRecordings = {
  events: [],
  liveEventIds: new Set(),
  signature: "",
  hasRetirableRecordings: false,
};

export function useInstallationRecordings(
  archive: CollectionEvent[],
  live: CollectionEvent[],
  kind: "scrolling" | "typing" | null,
  contextKey: string,
): InstallationRecordings {
  const inputs = useRef({ archive, live });
  inputs.current = { archive, live };
  const [recordings, setRecordings] =
    useState<InstallationRecordings>(EMPTY_RECORDINGS);
  useEffect(() => {
    setRecordings(EMPTY_RECORDINGS);
    if (!kind) return;
    const retainedLive = new Map<string, CollectionEvent>();
    let signature = "";
    let previousArchive: CollectionEvent[] | undefined;
    // Starts true so the first pass always runs; thereafter it tracks whether
    // a recording is still waiting out its quiet window.
    let retirementPending = true;
    const update = () => {
      let changed = inputs.current.archive !== previousArchive;
      for (const event of inputs.current.live) {
        if (
          (kind === "typing" && event.type === "keyboard") ||
          (kind === "scrolling" && event.type === "viewport")
        ) {
          if (!retainedLive.has(event.id)) {
            retainedLive.set(event.id, event);
            changed = true;
          }
        }
      }
      // Nothing new arrived and nothing is waiting to retire, so no recording
      // can change state on this pass.
      if (!changed && !retirementPending) return;
      const now = Date.now();
      previousArchive = inputs.current.archive;
      // Bound retained live footage independently of the fetched archive. Age
      // first so a burst of traffic never evicts an in-progress recording.
      for (const [id, event] of retainedLive) {
        if (event.ts < now - RETAINED_LIVE_MAX_AGE_MS) retainedLive.delete(id);
      }
      while (retainedLive.size > RETAINED_LIVE_MAX_EVENTS) {
        retainedLive.delete(retainedLive.keys().next().value!);
      }
      const next = collectInstallationRecordings(
        inputs.current.archive,
        [...retainedLive.values()],
        kind,
        now,
      );
      retirementPending = next.hasRetirableRecordings;
      if (next.signature === signature) return;
      signature = next.signature;
      setRecordings(next);
    };
    update();
    const interval = window.setInterval(update, RESERVOIR_TICK_MS);
    return () => window.clearInterval(interval);
  }, [kind, contextKey]);
  return recordings;
}
