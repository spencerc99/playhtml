// ABOUTME: Entry point for the Wikipedia rabbit hole visualization
// ABOUTME: Fetches navigation events from the server, optionally filtered to Wikipedia only or all titled pages.

import "./rabbithole.scss";
import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { RabbitHoleVisualization, WikiTitle } from "./components/RabbitHoleVisualization";

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";

// ── Title extraction ──────────────────────────────────────────────────────────

// Returns null when no meaningful title can be extracted — callers should skip the event.
// In wikipedia-only mode, titles are always extractable via the URL path.
// In all-sites mode, the server pre-filters to events with a captured page title,
// so null returns here should be rare (e.g. non-article Wikipedia paths).
function cleanTitle(rawTitle: string | undefined, url: string): string | null {
  // For Wikipedia URLs, extract the clean article name from the path
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/wiki\/(.+)/);
    if (match) {
      return decodeURIComponent(match[1]).replace(/_/g, " ");
    }
  } catch {
    // ignore malformed URLs
  }
  // For all other URLs, rely on the captured page title from the browser.
  // Strip common trailing " - Site Name" / " | Site Name" branding suffixes.
  if (rawTitle) {
    const cleaned = rawTitle.replace(/\s*[-–|]\s*[^-–|]+$/, "").trim();
    return cleaned || rawTitle.trim();
  }
  return null;
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

export interface DataStats {
  totalFocusEvents: number;
  wikiEvents: number;
  nonWikiEvents: number;
}

export interface ProcessResult {
  titles: WikiTitle[];
  stats: DataStats;
}

function processEvents(events: NavigationEvent[], wikipediaOnly: boolean): ProcessResult {
  const allFocus = events.filter((e) => e.data.event === "focus" && !!e.meta.url);

  const wikiEvents = allFocus.filter(
    (e) =>
      e.meta.url.includes("wikipedia.org") &&
      !e.meta.url.match(/^https?:\/\/(www\.)?wikipedia\.org\/?$/),
  );
  const nonWikiEvents = allFocus.filter((e) => !e.meta.url.includes("wikipedia.org"));

  const stats: DataStats = {
    totalFocusEvents: allFocus.length,
    wikiEvents: wikiEvents.length,
    // In all-sites mode the server already filtered out untitled events, so this
    // count reflects events that actually have a title and will be shown.
    nonWikiEvents: nonWikiEvents.length,
  };

  console.log("[rabbithole] event stats:", stats);

  const focused = wikipediaOnly ? wikiEvents : allFocus;
  focused.sort((a, b) => a.ts - b.ts);

  const titles: WikiTitle[] = [];
  let prevTitle = "";

  for (const ev of focused) {
    const url = ev.data.canonical_url ?? ev.data.url ?? ev.meta.url;
    const title = cleanTitle(ev.data.title, url);
    if (!title || title === "Main Page" || title.startsWith("Talk:")) continue;
    // Deduplicate consecutive identical titles
    if (title === prevTitle) continue;
    titles.push({ title, ts: ev.ts, url });
    prevTitle = title;
  }

  return { titles, stats };
}

// ── Build API URL for the given filter mode ───────────────────────────────────

function buildApiUrl(wikipediaOnly: boolean): string {
  const params = new URLSearchParams({ type: "navigation", limit: "5000" });
  if (wikipediaOnly) {
    // Filter server-side by the indexed domain column — much faster than pulling
    // all events and filtering client-side. Wikipedia articles live on en.wikipedia.org.
    params.set("domain", "en.wikipedia.org");
  } else {
    // When showing all domains, skip events with no page title in page_metadata_history.
    params.set("require_title", "true");
  }
  return `${API_URL}?${params}`;
}

// ── Root component ─────────────────────────────────────────────────────────────

const RabbitHole = () => {
  const [titles, setTitles] = useState<WikiTitle[]>([]);
  const [dataStats, setDataStats] = useState<DataStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wikipediaOnly, setWikipediaOnly] = useState(true);

  // fetchEvents closes over the current wikipediaOnly so the correct server
  // filter is applied. Changing the toggle re-creates this callback which
  // triggers a fresh network request via the useEffect below.
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(buildApiUrl(wikipediaOnly));
      if (!response.ok)
        throw new Error(`Failed to fetch navigation events: ${response.status}`);
      const data: NavigationEvent[] = await response.json();
      const result = processEvents(data, wikipediaOnly);
      setTitles(result.titles);
      setDataStats(result.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  }, [wikipediaOnly]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <RabbitHoleVisualization
      titles={titles}
      dataStats={dataStats}
      loading={loading}
      error={error}
      wikipediaOnly={wikipediaOnly}
      onToggleWikipediaOnly={() => setWikipediaOnly((v) => !v)}
      onRefresh={fetchEvents}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<RabbitHole />);
