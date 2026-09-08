// ABOUTME: Renders continuous cursor activity or finite visualization chapters for the WWO installation.
// ABOUTME: Layers archived cursor footage under the live field only while current activity is quiet.

import "../../shared/portrait-styles.scss";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { MovementCanvas } from "../../shared/components/MovementCanvas";
import { LiveIndicator } from "../../shared/components/LiveIndicator";
import type { CollectionEvent } from "../../shared/types";
import { latestDrawableCursorEventId } from "../../shared/utils/cursorInstallation";
import {
  parseDayFromUrl,
  parseTimeOfDayFromUrl,
  parseVizFromUrl,
} from "../../shared/config";
import { useHybridInstallationEvents } from "../../shared/hooks/useHybridInstallationEvents";
import { useDailyPageReload } from "../../shared/hooks/useDailyPageReload";
import { useInstallationReload } from "../../shared/hooks/useInstallationReload";
import { summarizeActiveLocations } from "../../shared/utils/eventUtils";
import {
  LIVE_INSTALLATION_VISUALIZATIONS,
  eventsForInstallationScreen,
  parseLiveInstallationScreen,
  resolveLiveInstallationVisualizations,
  showsInstallationPeopleCount,
} from "../../shared/utils/liveInstallation";
import { resolveLiveInstallationProfile } from "../../shared/utils/liveInstallationProfiles";

const LIVE_INSTALLATION_SETTINGS_DEFAULTS = {
  randomizeColors: false,
  scrollSpeed: 1,
  backgroundOpacity: 0.8,
  maxConcurrentScrolls: 30,
  windowScale: 0.5,
  showPagePreview: false,
  showTitleBar: true,
  allowOverlap: true,
  windowBleed: 0.45,
  showScrollEvents: true,
  showResizeEvents: true,
  showZoomEvents: true,
};

const CURSOR_ARCHIVE_IDLE_MS = 20_000;
const CURSOR_ARCHIVE_FADE_MS = 3_000;

function useCursorArchiveFallback(
  liveEvents: readonly CollectionEvent[],
  enabled: boolean,
): { mounted: boolean; visible: boolean } {
  const latestId = useMemo(
    () => (enabled ? latestDrawableCursorEventId(liveEvents) : null),
    [enabled, liveEvents],
  );
  const previousLatestIdRef = useRef<string | null>(null);
  const lastCursorArrivalRef = useRef<number | null>(null);
  const [idle, setIdle] = useState(enabled);
  const [mounted, setMounted] = useState(enabled);
  const [visible, setVisible] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      previousLatestIdRef.current = null;
      lastCursorArrivalRef.current = null;
      setIdle(false);
      return;
    }
    if (latestId === null || latestId === previousLatestIdRef.current) return;
    previousLatestIdRef.current = latestId;
    lastCursorArrivalRef.current = Date.now();
    setIdle(false);
  }, [enabled, latestId]);

  useEffect(() => {
    if (!enabled) return;
    const updateVisibility = () => {
      const lastArrival = lastCursorArrivalRef.current;
      setIdle(
        lastArrival === null ||
          Date.now() - lastArrival >= CURSOR_ARCHIVE_IDLE_MS,
      );
    };
    const interval = window.setInterval(updateVisibility, 1_000);
    return () => window.clearInterval(interval);
  }, [enabled]);

  useEffect(() => {
    if (idle) {
      setMounted(true);
      let secondFrame: number | undefined;
      const firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        if (secondFrame !== undefined) {
          window.cancelAnimationFrame(secondFrame);
        }
      };
    }

    setVisible(false);
    const timeout = window.setTimeout(
      () => setMounted(false),
      CURSOR_ARCHIVE_FADE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [idle]);

  return { mounted, visible };
}

const LiveInstallation = () => {
  const profile = useMemo(() => resolveLiveInstallationProfile(), []);
  useDailyPageReload();
  useInstallationReload({ enabled: profile !== null });
  const screen = useMemo(
    () =>
      parseLiveInstallationScreen(
        window.location.search,
        profile?.screen ?? {
          view: "field",
          slot: 0,
          slots: 4,
        },
      ),
    [profile],
  );
  const settingsDefaults = useMemo(
    () => ({
      ...LIVE_INSTALLATION_SETTINGS_DEFAULTS,
      ...(profile?.settings ?? {}),
    }),
    [profile],
  );
  const selectedDay = parseDayFromUrl() ?? null;
  const timeOfDay = parseTimeOfDayFromUrl() ?? null;
  const [activeVisualizations, setActiveVisualizations] = useState<string[]>(
    () =>
      resolveLiveInstallationVisualizations(
        parseVizFromUrl() ?? profile?.visualizations,
      ),
  );
  const hybrid = useHybridInstallationEvents({
    selectedDay,
    timeOfDay,
    serverDomain: "",
    activeVisualizations,
    screen,
  });
  const liveScreenEvents = useMemo(
    () => eventsForInstallationScreen(hybrid.liveEvents, screen),
    [hybrid.liveEvents, screen],
  );
  const activity = useMemo(
    () => summarizeActiveLocations(hybrid.liveEvents),
    [hybrid.liveEvents],
  );
  const continuousLiveTrails = profile?.continuousLiveTrails === true;
  const archiveFallback = useCursorArchiveFallback(
    liveScreenEvents,
    continuousLiveTrails,
  );
  const archiveFallbackEvents = useMemo(() => {
    const liveIds = new Set(hybrid.liveEvents.map((event) => event.id));
    return hybrid.archiveEvents.filter((event) => !liveIds.has(event.id));
  }, [hybrid.archiveEvents, hybrid.liveEvents]);
  const previousFallbackMountedRef = useRef(archiveFallback.mounted);

  useEffect(() => {
    const wasMounted = previousFallbackMountedRef.current;
    previousFallbackMountedRef.current = archiveFallback.mounted;
    if (!continuousLiveTrails || !wasMounted || archiveFallback.mounted) return;

    let timeout: number | undefined;
    const advance = () => {
      if (!hybrid.advanceArchive()) {
        timeout = window.setTimeout(advance, 500);
      }
    };
    advance();
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [archiveFallback.mounted, continuousLiveTrails, hybrid.advanceArchive]);

  useEffect(() => {
    document.body.dataset.installationView = screen.view;
    document.body.dataset.installationSlot = String(screen.slot);
    document.body.dataset.installationSource = continuousLiveTrails
      ? archiveFallback.visible
        ? "archive-fallback"
        : "live"
      : hybrid.source;
    document.body.dataset.installationPlaybackKey = continuousLiveTrails
      ? "continuous-live"
      : hybrid.playbackKey;
  }, [
    archiveFallback.visible,
    continuousLiveTrails,
    hybrid.playbackKey,
    hybrid.source,
    screen.slot,
    screen.view,
  ]);

  return (
    <>
      <MovementCanvas
        events={continuousLiveTrails ? liveScreenEvents : hybrid.events}
        loading={hybrid.loading}
        error={hybrid.error}
        fetchEvents={hybrid.refresh}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={setActiveVisualizations}
        availableVisualizations={LIVE_INSTALLATION_VISUALIZATIONS}
        defaultSoundEnabled={profile?.defaultSoundEnabled}
        defaultSettings={settingsDefaults}
        useStoredSettings={profile === null}
        syncSettingsToUrl={profile === null}
        defaultCinematic={profile?.cinematic}
        installationRole={profile?.role}
        installationFollowerId={profile?.followerId}
        minimumCleanLevel={2}
        live={continuousLiveTrails}
        connected={hybrid.connected}
        playbackKey={
          continuousLiveTrails ? "continuous-live" : hybrid.playbackKey
        }
        playbackSource={continuousLiveTrails ? "live" : hybrid.source}
        installationRecordings={hybrid.continuousRecordings}
        playbackContextKey={
          continuousLiveTrails ? "continuous-live" : hybrid.playbackContextKey
        }
        onPlaybackCycleComplete={
          continuousLiveTrails ? undefined : hybrid.finishChapter
        }
        archiveFallback={
          continuousLiveTrails && archiveFallback.mounted
            ? {
                events: archiveFallbackEvents,
                visible: archiveFallback.visible,
                playbackKey: hybrid.archivePlaybackKey,
                fadeMs: CURSOR_ARCHIVE_FADE_MS,
                onPlaybackCycleComplete: hybrid.advanceArchive,
              }
            : undefined
        }
      />
      {showsInstallationPeopleCount(screen, activeVisualizations) && (
        <LiveIndicator
          connected={hybrid.connected}
          peopleCount={activity.people}
          style={{ position: "absolute", bottom: 20, left: 20, zIndex: 100 }}
        />
      )}
    </>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<LiveInstallation />);
