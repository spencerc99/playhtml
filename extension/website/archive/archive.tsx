// ABOUTME: Historical browsing-portrait page (the archive view) at wewere.online/archive
// ABOUTME: Fetches events from /events/recent and passes them to MovementCanvas for rendering
import "../shared/portrait-styles.scss";
import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { MovementCanvas } from "../shared/components/MovementCanvas";
import { DEFAULT_ACTIVE_VISUALIZATIONS } from "../shared/components/registry";
import {
  parseFiltersFromUrl,
  parseVizFromUrl,
  parseDayFromUrl,
  parseTimeOfDayFromUrl,
} from "../shared/config";
import { useArchiveEvents } from "../shared/hooks/useArchiveEvents";
import type { FilterChip } from "../shared/utils/eventUtils";

const InternetMovement = () => {
  const [selectedDay, setSelectedDay] = useState<string | null>(
    () => parseDayFromUrl() ?? null,
  );
  const [timeOfDay, setTimeOfDay] = useState(() => parseTimeOfDayFromUrl() ?? null);
  const [filters, setFilters] = useState<FilterChip[]>(() => {
    // URL wins. Otherwise mirror whatever MovementCanvas will load from
    // localStorage on first render — if portrait disagrees on mount, the
    // bidirectional sync between portrait.filters and
    // MovementCanvas.settings.filters ping-pongs forever (each side
    // re-asserts its initial value from a separate effect on every render).
    const fromUrl = parseFiltersFromUrl();
    if (fromUrl !== undefined) return fromUrl;
    try {
      const stored = localStorage.getItem("internet-movement-settings-v2");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed?.filters)) return parsed.filters;
      }
    } catch { /* ignore */ }
    return [];
  });

  /** Server-side fetch optimization: when the chip list is exactly one
   * chip with a domain set, we can ask the worker to pre-filter by that
   * domain (the existing `?domain=` query param). Any other shape (zero
   * chips, multiple chips, or a chip with only a path) requires a broad
   * fetch so client-side OR-filtering has all the events to work with. */
  const serverDomain =
    filters.length === 1 && filters[0].domain ? filters[0].domain : "";
  const [activeVisualizations, setActiveVisualizations] = useState<string[]>(
    () => {
      // URL param wins over localStorage so capture runs are deterministic.
      const fromUrl = parseVizFromUrl();
      if (fromUrl !== undefined) return fromUrl;
      try {
        const stored = localStorage.getItem("movement_active_viz");
        if (stored) return JSON.parse(stored);
      } catch { /* ignore */ }
      return DEFAULT_ACTIVE_VISUALIZATIONS;
    },
  );

  // Persist visualization selection. Skip the persist when a URL override is
  // present so capture runs don't poison the user's saved preference.
  const vizUrlOverrideRef = useRef(parseVizFromUrl() !== undefined);
  useEffect(() => {
    if (vizUrlOverrideRef.current) return;
    localStorage.setItem("movement_active_viz", JSON.stringify(activeVisualizations));
  }, [activeVisualizations]);

  const { events, loading, error, dayCounts, refresh } = useArchiveEvents({
    selectedDay,
    timeOfDay,
    serverDomain,
    activeVisualizations,
  });

  return (
    <>
      <span
        className="wordmark-signature"
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          zIndex: 200,
          fontFamily: "'Source Serif 4', 'Lora', Georgia, serif",
          fontStyle: "italic",
          fontWeight: 200,
          fontSize: "20px",
          color: "#3d3833",
          pointerEvents: "none",
        }}
      >
        we were online
      </span>
      <MovementCanvas
        events={events}
        loading={loading}
        error={error}
        fetchEvents={refresh}
        dayCounts={dayCounts}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        timeOfDay={timeOfDay}
        onSetTimeOfDay={setTimeOfDay}
        filters={filters}
        onSetFilters={setFilters}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={setActiveVisualizations}
      />
    </>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetMovement />);
