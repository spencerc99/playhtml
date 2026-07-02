// ABOUTME: Cursor touches experiment — replays trails on their real timestamps and
// ABOUTME: marks every moment two cursors touched with a two-color gradient burst
import React, { useState, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom/client";
import {
  useCursorTrails,
  CursorTrailSettings,
} from "../shared/hooks/useCursorTrails";
import { useCursorEventPool } from "../shared/hooks/useCursorEventPool";
import { useChromeToggle } from "../shared/hooks/useChromeToggle";
import { detectTouches, buildCoPresenceTimeline } from "./detect";
import { createTouchesSketch, SketchSettings } from "./sketch";

const MAX_POOL_EVENTS = 100000;
const TIMELINE_PAD_MS = 1500;

const styles = {
  page: {
    position: "fixed",
    inset: 0,
    background: "#faf7f2",
    overflow: "hidden",
  } as React.CSSProperties,
  canvasHost: {
    position: "absolute",
    inset: 0,
  } as React.CSSProperties,
  title: {
    position: "fixed",
    top: 16,
    left: 20,
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic" as const,
    fontWeight: 200,
    fontSize: "22px",
    color: "#3d3833",
    zIndex: 10,
    pointerEvents: "none",
  } as React.CSSProperties,
  status: {
    position: "fixed",
    top: 46,
    left: 20,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#8a8279",
    zIndex: 10,
    pointerEvents: "none",
  } as React.CSSProperties,
  panel: {
    position: "fixed",
    bottom: 16,
    right: 16,
    background: "#f5f0e8",
    border: "1px solid #e0dbd4",
    padding: "14px 16px",
    zIndex: 10,
    fontFamily: "'Martian Mono', monospace",
    fontSize: "10px",
    color: "#3d3833",
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    width: 230,
  } as React.CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  } as React.CSSProperties,
  slider: { width: 110 } as React.CSSProperties,
};

const CursorTouches = () => {
  const chromeHidden = useChromeToggle();
  const { events, loading, deepening, error } = useCursorEventPool(
    "",
    MAX_POOL_EVENTS,
  );

  const [touchRadius, setTouchRadius] = useState(20);
  const [speed, setSpeed] = useState(1);
  const [afterglowSec, setAfterglowSec] = useState(2);
  const [showCursors, setShowCursors] = useState(true);
  const [samePersonOk, setSamePersonOk] = useState(false);

  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const cursorSettings: CursorTrailSettings = useMemo(
    () => ({
      randomizeColors: false,
      filters: [],
      pidFilter: "",
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      trailStyle: "straight",
      chaosIntensity: 1.0,
      trailAnimationMode: "natural",
      maxConcurrentTrails: 15,
      overlapFactor: 0.8,
      minGapBetweenTrails: 0.3,
      documentSpace: false,
    }),
    [],
  );

  const { trails } = useCursorTrails(events, viewportSize, cursorSettings);

  const touches = useMemo(
    () => detectTouches(trails, touchRadius, !samePersonOk),
    [trails, touchRadius, samePersonOk],
  );

  const timeline = useMemo(
    () => buildCoPresenceTimeline(trails, TIMELINE_PAD_MS),
    [trails],
  );

  // Settings the sketch reads every frame without re-instantiating.
  const settingsRef = useRef<SketchSettings>({
    speed,
    afterglowMs: afterglowSec * 1000,
    showCursors,
  });
  useEffect(() => {
    settingsRef.current = {
      speed,
      afterglowMs: afterglowSec * 1000,
      showCursors,
    };
  }, [speed, afterglowSec, showCursors]);

  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current || trails.length === 0) return;
    const instance = createTouchesSketch(
      {
        trails,
        touches,
        segments: timeline.segments,
        totalMs: timeline.totalMs,
      },
      settingsRef,
      hostRef.current,
    );
    return () => instance.remove();
  }, [trails, touches, timeline]);

  const statusText = loading
    ? "loading cursor events..."
    : error
      ? error
      : `${touches.length} touches across ${timeline.segments.length} co-presence windows` +
        ` (${Math.round(timeline.totalMs / 1000)}s of shared time, ${trails.length} trails)` +
        (deepening ? ` — deepening pool (${events.length} events)...` : "");

  return (
    <div style={styles.page}>
      <div ref={hostRef} style={styles.canvasHost} />
      {!chromeHidden && <div style={styles.title}>cursor touches</div>}
      {!chromeHidden && <div style={styles.status}>{statusText}</div>}

      {!chromeHidden && (
        <div style={styles.panel}>
          <div style={styles.row}>
            <span>radius: {touchRadius}px</span>
            <input
              type="range"
              min={10}
              max={150}
              step={5}
              value={touchRadius}
              onChange={(e) => setTouchRadius(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
          <div style={styles.row}>
            <span>speed: {speed}x</span>
            <input
              type="range"
              min={1}
              max={120}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
          <div style={styles.row}>
            <span>afterglow: {afterglowSec}s</span>
            <input
              type="range"
              min={0}
              max={15}
              value={afterglowSec}
              onChange={(e) => setAfterglowSec(Number(e.target.value))}
              style={styles.slider}
            />
          </div>
          <div style={styles.row}>
            <label>
              <input
                type="checkbox"
                checked={showCursors}
                onChange={(e) => setShowCursors(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              cursors
            </label>
            <label>
              <input
                type="checkbox"
                checked={samePersonOk}
                onChange={(e) => setSamePersonOk(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              same person ok
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<CursorTouches />);
