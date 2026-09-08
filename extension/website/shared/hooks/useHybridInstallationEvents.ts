// ABOUTME: Supplies installation playback from archive and live browsing events.
// ABOUTME: Keeps scrolling and typing continuous while other views advance through chapters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionEvent } from "../types";
import { useArchiveEvents } from "./useArchiveEvents";
import { useLiveEvents } from "./useLiveEvents";
import { deriveRequiredEventTypes } from "../components/registry";
import {
  eventsForInstallationScreen,
  installationChapterAction,
  liveChapterIsReady,
  type LiveInstallationScreenConfig,
  unconsumedLiveEvents,
} from "../utils/liveInstallation";
import {
  useInstallationRecordings,
  type InstallationRecordings,
} from "./useInstallationRecordings";
import type { parseTimeOfDayFromUrl } from "../config";

type TimeOfDay = ReturnType<typeof parseTimeOfDayFromUrl> | null;
type ChapterSource = "archive" | "live";

export interface HybridInstallationEventsState {
  events: CollectionEvent[];
  archiveEvents: CollectionEvent[];
  liveEvents: CollectionEvent[];
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  playbackKey: string;
  playbackContextKey: string;
  finishChapter: () => boolean;
  advanceArchive: () => boolean;
  archivePlaybackKey: string;
  source: ChapterSource;
  continuousRecordings?: InstallationRecordings;
}

export function useHybridInstallationEvents(params: {
  selectedDay: string | null;
  timeOfDay: TimeOfDay;
  serverDomain: string;
  activeVisualizations: string[];
  screen: LiveInstallationScreenConfig;
}): HybridInstallationEventsState {
  const { selectedDay, timeOfDay, serverDomain, activeVisualizations, screen } =
    params;
  const typingOnly =
    activeVisualizations.length === 1 && activeVisualizations[0] === "typing";
  const scrollingOnly =
    activeVisualizations.length === 1 &&
    activeVisualizations[0] === "scrolling";
  const reservoirOnly = typingOnly || scrollingOnly;
  const archive = useArchiveEvents({
    selectedDay,
    timeOfDay,
    serverDomain,
    activeVisualizations,
    batchPlayback: !reservoirOnly,
  });
  const live = useLiveEvents({ maxEvents: 5000 });
  const [source, setSource] = useState<ChapterSource>("archive");
  const [liveChapter, setLiveChapter] = useState<CollectionEvent[]>([]);
  const [liveSequence, setLiveSequence] = useState(0);
  const sourceRef = useRef<ChapterSource>(source);
  const liveEventsRef = useRef(live.events);
  const activeVisualizationsRef = useRef(activeVisualizations);
  const consumedIdsRef = useRef<Set<string>>(new Set());
  const seededInitialArchiveRef = useRef(false);
  const lastLiveTimestampRef = useRef(-Infinity);
  const typingContextKey = [
    selectedDay ?? "recent",
    `${timeOfDay?.centerMinutes ?? "all"}:${timeOfDay?.radiusMinutes ?? "all"}`,
    serverDomain,
    `${screen.view}:${screen.slot}:${screen.slots}`,
  ].join("|");
  const hybridContextKey = `${typingContextKey}|${activeVisualizations.join(",")}`;

  liveEventsRef.current = live.events;
  activeVisualizationsRef.current = activeVisualizations;

  const screenArchive = useMemo(
    () => eventsForInstallationScreen(archive.events, screen),
    [archive.events, screen],
  );
  const screenLive = useMemo(
    () => eventsForInstallationScreen(live.events, screen),
    [live.events, screen],
  );
  const recordings = useInstallationRecordings(
    screenArchive,
    screenLive,
    scrollingOnly ? "scrolling" : typingOnly ? "typing" : null,
    hybridContextKey,
  );

  useEffect(() => {
    if (reservoirOnly) return;
    sourceRef.current = "archive";
    setSource("archive");
    setLiveChapter([]);
    setLiveSequence(0);
    consumedIdsRef.current = new Set();
    seededInitialArchiveRef.current = false;
    lastLiveTimestampRef.current = -Infinity;
  }, [hybridContextKey, reservoirOnly]);

  useEffect(() => {
    if (reservoirOnly) return;
    if (seededInitialArchiveRef.current || archive.events.length === 0) return;
    for (const event of archive.events) consumedIdsRef.current.add(event.id);
    seededInitialArchiveRef.current = true;
  }, [archive.events, reservoirOnly]);

  const startReadyLiveChapter = useCallback((): boolean => {
    if (liveEventsRef.current.length > 0) {
      consumedIdsRef.current = new Set(
        liveEventsRef.current
          .filter((event) => consumedIdsRef.current.has(event.id))
          .map((event) => event.id),
      );
    }

    const requiredTypes = deriveRequiredEventTypes(
      activeVisualizationsRef.current,
    );
    const screenEvents = eventsForInstallationScreen(
      unconsumedLiveEvents(liveEventsRef.current, consumedIdsRef.current),
      screen,
    ).filter((event) => event.ts > lastLiveTimestampRef.current);
    if (!liveChapterIsReady(screenEvents, activeVisualizationsRef.current)) {
      return false;
    }
    const candidate = screenEvents.filter((event) =>
      requiredTypes.has(event.type),
    );

    for (const event of screenEvents) consumedIdsRef.current.add(event.id);
    lastLiveTimestampRef.current =
      candidate.at(-1)?.ts ?? lastLiveTimestampRef.current;
    setLiveChapter(candidate);
    setLiveSequence((sequence) => sequence + 1);
    sourceRef.current = "live";
    setSource("live");
    return true;
  }, [screen]);

  const finishChapter = useCallback((): boolean => {
    if (reservoirOnly) return false;

    const action = installationChapterAction(
      sourceRef.current,
      startReadyLiveChapter(),
    );
    if (action === "show-live") return true;
    if (action === "wait-live") return false;

    return archive.advanceBatch();
  }, [archive.advanceBatch, startReadyLiveChapter, reservoirOnly]);

  const chapterEvents = source === "live" ? liveChapter : archive.events;
  const hybridEvents = useMemo(
    () => eventsForInstallationScreen(chapterEvents, screen),
    [chapterEvents, screen],
  );
  const events = reservoirOnly ? recordings.events : hybridEvents;

  return {
    events,
    archiveEvents: eventsForInstallationScreen(archive.events, screen),
    liveEvents: live.events,
    connected: live.connected,
    loading: archive.loading,
    error: archive.error,
    refresh: archive.refresh,
    continuousRecordings: reservoirOnly ? recordings : undefined,
    playbackKey: reservoirOnly
      ? hybridContextKey
      : source === "live"
        ? `live:${liveSequence}`
        : `archive:${archive.batchKey}`,
    playbackContextKey: typingOnly
      ? `typing:${typingContextKey}`
      : scrollingOnly
        ? `scrolling:${typingContextKey}`
        : `hybrid:${archive.batchContextKey}`,
    finishChapter,
    advanceArchive: archive.advanceBatch,
    archivePlaybackKey: `archive:${archive.batchKey}`,
    source: reservoirOnly ? "archive" : source,
  };
}
