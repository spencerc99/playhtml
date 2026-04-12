// ABOUTME: Admin export page — loads cursor events and records trail animation to WebM video
// ABOUTME: Gated behind the Developer Mode setting in the extension's Collections panel

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import browser from "webextension-polyfill";
import type { CollectionEvent } from "../../../website/internet-series/movement/types";
import { AnimatedTrails } from "../../../website/internet-series/movement/components/AnimatedTrails";
import { useCursorTrails } from "../../../website/internet-series/movement/hooks/useCursorTrails";
import { startRecording, videoExportFilename, triggerDownload, type ScrollKeyframe } from "../utils/videoExport";

type PageStatus = "idle" | "loading" | "preview" | "recording" | "done";

export const ExportPage = () => {
  const [isDevMode, setIsDevMode] = useState<boolean | null>(null); // null = loading

  const [status, setStatus] = useState<PageStatus>("idle");
  const [startDate, setStartDate] = useState(() => localStorage.getItem("wwo_export_startDate") ?? "");
  const [endDate, setEndDate] = useState(() => localStorage.getItem("wwo_export_endDate") ?? "");
  const [urlFilter, setUrlFilter] = useState(() => localStorage.getItem("wwo_export_urlFilter") ?? "");
  const [width, setWidth] = useState(() => Number(localStorage.getItem("wwo_export_width") ?? 1920));
  const [height, setHeight] = useState(() => Number(localStorage.getItem("wwo_export_height") ?? 1080));
  const [transparent, setTransparent] = useState(() => localStorage.getItem("wwo_export_transparent") === "1");
  const [animationSpeed, setAnimationSpeed] = useState(() => Number(localStorage.getItem("wwo_export_animationSpeed") ?? 1));
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [animationKey, setAnimationKey] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Holds recording params waiting for animationKey remount to settle before capture starts
  const pendingRecordingRef = useRef<Parameters<typeof startRecording>[1] | null>(null);

  // Persist form inputs across refreshes
  useEffect(() => { localStorage.setItem("wwo_export_startDate", startDate); }, [startDate]);
  useEffect(() => { localStorage.setItem("wwo_export_endDate", endDate); }, [endDate]);
  useEffect(() => { localStorage.setItem("wwo_export_urlFilter", urlFilter); }, [urlFilter]);
  useEffect(() => { localStorage.setItem("wwo_export_width", String(width)); }, [width]);
  useEffect(() => { localStorage.setItem("wwo_export_height", String(height)); }, [height]);
  useEffect(() => { localStorage.setItem("wwo_export_transparent", transparent ? "1" : "0"); }, [transparent]);
  useEffect(() => { localStorage.setItem("wwo_export_animationSpeed", String(animationSpeed)); }, [animationSpeed]);

  // Load dev_mode from storage to gate access
  useEffect(() => {
    browser.storage.local.get(["dev_mode"]).then((result) => {
      setIsDevMode(Boolean(result["dev_mode"]));
    });
  }, []);

  // Clean up recording resources if component unmounts during recording
  useEffect(() => {
    return () => {
      if (stopRecordingRef.current) {
        stopRecordingRef.current();
        stopRecordingRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
    };
  }, []);

  // After animationKey increments, React remounts AnimatedTrails. This effect fires
  // once the new SVG is in the DOM, so we grab the fresh element and start recording.
  useEffect(() => {
    if (!pendingRecordingRef.current) return;
    const params = pendingRecordingRef.current;
    pendingRecordingRef.current = null;

    // Small rAF delay to let the animation loop initialize before first capture
    requestAnimationFrame(() => {
      const svgEl = containerRef.current?.querySelector("svg") as SVGSVGElement | null;
      if (!svgEl) return;
      elapsedIntervalRef.current = setInterval(
        () => setElapsedSecs((s) => s + 1),
        1000,
      );
      stopRecordingRef.current = startRecording(svgEl, params);
    });
  }, [animationKey]);

  // Filter events by URL prefix/substring if set
  const filteredEvents = useMemo(() => {
    if (!urlFilter.trim()) return events;
    const filter = urlFilter.trim();
    return events.filter((e) => e.meta?.url?.includes(filter));
  }, [events, urlFilter]);

  const viewportSize = useMemo(() => ({ width, height }), [width, height]);

  const cursorSettings = useMemo(
    () => ({
      trailOpacity: 0.7,
      randomizeColors: false,
      domainFilter: "",
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      trailStyle: "chaotic" as const,
      chaosIntensity: 1.0,
      trailAnimationMode: "stagger" as const,
      maxConcurrentTrails: 15,
      overlapFactor: 0.75,
      minGapBetweenTrails: 0.2,
      documentSpace: true,
      animationSpeed,
      strokeWidth: 5,
      clickMinRadius: 10,
      clickMaxRadius: 80,
      clickMinDuration: 500,
      clickMaxDuration: 2500,
      clickExpansionDuration: 12300,
      clickStrokeWidth: 4,
      clickOpacity: 0.3,
      clickNumRings: 2,
      clickRingDelayMs: 120,
      clickAnimationStopPoint: 0.45,
      trailVisualStyle: "color" as const,
    }),
    [animationSpeed],
  );

  const { trailStates, timeBounds, cycleDuration } = useCursorTrails(
    filteredEvents,
    viewportSize,
    cursorSettings,
  );

  const timeRange = useMemo(() => {
    const duration = cycleDuration > 0 ? cycleDuration : 60000;
    return { min: timeBounds.min || 0, max: timeBounds.max || 0, duration };
  }, [timeBounds, cycleDuration]);

  // Build scroll timeline from cursor events — each cursor event carries the raw pixel
  // scrollX/scrollY at capture time, giving us a dense enough keyframe set for smooth panning.
  const scrollTimeline = useMemo((): ScrollKeyframe[] => {
    const keyframes: ScrollKeyframe[] = [];
    for (const event of filteredEvents) {
      const scrollX = (event.data as { scrollX?: number }).scrollX;
      const scrollY = (event.data as { scrollY?: number }).scrollY;
      if (scrollX !== undefined && scrollY !== undefined) {
        keyframes.push({ ts: event.ts, scrollX, scrollY });
      }
    }
    keyframes.sort((a, b) => a.ts - b.ts);
    return keyframes;
  }, [filteredEvents]);

  // Derive the session viewport size from event metadata — cursor coordinates were
  // normalized against this viewport, so the viewBox must match it (not the export size).
  // Use the most common vw/vh pair across events.
  const sessionViewport = useMemo((): { vw: number; vh: number } => {
    const counts = new Map<string, { vw: number; vh: number; n: number }>();
    for (const event of filteredEvents) {
      const vw = event.meta?.vw;
      const vh = event.meta?.vh;
      if (!vw || !vh) continue;
      const key = `${vw}x${vh}`;
      const entry = counts.get(key);
      if (entry) entry.n++;
      else counts.set(key, { vw, vh, n: 1 });
    }
    let best = { vw: width, vh: height };
    let bestN = 0;
    for (const entry of counts.values()) {
      if (entry.n > bestN) { bestN = entry.n; best = entry; }
    }
    return best;
  }, [filteredEvents, width, height]);

  const loadEvents = useCallback(async () => {
    if (!startDate) {
      setError("Please select a start date.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const startTs = new Date(startDate + "T00:00:00").getTime();
      const endTs = endDate
        ? new Date(endDate + "T23:59:59.999").getTime()
        : new Date(startDate + "T23:59:59.999").getTime();
      const res: any = await browser.runtime.sendMessage({
        type: "GET_ALL_EVENTS",
        options: { startTs, endTs, type: "cursor" },
      });
      const loaded = (res?.events ?? []) as CollectionEvent[];
      setEvents(loaded);
      setStatus(loaded.length > 0 ? "preview" : "idle");
      if (loaded.length === 0) setError("No events found for this date range.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("64MiB") || msg.includes("maximum allowed size")) {
        setError("Too much data — try a narrower date range.");
      } else {
        setError(msg || "Failed to load events.");
      }
      setStatus("idle");
    }
  }, [startDate, endDate]);

  const handleStartRecording = useCallback(() => {
    if (!containerRef.current?.querySelector("svg")) {
      setError("No SVG found — make sure events are loaded first.");
      return;
    }
    // Store params so the post-remount effect can start recording with the fresh SVG
    pendingRecordingRef.current = {
      width,
      height,
      sessionVW: sessionViewport.vw,
      sessionVH: sessionViewport.vh,
      transparent,
      animationStartTs: timeRange.min,
      cycleDurationMs: timeRange.duration,
      animationSpeed,
      scrollTimeline,
      onStop: (blob) => {
        setRecordedBlob(blob);
        setStatus("done");
      },
    };
    setElapsedSecs(0);
    setStatus("recording");
    // Increment key last — triggers remount, which fires the useEffect below
    setAnimationKey((k) => k + 1);
  }, [width, height, transparent, timeRange, animationSpeed, scrollTimeline]);

  const handleStopRecording = useCallback(() => {
    stopRecordingRef.current?.();
    stopRecordingRef.current = null;
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (recordedBlob) triggerDownload(recordedBlob, videoExportFilename());
  }, [recordedBlob]);

  // Scale preview to fit viewport
  const previewScale = Math.min(
    (window.innerWidth - 80) / width,
    (window.innerHeight - 320) / height,
    1,
  );

  const inputStyle: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: 13,
    padding: "4px 8px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#3d3833",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#8a8279",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 4,
    display: "block",
  };

  if (isDevMode === null) {
    return null; // still loading
  }

  if (!isDevMode) {
    return (
      <div style={{ padding: 40, fontFamily: "monospace", color: "#3d3833" }}>
        not authorized — enable Developer Mode in the extension settings to access
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg, #faf7f2)",
        padding: 24,
        color: "#3d3833",
      }}
    >
      <h1
        style={{
          fontFamily: "'Lora', serif",
          fontWeight: 700,
          fontSize: 20,
          marginBottom: 24,
        }}
      >
        trail export
      </h1>

      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
        {/* Date range */}
        <div>
          <label style={labelStyle}>Start date</label>
          <input
            type="date"
            style={inputStyle}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>End date (optional)</label>
          <input
            type="date"
            style={inputStyle}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        {/* URL filter */}
        <div>
          <label style={labelStyle}>URL filter (paste full or partial URL)</label>
          <input
            type="text"
            style={{ ...inputStyle, width: 320 }}
            placeholder="e.g. https://en.wikipedia.org/wiki/Foo"
            value={urlFilter}
            onChange={(e) => setUrlFilter(e.target.value)}
          />
        </div>

        {/* Canvas size */}
        <div>
          <label style={labelStyle}>Width</label>
          <input
            type="number"
            style={{ ...inputStyle, width: 80 }}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </div>
        <div>
          <label style={labelStyle}>Height</label>
          <input
            type="number"
            style={{ ...inputStyle, width: 80 }}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </div>

        {/* Background */}
        <div>
          <label style={labelStyle}>Background</label>
          <select
            style={inputStyle}
            value={transparent ? "transparent" : "white"}
            onChange={(e) => setTransparent(e.target.value === "transparent")}
          >
            <option value="white">white</option>
            <option value="transparent">transparent</option>
          </select>
        </div>

        {/* Animation speed */}
        <div>
          <label style={labelStyle}>Speed: {animationSpeed}x</label>
          <input
            type="range"
            min="0.5"
            max="8"
            step="0.5"
            value={animationSpeed}
            onChange={(e) => setAnimationSpeed(Number(e.target.value))}
          />
        </div>

        {/* Load button */}
        <div style={{ alignSelf: "flex-end" }}>
          <button
            onClick={loadEvents}
            disabled={status === "loading" || status === "recording"}
            style={{
              ...inputStyle,
              cursor: "pointer",
              background: "#3d3833",
              color: "#faf7f2",
              border: "none",
              padding: "6px 16px",
            }}
          >
            {status === "loading" ? "loading\u2026" : "load events"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            color: "#c4724e",
            marginBottom: 16,
          }}
        >
          {error}
        </p>
      )}

      {/* Event count */}
      {status !== "idle" && status !== "loading" && (
        <p
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            color: "#8a8279",
            marginBottom: 12,
          }}
        >
          {filteredEvents.length} events · {trailStates.length} trails · session viewport {sessionViewport.vw}×{sessionViewport.vh}
        </p>
      )}

      {/* Record controls */}
      {(status === "preview" || status === "recording" || status === "done") && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          {status === "preview" && (
            <button
              onClick={handleStartRecording}
              style={{
                ...inputStyle,
                cursor: "pointer",
                background: "#c4724e",
                color: "#fff",
                border: "none",
                padding: "6px 16px",
              }}
            >
              start recording
            </button>
          )}
          {status === "recording" && (
            <>
              <button
                onClick={handleStopRecording}
                style={{
                  ...inputStyle,
                  cursor: "pointer",
                  background: "#3d3833",
                  color: "#faf7f2",
                  border: "none",
                  padding: "6px 16px",
                }}
              >
                stop recording
              </button>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#c4724e" }}>
                ● {elapsedSecs}s
              </span>
            </>
          )}
          {status === "done" && (
            <>
              <button
                onClick={handleDownload}
                style={{
                  ...inputStyle,
                  cursor: "pointer",
                  background: "#4a9a8a",
                  color: "#fff",
                  border: "none",
                  padding: "6px 16px",
                }}
              >
                download WebM
              </button>
              <button
                onClick={() => {
                  setStatus("preview");
                  setRecordedBlob(null);
                }}
                style={{
                  ...inputStyle,
                  cursor: "pointer",
                  background: "none",
                  border: "1px solid #ccc",
                  padding: "6px 16px",
                }}
              >
                record again
              </button>
            </>
          )}
        </div>
      )}

      {/* Preview */}
      {(status === "preview" || status === "recording" || status === "done") && (
        <div
          style={{
            overflow: "hidden",
            border: "1px solid #e0dbd4",
            display: "inline-block",
          }}
        >
          <div
            ref={containerRef}
            style={{
              width,
              height,
              position: "relative",
              background: transparent ? "transparent" : "#ffffff",
              transform: `scale(${previewScale})`,
              transformOrigin: "top left",
            }}
          >
            <AnimatedTrails
              key={animationKey}
              trailStates={trailStates}
              timeRange={timeRange}
              showClickRipples={true}
              windowSize={30}
              soundEngine={null}
              documentSpace={true}
              settings={{
                strokeWidth: cursorSettings.strokeWidth,
                trailOpacity: cursorSettings.trailOpacity,
                animationSpeed: cursorSettings.animationSpeed,
                clickMinRadius: cursorSettings.clickMinRadius,
                clickMaxRadius: cursorSettings.clickMaxRadius,
                clickMinDuration: cursorSettings.clickMinDuration,
                clickMaxDuration: cursorSettings.clickMaxDuration,
                clickExpansionDuration: cursorSettings.clickExpansionDuration,
                clickStrokeWidth: cursorSettings.clickStrokeWidth,
                clickOpacity: cursorSettings.clickOpacity,
                clickNumRings: cursorSettings.clickNumRings,
                clickRingDelayMs: cursorSettings.clickRingDelayMs,
                clickAnimationStopPoint: cursorSettings.clickAnimationStopPoint,
                trailVisualStyle: cursorSettings.trailVisualStyle,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
