// ABOUTME: Live portrait page at wewere.online/portrait — streams cursor activity over a WebSocket
// ABOUTME: Feeds live events into MovementCanvas; no history/calendar surface.

import "../shared/portrait-styles.scss";
import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { MovementCanvas } from "../shared/components/MovementCanvas";
import { DEFAULT_ACTIVE_VISUALIZATIONS } from "../shared/components/registry";
import { parseFiltersFromUrl, parseVizFromUrl } from "../shared/config";
import { useLiveEvents } from "../shared/hooks/useLiveEvents";
import type { FilterChip } from "../shared/utils/eventUtils";

// The live page has no pull-to-refresh; MovementCanvas requires the callback.
// Module-scoped so its reference stays stable across the frequent re-renders
// the live stream triggers (otherwise MovementCanvas reattaches listeners each frame).
const noOpFetch = () => {};

const LivePortrait = () => {
  const { events, connected } = useLiveEvents({ maxEvents: 500 });

  const [filters, setFilters] = useState<FilterChip[]>(() => {
    const fromUrl = parseFiltersFromUrl();
    if (fromUrl !== undefined) return fromUrl;
    try {
      const stored = localStorage.getItem("internet-movement-settings-v2");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed?.filters)) return parsed.filters;
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  const [activeVisualizations, setActiveVisualizations] = useState<string[]>(
    () => {
      const fromUrl = parseVizFromUrl();
      if (fromUrl !== undefined) return fromUrl;
      try {
        const stored = localStorage.getItem("movement_active_viz");
        if (stored) return JSON.parse(stored);
      } catch {
        /* ignore */
      }
      return DEFAULT_ACTIVE_VISUALIZATIONS;
    },
  );

  const vizUrlOverrideRef = useRef(parseVizFromUrl() !== undefined);
  useEffect(() => {
    if (vizUrlOverrideRef.current) return;
    localStorage.setItem(
      "movement_active_viz",
      JSON.stringify(activeVisualizations),
    );
  }, [activeVisualizations]);

  return (
    <>
      <span
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
        loading={false}
        error={null}
        fetchEvents={noOpFetch}
        filters={filters}
        onSetFilters={setFilters}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={setActiveVisualizations}
        live
        connected={connected}
      />
    </>
  );
};

// Saved historical share-links used to live at /portrait. If a request carries
// historical-only params, send it to the archive page which knows how to read them.
(() => {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const hasHistorical =
    params.has("startMs") || params.has("endMs") || params.has("day");
  if (hasHistorical) {
    window.location.replace(`/archive/${window.location.search}`);
  }
})();

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<LivePortrait />);
