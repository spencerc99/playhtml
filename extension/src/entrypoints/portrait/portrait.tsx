// ABOUTME: Portrait page entrypoint — full movement visualization using local IndexedDB data
// ABOUTME: Loads all locally-collected events and passes them to MovementCanvas for rendering

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PortraitCard } from "../../components/PortraitCard";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import "../../styles/options.scss";
import "../../../../website/internet-series/movement/movement.scss";
import type { CollectionEvent, DayCounts } from "../../../../website/internet-series/movement/types";
import { MovementCanvas } from "../../../../website/internet-series/movement/components/MovementCanvas";
import { useCursorTrails } from "../../../../website/internet-series/movement/hooks/useCursorTrails";
import { DEFAULT_ACTIVE_VISUALIZATIONS } from "../../../../website/internet-series/movement/components/registry";
import { DomainPortraitExport } from "../../components/DomainPortraitExport";
import { captureDomPortrait, domainPortraitFilename } from "../../utils/portraitExport";
import type { PortraitCardProps } from "../../components/PortraitCard";
import type { ScreenTimeSession } from "../../storage/LocalEventStore";

/** Convert sessions to hour buckets (total ms per hour-of-day) for PortraitCard */
function sessionsToHourBuckets(sessions: ScreenTimeSession[]): number[] {
  const buckets = new Array(24).fill(0);
  for (const s of sessions) {
    const hour = new Date(s.focusTs).getHours();
    buckets[hour] += s.durationMs;
  }
  return buckets;
}

const PortraitPage = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCounts>(new Map());
  const [activeVisualizations, setActiveVisualizations] = useState<string[]>(DEFAULT_ACTIVE_VISUALIZATIONS);
  const exportContainerRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async (day?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const options: Record<string, unknown> = { limit: 10_000 };
      if (day) {
        options.startTs = new Date(day + "T00:00:00").getTime();
        options.endTs = new Date(day + "T23:59:59.999").getTime();
        delete options.limit; // Fetch all events for the selected day
      }
      const res: any = await browser.runtime.sendMessage({
        type: "GET_ALL_EVENTS",
        options,
      });
      setEvents((res?.events ?? []) as CollectionEvent[]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("64MiB") || msg.includes("maximum allowed size")) {
        setError("Too much data to load at once. Try clearing old events.");
      } else {
        setError(msg || "Failed to load local events");
      }
      console.error("Error loading local events:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents(selectedDay);
  }, [loadEvents, selectedDay]);

  // Fetch accurate per-day event counts (full scan, not capped like events)
  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_DAY_COUNTS' })
      .then((res: any) => {
        if (res?.success && res.counts) {
          setDayCounts(new Map(Object.entries(res.counts) as [string, number][]));
        }
      })
      .catch((e: unknown) => console.error('[Portrait] GET_DAY_COUNTS error:', e));
  }, []);

  // Screen time stats: uses pre-computed global aggregate for unfiltered view,
  // falls back to GET_SCREEN_TIME for day-filtered views.
  const [globalStats, setGlobalStats] = useState<{
    totalTimeMs: number;
    hourBuckets: number[];
    uniqueUrlCount: number;
    firstVisit: number;
    lastVisit: number;
  } | null>(null);
  const [dayScreenTime, setDayScreenTime] = useState<{
    totalMs: number;
    sessions: ScreenTimeSession[];
  } | null>(null);

  useEffect(() => {
    if (selectedDay) {
      // Day filter: global aggregate doesn't support date ranges, so
      // fall back to GET_SCREEN_TIME with date bounds.
      setGlobalStats(null);
      setDayScreenTime(null);
      const startTs = new Date(selectedDay + "T00:00:00").getTime();
      const endTs = new Date(selectedDay + "T23:59:59.999").getTime();
      browser.runtime.sendMessage({ type: 'GET_SCREEN_TIME', options: { startTs, endTs } })
        .then((res: any) => {
          if (res?.success) {
            setDayScreenTime({ totalMs: res.totalMs, sessions: res.sessions });
          }
        })
        .catch((e: unknown) => console.error('[Portrait] GET_SCREEN_TIME error:', e));
      return;
    }
    // No day filter: use pre-computed global stats (O(1) read)
    setDayScreenTime(null);
    browser.runtime.sendMessage({ type: 'GET_GLOBAL_STATS' })
      .then((res: any) => {
        if (res?.success && res.stats) {
          setGlobalStats({
            totalTimeMs: res.stats.totalTimeMs,
            hourBuckets: res.stats.hourBuckets,
            uniqueUrlCount: res.stats.uniqueUrlCount,
            firstVisit: res.stats.firstVisit,
            lastVisit: res.stats.lastVisit,
          });
        } else {
          setGlobalStats(null);
        }
      })
      .catch((e: unknown) => console.error('[Portrait] GET_GLOBAL_STATS error:', e));
  }, [selectedDay]);

  // Build portrait card props from whichever data source is available.
  const portraitStats = useMemo((): PortraitCardProps | null => {
    // Cursor distance is always derived from the (capped) event set
    const cursorMoves = events
      .filter((e) => e.type === "cursor" && (e.data as any).event === "move")
      .sort((a, b) => a.ts - b.ts);
    let cursorDistancePx = 0;
    for (let i = 1; i < cursorMoves.length; i++) {
      const prev = cursorMoves[i - 1].data as any;
      const curr = cursorMoves[i].data as any;
      const dx = (curr.x - prev.x) * 1920;
      const dy = (curr.y - prev.y) * 1080;
      cursorDistancePx += Math.sqrt(dx * dx + dy * dy);
    }

    // Unfiltered: use pre-computed global aggregate
    if (globalStats && !selectedDay) {
      return {
        domain: "",
        totalTimeMs: globalStats.totalTimeMs,
        hourBuckets: globalStats.hourBuckets,
        cursorDistancePx,
        dateRange: globalStats.firstVisit && globalStats.lastVisit
          ? {
              oldest: new Date(globalStats.firstVisit).toLocaleDateString(),
              newest: new Date(globalStats.lastVisit).toLocaleDateString(),
            }
          : null,
        uniquePageCount: globalStats.uniqueUrlCount,
      };
    }

    // Day-filtered: use GET_SCREEN_TIME result for accurate per-day stats
    if (selectedDay && dayScreenTime) {
      const uniqueUrls = new Set<string>();
      for (const evt of events) {
        if (evt.meta?.url) uniqueUrls.add(evt.meta.url);
      }
      return {
        domain: "",
        totalTimeMs: dayScreenTime.totalMs,
        hourBuckets: sessionsToHourBuckets(dayScreenTime.sessions),
        cursorDistancePx,
        dateRange: selectedDay
          ? { oldest: selectedDay, newest: selectedDay }
          : null,
        uniquePageCount: uniqueUrls.size,
      };
    }

    // Still loading or no data
    if (events.length === 0) return null;

    // Events loaded but screen time not yet — show card with null time (loading)
    return {
      domain: "",
      totalTimeMs: null,
      hourBuckets: new Array(24).fill(0),
      cursorDistancePx,
      dateRange: null,
    };
  }, [events, globalStats, dayScreenTime, selectedDay]);

  // Compute trail states for frozen export
  const viewportSize = useMemo(() => ({ width: 800, height: 1000 }), []);
  const cursorSettings = useMemo(
    () => ({
      trailOpacity: 0.7,
      randomizeColors: true,
      domainFilter: "",
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      trailStyle: "chaotic" as const,
      chaosIntensity: 1.0,
      trailAnimationMode: "stagger" as const,
      maxConcurrentTrails: 15,
      overlapFactor: 0.75,
      minGapBetweenTrails: 0.2,
      documentSpace: false,
    }),
    [],
  );

  const { trailStates, timeBounds, cycleDuration } = useCursorTrails(
    events,
    viewportSize,
    cursorSettings,
  );

  const timeRange = useMemo(() => {
    const duration = cycleDuration > 0 ? cycleDuration : 60000;
    return { min: timeBounds.min || 0, max: timeBounds.max || 0, duration };
  }, [timeBounds, cycleDuration]);

  const handleExportDomainPortrait = useCallback(async () => {
    if (!portraitStats || exporting) return;
    setExporting(true);

    // Mount off-screen div, wait one frame, capture
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(
      <DomainPortraitExport
        domain=""
        stats={portraitStats}
        trailStates={trailStates}
        timeRange={timeRange}
      />,
    );

    // Wait two frames for React to flush and paint
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const el = container.querySelector("div") as HTMLElement | null;
    if (el) {
      try {
        await captureDomPortrait(el, domainPortraitFilename("portrait"));
      } catch (err) {
        console.error("[Portrait] Export failed:", err);
      }
    }

    root.unmount();
    document.body.removeChild(container);
    setExporting(false);
  }, [portraitStats, trailStates, timeRange, exporting]);

  const overlayVisible = hovering || exporting;

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        background: "var(--bg)",
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
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
        <a
          href={browser.runtime.getURL("stats.html")}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: "'Martian Mono', monospace",
            fontSize: "10px",
            color: "var(--text-muted)",
            textDecoration: "none",
            pointerEvents: "auto",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-teal)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          time
        </a>
      </div>

      {/* Portrait card — bottom-right, always visible */}
      {portraitStats && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            right: 20,
            width: 260,
            height: 160,
            zIndex: 200,
            pointerEvents: "none",
          }}
        >
          <PortraitCard
            domain={portraitStats.domain}
            totalTimeMs={portraitStats.totalTimeMs}
            hourBuckets={portraitStats.hourBuckets ?? new Array(24).fill(0)}
            cursorDistancePx={portraitStats.cursorDistancePx ?? 0}
            dateRange={portraitStats.dateRange}
            uniquePageCount={portraitStats.uniquePageCount}
          />
        </div>
      )}

      <MovementCanvas
        events={events}
        loading={loading}
        error={error}
        fetchEvents={loadEvents}
        dayCounts={dayCounts}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        activeVisualizations={activeVisualizations}
        onSetActiveVisualizations={setActiveVisualizations}
      />
    </div>
  );
};

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<PortraitPage />);
}
