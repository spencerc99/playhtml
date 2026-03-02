// ABOUTME: Portrait page entrypoint — full movement visualization using local IndexedDB data
// ABOUTME: Loads all locally-collected events and passes them to MovementCanvas for rendering

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { PortraitCardDirectionA } from "../../components/PortraitCard";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import "../../styles/options.scss";
import "../../../../website/internet-series/movement/movement.scss";
import type { CollectionEvent } from "../../../../website/internet-series/movement/types";
import { MovementCanvas } from "../../../../website/internet-series/movement/components/MovementCanvas";
import { useCursorTrails } from "../../../../website/internet-series/movement/hooks/useCursorTrails";
import { extractDomain } from "../../../../website/internet-series/movement/utils/eventUtils";
import { DomainPortraitExport } from "../../components/DomainPortraitExport";
import { captureDomPortrait, domainPortraitFilename } from "../../utils/portraitExport";
import type { PortraitCardProps } from "../../components/PortraitCard";

const PortraitPage = () => {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [hovering, setHovering] = useState(false);
  const exportContainerRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await browser.runtime.sendMessage({ type: "GET_ALL_EVENTS" });
      setEvents((res?.events ?? []) as CollectionEvent[]);
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

  // Compute domain from most common URL in events
  const domain = useMemo(() => {
    if (events.length === 0) return "";
    const domainCounts = new Map<string, number>();
    for (const evt of events) {
      const d = extractDomain(evt.meta?.url || "");
      if (d) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
    }
    let topDomain = "";
    let topCount = 0;
    domainCounts.forEach((count, d) => {
      if (count > topCount) { topCount = count; topDomain = d; }
    });
    return topDomain;
  }, [events]);

  // Compute portrait stats for the export card
  const portraitStats = useMemo((): PortraitCardProps | null => {
    if (events.length === 0) return null;

    const counts = { cursor: 0, keyboard: 0, viewport: 0 };
    const timestamps: number[] = [];
    const uniqueUrls = new Set<string>();

    for (const evt of events) {
      if (evt.type === "cursor") counts.cursor++;
      else if (evt.type === "keyboard") counts.keyboard++;
      else if (evt.type === "viewport") counts.viewport++;
      timestamps.push(evt.ts);
      if (evt.meta?.url) uniqueUrls.add(evt.meta.url);
    }

    const oldest = new Date(Math.min(...timestamps)).toLocaleDateString();
    const newest = new Date(Math.max(...timestamps)).toLocaleDateString();

    // Compute screen time + sessions from navigation events
    const navEvents = events
      .filter((e) => e.type === "navigation")
      .sort((a, b) => a.ts - b.ts);
    let pendingFocusTs: number | null = null;
    let pendingFocusUrl = "";
    let totalTimeMs = 0;
    const sessions: { url: string; focusTs: number; blurTs: number; durationMs: number }[] = [];
    for (const evt of navEvents) {
      const d = evt.data as any;
      if (d.event === "focus") {
        pendingFocusTs = evt.ts;
        pendingFocusUrl = evt.meta?.url ?? "";
      } else if (
        (d.event === "blur" || d.event === "beforeunload") &&
        pendingFocusTs !== null
      ) {
        const durationMs = evt.ts - pendingFocusTs;
        if (durationMs >= 1000 && durationMs <= 8 * 60 * 60 * 1000) {
          totalTimeMs += durationMs;
          sessions.push({ url: pendingFocusUrl, focusTs: pendingFocusTs, blurTs: evt.ts, durationMs });
        }
        pendingFocusTs = null;
      }
    }

    // Compute cursor distance
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

    return {
      domain,
      totalTimeMs: totalTimeMs > 0 ? totalTimeMs : null,
      sessions,
      cursorDistancePx,
      eventCounts: counts,
      dateRange: { oldest, newest },
      uniquePageCount: uniqueUrls.size,
    };
  }, [events, domain]);

  // Compute trail states for frozen export
  const viewportSize = useMemo(() => ({ width: 800, height: 1000 }), []);
  const cursorSettings = useMemo(
    () => ({
      trailOpacity: 0.7,
      randomizeColors: true,
      domainFilter: domain,
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      trailStyle: "chaotic" as const,
      chaosIntensity: 1.0,
      trailAnimationMode: "stagger" as const,
      maxConcurrentTrails: 15,
      overlapFactor: 0.75,
      minGapBetweenTrails: 0.2,
      documentSpace: false,
    }),
    [domain],
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
        domain={domain}
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
        await captureDomPortrait(el, domainPortraitFilename(domain));
      } catch (err) {
        console.error("[Portrait] Export failed:", err);
      }
    }

    root.unmount();
    document.body.removeChild(container);
    setExporting(false);
  }, [portraitStats, trailStates, timeRange, domain, exporting]);

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
        {/* Export button — disabled for now
        <div
          style={{
            display: "flex",
            gap: "8px",
            pointerEvents: overlayVisible ? "auto" : "none",
            opacity: overlayVisible ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        >
          {!loading && portraitStats && (
            <button
              onClick={handleExportDomainPortrait}
              disabled={exporting}
              style={{
                background: "none",
                border: "1px solid rgba(61, 56, 51, 0.25)",
                cursor: exporting ? "not-allowed" : "pointer",
                color: "var(--text-muted)",
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                padding: "4px 8px",
                borderRadius: "4px",
                opacity: exporting ? 0.5 : 1,
              }}
            >
              {exporting ? "exporting..." : "↓ export"}
            </button>
          )}
        </div>
        */}
      </div>

      {/* Portrait card — bottom-left, always visible */}
      {portraitStats && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            zIndex: 200,
            pointerEvents: "none",
          }}
        >
          <PortraitCardDirectionA
            domain={portraitStats.domain}
            totalTimeMs={portraitStats.totalTimeMs}
            sessions={portraitStats.sessions ?? []}
            cursorDistancePx={portraitStats.cursorDistancePx ?? 0}
            dateRange={portraitStats.dateRange}
            uniquePageCount={portraitStats.uniquePageCount}
            compact
          />
        </div>
      )}

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
