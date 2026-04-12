// ABOUTME: Admin export page — loads cursor events and records trail animation to WebM video
// ABOUTME: Gated behind the Developer Mode setting in the extension's Collections panel

import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import browser from "webextension-polyfill";
import type { CollectionEvent } from "../../../website/internet-series/movement/types";
import { AnimatedTrails } from "../../../website/internet-series/movement/components/AnimatedTrails";
import { useCursorTrails } from "../../../website/internet-series/movement/hooks/useCursorTrails";
import { startRecording, videoExportFilename, triggerDownload } from "../utils/videoExport";

type PageStatus = "idle" | "loading" | "preview" | "recording" | "done";

export const ExportPage = () => {
  const [isDevMode, setIsDevMode] = useState<boolean | null>(null); // null = loading

  const [status, setStatus] = useState<PageStatus>("idle");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [transparent, setTransparent] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Derive available domains from loaded events
  const availableDomains = useMemo(() => {
    const domains = new Set<string>();
    for (const e of events) {
      if (e.meta?.url) {
        try {
          domains.add(new URL(e.meta.url).hostname);
        } catch {}
      }
    }
    return Array.from(domains).sort();
  }, [events]);

  // Filter events by domain if set
  const filteredEvents = useMemo(() => {
    if (!domainFilter) return events;
    return events.filter((e) => {
      try {
        return new URL(e.meta?.url ?? "").hostname === domainFilter;
      } catch {
        return false;
      }
    });
  }, [events, domainFilter]);

  const viewportSize = useMemo(() => ({ width, height }), [width, height]);

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
      overlapFactor: 0.8,
      minGapBetweenTrails: 0.3,
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
        options: { startTs, endTs },
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
    const svgEl = containerRef.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svgEl) {
      setError("No SVG found — make sure events are loaded first.");
      return;
    }
    setStatus("recording");
    setElapsedSecs(0);
    elapsedIntervalRef.current = setInterval(
      () => setElapsedSecs((s) => s + 1),
      1000,
    );
    stopRecordingRef.current = startRecording(svgEl, {
      width,
      height,
      transparent,
      onStop: (blob) => {
        setRecordedBlob(blob);
        setStatus("done");
      },
    });
  }, [width, height, transparent]);

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

        {/* Domain filter */}
        {availableDomains.length > 0 && (
          <div>
            <label style={labelStyle}>Domain filter</label>
            <select
              style={inputStyle}
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
            >
              <option value="">all domains</option>
              {availableDomains.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}

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
          {filteredEvents.length} events · {trailStates.length} trails
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
              trailStates={trailStates}
              timeRange={timeRange}
              showClickRipples={false}
              windowSize={30}
              soundEngine={null}
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
