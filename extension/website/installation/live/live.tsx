// ABOUTME: Renders the dedicated WWO live installation field or deterministic follower view.
// ABOUTME: Uses live-forward chapters for movement and rotating reservoirs for typing and scrolling.

import "../../shared/portrait-styles.scss";
import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { MovementCanvas } from "../../shared/components/MovementCanvas";
import { LiveIndicator } from "../../shared/components/LiveIndicator";
import {
  parseDayFromUrl,
  parseTimeOfDayFromUrl,
  parseVizFromUrl,
} from "../../shared/config";
import { useHybridInstallationEvents } from "../../shared/hooks/useHybridInstallationEvents";
import { useDailyPageReload } from "../../shared/hooks/useDailyPageReload";
import { summarizeActiveLocations } from "../../shared/utils/eventUtils";
import {
  LIVE_INSTALLATION_VISUALIZATIONS,
  parseLiveInstallationScreen,
  resolveLiveInstallationVisualizations,
  showsInstallationPeopleCount,
} from "../../shared/utils/liveInstallation";
import { resolveLiveInstallationProfile } from "../../shared/utils/liveInstallationProfiles";

const LIVE_INSTALLATION_SETTINGS_DEFAULTS = {
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

const LiveInstallation = () => {
  useDailyPageReload();
  const profile = useMemo(() => resolveLiveInstallationProfile(), []);
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
  const activity = useMemo(
    () => summarizeActiveLocations(hybrid.liveEvents),
    [hybrid.liveEvents],
  );

  useEffect(() => {
    document.body.dataset.installationView = screen.view;
    document.body.dataset.installationSlot = String(screen.slot);
    document.body.dataset.installationSource = hybrid.source;
    document.body.dataset.installationPlaybackKey = hybrid.playbackKey;
  }, [hybrid.playbackKey, hybrid.source, screen.slot, screen.view]);

  return (
    <>
      <MovementCanvas
        events={hybrid.events}
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
        playbackKey={hybrid.playbackKey}
        playbackSource={hybrid.source}
        playbackContextKey={hybrid.playbackContextKey}
        onPlaybackCycleComplete={hybrid.finishChapter}
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
