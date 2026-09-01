// ABOUTME: Supplies finite installation chapters from archive and live browsing events.
// ABOUTME: Rotates typing and scrolling reservoirs while other views move toward live playback.

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
  addTypingReservoirEvents,
  createTypingReservoir,
  takeTypingReservoirChapter,
} from "../utils/typingInstallationReservoir";
import {
  addScrollReservoirEvents,
  createScrollReservoir,
  takeScrollReservoirChapter,
} from "../utils/scrollInstallationReservoir";
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
  const [typingChapter, setTypingChapter] = useState<CollectionEvent[]>([]);
  const [typingSequence, setTypingSequence] = useState(0);
  const [typingRotation, setTypingRotation] = useState(0);
  const [scrollChapter, setScrollChapter] = useState<CollectionEvent[]>([]);
  const [scrollSequence, setScrollSequence] = useState(0);
  const [scrollRotation, setScrollRotation] = useState(0);
  const sourceRef = useRef<ChapterSource>(source);
  const liveEventsRef = useRef(live.events);
  const activeVisualizationsRef = useRef(activeVisualizations);
  const consumedIdsRef = useRef<Set<string>>(new Set());
  const seededInitialArchiveRef = useRef(false);
  const lastLiveTimestampRef = useRef(-Infinity);
  const typingChapterRef = useRef<CollectionEvent[]>([]);
  const typingReservoirRef = useRef(createTypingReservoir());
  const scrollChapterRef = useRef<CollectionEvent[]>([]);
  const scrollReservoirRef = useRef(createScrollReservoir());
  const typingContextKey = [
    selectedDay ?? "recent",
    `${timeOfDay?.centerMinutes ?? "all"}:${timeOfDay?.radiusMinutes ?? "all"}`,
    serverDomain,
    `${screen.view}:${screen.slot}:${screen.slots}`,
  ].join("|");
  const hybridContextKey = `${typingContextKey}|${activeVisualizations.join(",")}`;

  liveEventsRef.current = live.events;
  activeVisualizationsRef.current = activeVisualizations;

  useEffect(() => {
    typingReservoirRef.current = createTypingReservoir();
    typingChapterRef.current = [];
    setTypingChapter([]);
    setTypingSequence(0);
    setTypingRotation(0);
  }, [typingContextKey, typingOnly]);

  useEffect(() => {
    scrollReservoirRef.current = createScrollReservoir();
    scrollChapterRef.current = [];
    setScrollChapter([]);
    setScrollSequence(0);
    setScrollRotation(0);
  }, [typingContextKey, scrollingOnly]);

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

  const takeNextTypingChapter = useCallback((): boolean => {
    let reservoir = addTypingReservoirEvents(
      typingReservoirRef.current,
      eventsForInstallationScreen(archive.events, screen),
      "archive",
      Date.now(),
    );
    reservoir = addTypingReservoirEvents(
      reservoir,
      eventsForInstallationScreen(liveEventsRef.current, screen),
      "live",
      Date.now(),
    );
    const next = takeTypingReservoirChapter(reservoir);
    typingReservoirRef.current = next.state;
    if (next.events.length === 0) return false;

    typingChapterRef.current = next.events;
    setTypingChapter(next.events);
    setTypingRotation(next.rotation);
    setTypingSequence((sequence) => sequence + 1);
      sourceRef.current = "archive";
      setSource("archive");
      return true;
  }, [archive.events, screen]);

  useEffect(() => {
    if (!typingOnly || typingChapterRef.current.length > 0) return;
    takeNextTypingChapter();
  }, [archive.events, live.events, takeNextTypingChapter, typingOnly]);

  const takeNextScrollChapter = useCallback((): boolean => {
    let reservoir = addScrollReservoirEvents(
      scrollReservoirRef.current,
      eventsForInstallationScreen(archive.events, screen),
      "archive",
      Date.now(),
    );
    reservoir = addScrollReservoirEvents(
      reservoir,
      eventsForInstallationScreen(liveEventsRef.current, screen),
      "live",
      Date.now(),
    );
    const next = takeScrollReservoirChapter(reservoir);
    scrollReservoirRef.current = next.state;
    if (next.events.length === 0) return false;

    scrollChapterRef.current = next.events;
    setScrollChapter(next.events);
    setScrollRotation(next.rotation);
    setScrollSequence((sequence) => sequence + 1);
    sourceRef.current = "archive";
    setSource("archive");
    return true;
  }, [archive.events, screen]);

  useEffect(() => {
    if (!scrollingOnly || scrollChapterRef.current.length > 0) return;
    takeNextScrollChapter();
    const retry = window.setInterval(takeNextScrollChapter, 1000);
    return () => window.clearInterval(retry);
  }, [archive.events, live.events, scrollingOnly, takeNextScrollChapter]);

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
    if (typingOnly) return takeNextTypingChapter();
    if (scrollingOnly) return takeNextScrollChapter();

    const action = installationChapterAction(
      sourceRef.current,
      startReadyLiveChapter(),
    );
    if (action === "show-live") return true;
    if (action === "wait-live") return false;

    return archive.advanceBatch();
  }, [
    archive.advanceBatch,
    startReadyLiveChapter,
    takeNextScrollChapter,
    takeNextTypingChapter,
    scrollingOnly,
    typingOnly,
  ]);

  const chapterEvents = source === "live" ? liveChapter : archive.events;
  const hybridEvents = useMemo(
    () => eventsForInstallationScreen(chapterEvents, screen),
    [chapterEvents, screen],
  );
  const events = typingOnly
    ? typingChapter
    : scrollingOnly
      ? scrollChapter
      : hybridEvents;

  return {
    events,
    liveEvents: live.events,
    connected: live.connected,
    loading: archive.loading,
    error: archive.error,
    refresh: archive.refresh,
    playbackKey: typingOnly
      ? `typing:${typingRotation}:${typingSequence}`
      : scrollingOnly
        ? `scrolling:${scrollRotation}:${scrollSequence}`
        : source === "live"
          ? `live:${liveSequence}`
          : `archive:${archive.batchKey}`,
    playbackContextKey: typingOnly
      ? `typing:${typingContextKey}`
      : scrollingOnly
        ? `scrolling:${typingContextKey}`
        : `hybrid:${archive.batchContextKey}`,
    finishChapter,
    source: reservoirOnly ? "archive" : source,
  };
}
