// ABOUTME: Entry point for the Internet Movement visualization page
// ABOUTME: Fetches events from the server API and passes them to MovementCanvas for rendering
import "./movement.scss";
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent, DayCounts } from "./types";
import { MovementCanvas } from "./components/MovementCanvas";

const API_BASE =
  "https://playhtml-game-api.spencerc99.workers.dev";
const EVENTS_URL = `${API_BASE}/events/recent`;
const DAILY_COUNTS_URL = `${API_BASE}/events/daily-counts`;

const InternetMovement = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCounts>(new Map());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Fetch daily counts for the heatmap calendar
  useEffect(() => {
    fetch(DAILY_COUNTS_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch daily counts: ${r.status}`);
        return r.json();
      })
      .then((rows: { day: string; count: number }[]) => {
        const map = new Map<string, number>();
        for (const row of rows) {
          map.set(row.day, row.count);
        }
        setDayCounts(map);
      })
      .catch((err) => {
        console.error("Error fetching daily counts:", err);
      });
  }, []);

  const fetchEvents = async (day?: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ limit: "5000" });
      if (day) {
        params.set("from", day);
        params.set("to", `${day}T23:59:59Z`);
      }

      const promises: Promise<CollectionEvent[]>[] = [
        fetch(`${EVENTS_URL}?${params}&type=cursor`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch cursor events: ${r.status}`);
          return r.json();
        }),
        fetch(`${EVENTS_URL}?${params}&type=keyboard`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch keyboard events: ${r.status}`);
          return r.json();
        }),
        fetch(`${EVENTS_URL}?${params}&type=viewport`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch viewport events: ${r.status}`);
          return r.json();
        }),
        fetch(`${EVENTS_URL}?${params}&type=navigation`).then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch navigation events: ${r.status}`);
          return r.json();
        }),
      ];

      const results = await Promise.all(promises);
      setEvents(results.flat());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch events when selectedDay changes
  useEffect(() => {
    fetchEvents(selectedDay);
  }, [selectedDay]);

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
        loading={loading}
        error={error}
        fetchEvents={() => fetchEvents(selectedDay)}
        dayCounts={dayCounts}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
      />
    </>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetMovement />);
