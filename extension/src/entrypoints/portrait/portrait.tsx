// ABOUTME: Portrait page entrypoint — full movement visualization using local IndexedDB data
// ABOUTME: Loads all locally-collected events and passes them to MovementCanvas for rendering

import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import "../../styles/options.scss";
import "../../../../website/internet-series/movement/movement.scss";
import { LocalEventStore } from "../../storage/LocalEventStore";
import type { CollectionEvent } from "../../../../website/internet-series/movement/types";
import { MovementCanvas } from "../../../../website/internet-series/movement/components/MovementCanvas";

const store = new LocalEventStore();

const PortraitPage = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allEvents = await store.getAllEvents();
      setEvents(allEvents as unknown as CollectionEvent[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load local events");
      console.error("Error loading local events:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        background: "var(--bg)",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "'Source Serif 4', 'Lora', Georgia, serif",
            fontStyle: "italic",
            fontWeight: 200,
            fontSize: "20px",
            color: "var(--text)",
          }}
        >
          we were online
        </span>
        <button
          onClick={() => window.close()}
          style={{
            pointerEvents: "auto",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            padding: "4px 8px",
            borderRadius: "4px",
          }}
        >
          close
        </button>
      </div>

      <MovementCanvas
        events={events}
        loading={loading}
        error={error}
        fetchEvents={loadEvents}
      />
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<PortraitPage />);
}
