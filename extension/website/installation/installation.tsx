// ABOUTME: Multi-screen installation view — one master window drives the animation
// ABOUTME: clock; follower windows render zoomed (?cinematic=follow&follow=N) in sync.
import "../shared/portrait-styles.scss";
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { MovementCanvas } from "../shared/components/MovementCanvas";
import {
  DEFAULT_ACTIVE_VISUALIZATIONS,
} from "../shared/components/registry";
import {
  parseVizFromUrl,
  parseDayFromUrl,
  parseTimeOfDayFromUrl,
} from "../shared/config";
import { useArchiveEvents } from "../shared/hooks/useArchiveEvents";
import { useInstallationClock } from "../shared/hooks/useInstallationClock";

/** A single installation screen. Every screen loads this page with the SAME
 * archive params (day/tod/viz/settings) so they render identical trail data;
 * they differ only by `?role=` (master drives the clock, followers render it)
 * and, on follower zoom screens, `?cinematic=follow&follow=N` to lock onto a
 * specific cursor. Fetch + viz components are shared with the archive page — no
 * forked logic. */
const Installation = () => {
  // URL is the single source of truth for an installation screen — no in-page
  // controls, so these never change after mount.
  const selectedDay = parseDayFromUrl() ?? null;
  const timeOfDay = parseTimeOfDayFromUrl() ?? null;
  const [activeVisualizations] = useState<string[]>(
    () => parseVizFromUrl() ?? DEFAULT_ACTIVE_VISUALIZATIONS,
  );

  const { events, loading, error, refresh } = useArchiveEvents({
    selectedDay,
    timeOfDay,
    serverDomain: "",
    activeVisualizations,
  });

  const { getOverrideElapsedMs, broadcastElapsed } = useInstallationClock();

  return (
    <MovementCanvas
      events={events}
      loading={loading}
      error={error}
      fetchEvents={refresh}
      activeVisualizations={activeVisualizations}
      onSetActiveVisualizations={() => {}}
      getOverrideElapsedMs={getOverrideElapsedMs}
      onBroadcastElapsed={broadcastElapsed}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<Installation />);
