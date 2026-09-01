// ABOUTME: Alternates archive playback with sufficiently dense chapters accumulated from the live stream.
// ABOUTME: Advances archive history before each live chapter so playback resumes farther back in time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionEvent } from "../types";
import { useArchiveEvents } from "./useArchiveEvents";
import { useLiveEvents } from "./useLiveEvents";
import {
  eventsForInstallationScreen,
  liveChapterIsReady,
  type LiveInstallationScreenConfig,
  unconsumedLiveEvents,
} from "../utils/liveInstallation";
import type { parseTimeOfDayFromUrl } from "../config";

type TimeOfDay = ReturnType<typeof parseTimeOfDayFromUrl> | null;
type ChapterSource = "archive" | "live";

export interface HybridInstallationEventsState {
  events: CollectionEvent[];
  liveEvents: CollectionEvent[];
  connected: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  playbackKey: string;
  playbackContextKey: string;
  finishChapter: () => boolean;
  source: ChapterSource;
}

export function useHybridInstallationEvents(params: {
  selectedDay: string | null;
  timeOfDay: TimeOfDay;
  serverDomain: string;
  activeVisualizations: string[];
  screen: LiveInstallationScreenConfig;
}): HybridInstallationEventsState {
  const {
    selectedDay,
    timeOfDay,
    serverDomain,
    activeVisualizations,
    screen,
  } = params;
  const archive = useArchiveEvents({
    selectedDay,
    timeOfDay,
    serverDomain,
    activeVisualizations,
    batchPlayback: true,
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

  liveEventsRef.current = live.events;
  activeVisualizationsRef.current = activeVisualizations;

  useEffect(() => {
    if (seededInitialArchiveRef.current || archive.events.length === 0) return;
    for (const event of archive.events) consumedIdsRef.current.add(event.id);
    seededInitialArchiveRef.current = true;
  }, [archive.events]);

  const finishChapter = useCallback((): boolean => {
    if (sourceRef.current === "live") {
      sourceRef.current = "archive";
      setSource("archive");
      return true;
    }

    if (liveEventsRef.current.length > 0) {
      consumedIdsRef.current = new Set(
        liveEventsRef.current
          .filter((event) => consumedIdsRef.current.has(event.id))
          .map((event) => event.id),
      );
    }

    const candidate = eventsForInstallationScreen(
      unconsumedLiveEvents(liveEventsRef.current, consumedIdsRef.current),
      screen,
    );
    if (
      liveChapterIsReady(candidate, activeVisualizationsRef.current) &&
      archive.advanceBatch()
    ) {
      for (const event of candidate) consumedIdsRef.current.add(event.id);
      setLiveChapter(candidate);
      setLiveSequence((sequence) => sequence + 1);
      sourceRef.current = "live";
      setSource("live");
      return true;
    }

    return archive.advanceBatch();
  }, [archive.advanceBatch, screen]);

  const chapterEvents = source === "live" ? liveChapter : archive.events;
  const events = useMemo(
    () => eventsForInstallationScreen(chapterEvents, screen),
    [chapterEvents, screen],
  );

  return {
    events,
    liveEvents: live.events,
    connected: live.connected,
    loading: archive.loading,
    error: archive.error,
    refresh: archive.refresh,
    playbackKey:
      source === "live" ? `live:${liveSequence}` : `archive:${archive.batchKey}`,
    playbackContextKey: `hybrid:${archive.batchContextKey}`,
    finishChapter,
    source,
  };
}
