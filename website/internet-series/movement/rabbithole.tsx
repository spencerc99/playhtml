// ABOUTME: Entry point for the Wikipedia rabbit hole visualization
// ABOUTME: Fetches navigation events, filters to Wikipedia focus visits, passes titles to RabbitHoleVisualization

import "./rabbithole.scss";
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { RabbitHoleVisualization, WikiTitle } from "./components/RabbitHoleVisualization";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";

// ── Title extraction ──────────────────────────────────────────────────────────

function cleanTitle(rawTitle: string | undefined, url: string): string {
  // Prefer URL parsing — most historical events predate title capture
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/wiki\/(.+)/);
    if (match) {
      return decodeURIComponent(match[1]).replace(/_/g, " ");
    }
  } catch {
    // ignore malformed URLs
  }
  // Fall back to data.title if URL parsing didn't yield a result
  if (rawTitle) {
    return rawTitle.replace(/\s*[-–]\s*Wikipedia\s*$/, "").trim();
  }
  return url;
}

// ── Event shape for navigation data ──────────────────────────────────────────

interface NavigationEventData {
  event: "focus" | "blur" | "beforeunload" | "popstate";
  title?: string;
  canonical_url?: string;
  url?: string;
}

interface NavigationEvent {
  id: string;
  type: string;
  ts: number;
  data: NavigationEventData;
  meta: {
    pid: string;
    sid: string;
    url: string;
    vw?: number;
    vh?: number;
    tz?: string;
  };
}

// ── Data processing ───────────────────────────────────────────────────────────

function processEvents(events: NavigationEvent[]): WikiTitle[] {
  const focused = events.filter(
    (e) =>
      e.data.event === "focus" &&
      e.meta.url &&
      e.meta.url.includes("wikipedia.org") &&
      // exclude the Wikipedia homepage
      !e.meta.url.match(/^https?:\/\/(www\.)?wikipedia\.org\/?$/),
  );

  // Sort chronologically
  focused.sort((a, b) => a.ts - b.ts);

  const titles: WikiTitle[] = [];
  let prevTitle = "";

  for (const ev of focused) {
    const url = ev.data.canonical_url ?? ev.data.url ?? ev.meta.url;
    const title = cleanTitle(ev.data.title, url);
    if (!title || title === "Main Page" || title.startsWith("Talk:")) continue;
    // Deduplicate consecutive identical titles
    if (title === prevTitle) continue;
    titles.push({ title, ts: ev.ts });
    prevTitle = title;
  }

  return titles;
}

// ── Root component ─────────────────────────────────────────────────────────────

const RabbitHole = () => {
  const [titles, setTitles] = useState<WikiTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}?type=navigation&limit=5000`,
      );
      if (!response.ok)
        throw new Error(`Failed to fetch navigation events: ${response.status}`);
      const data: NavigationEvent[] = await response.json();
      setTitles(processEvents(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  return (
    <RabbitHoleVisualization
      titles={titles}
      loading={loading}
      error={error}
      onRefresh={fetchEvents}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<RabbitHole />);
