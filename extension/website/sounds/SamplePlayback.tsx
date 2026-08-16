// ABOUTME: Replays a slice of real browsing events through the sound engine
// ABOUTME: Drives trails, clicks and navigations from live worker data or a bundled fixture

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SoundEngine } from "../shared/sound/SoundEngine";
import { TrailSoundFrame } from "../shared/sound/types";
import { RECENT_EVENTS_URL } from "../shared/config";
import bundledSample from "./sampleEvents.json";

const PAD_HEIGHT = 300;
/** Points kept per participant for the on-canvas ribbon. */
const TRAIL_LENGTH = 50;
/** How long a participant stays drawn after their last event (ms of replay). */
const TRAIL_IDLE_TIMEOUT_MS = 4000;

/**
 * One replayable event, flattened to what the sound layer and the canvas need.
 * Coordinates are the normalized 0-1 the collectors record, so the same sample
 * replays at any pad size.
 */
export interface SampleEvent {
  /** Milliseconds from the start of the sample. */
  t: number;
  type: "cursor" | "navigation";
  /** Generic participant id — the bundled fixture carries no real identity. */
  pid: string;
  event: string;
  domain: string;
  x?: number;
  y?: number;
  cursor?: string;
  duration?: number;
}

/**
 * CSS cursor keywords the instrument mapping understands. A page can set a
 * cursor to an arbitrary `url(...)`, including an inline data URI carrying its
 * own markup, so a raw cursor string is page content and must never be kept.
 * Only the keyword forms mean anything to the sound layer anyway.
 */
const CURSOR_KEYWORDS = new Set([
  "auto", "default", "pointer", "text", "grab", "grabbing", "crosshair",
  "move", "all-scroll", "not-allowed", "wait", "help", "progress",
  "ns-resize", "ew-resize", "nesw-resize", "nwse-resize", "col-resize",
  "row-resize", "zoom-in", "zoom-out", "copy", "alias", "cell",
  "context-menu", "none", "vertical-text", "no-drop",
]);

/** The effective keyword from a CSS cursor value, or undefined if it has none. */
function cursorKeyword(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // A CSS cursor may list fallbacks; the last keyword is the effective one.
  const parts = value.split(",").map((part) => part.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    if (CURSOR_KEYWORDS.has(parts[i])) return parts[i];
  }
  return undefined;
}

const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** Colours cycled across participants so trails stay tellable apart. */
const SAMPLE_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

/** How much of a live fetch is kept, matched to the bundled sample's span. */
export const LIVE_WINDOW_MS = 180_000;

/**
 * The `windowMs` slice containing the most events. A plain "most recent N"
 * cut can land on a quiet stretch and loop as near-silence; the busiest window
 * is the part with something to hear.
 */
export function densestWindow<T extends { ts: number }>(
  sorted: T[],
  windowMs: number,
): T[] {
  if (sorted.length === 0) return [];
  let bestStart = 0;
  let bestCount = 0;
  let end = 0;
  for (let start = 0; start < sorted.length; start++) {
    if (end < start) end = start;
    while (end < sorted.length && sorted[end].ts < sorted[start].ts + windowMs) {
      end++;
    }
    if (end - start > bestCount) {
      bestCount = end - start;
      bestStart = start;
    }
  }
  return sorted.slice(bestStart, bestStart + bestCount);
}

/**
 * Pull a small live slice from the worker: one window of cursor and navigation
 * events, capped hard. Anything that fails here falls back to the bundled
 * fixture, so the playground still works offline.
 */
export async function fetchSampleEvents(
  domain: string,
  limit = 1200,
): Promise<SampleEvent[]> {
  const load = async (type: "cursor" | "navigation") => {
    const params = new URLSearchParams({ type, limit: String(limit) });
    if (domain) params.set("domain", domain);
    const response = await fetch(`${RECENT_EVENTS_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${type} events: ${response.status}`);
    }
    return response.json() as Promise<
      Array<{
        type: string;
        ts: number;
        data: Record<string, unknown>;
        meta: { pid: string; url?: string };
      }>
    >;
  };

  const [cursor, navigation] = await Promise.all([
    load("cursor"),
    load("navigation"),
  ]);
  const all = [...cursor, ...navigation].sort((a, b) => a.ts - b.ts);
  if (all.length === 0) return [];

  // Keep the densest window rather than the whole fetch. A quiet half-hour
  // loops as mostly silence; a few busy minutes is what there is to listen to.
  const raw = densestWindow(all, LIVE_WINDOW_MS);

  // The playground only ever needs a short window, and the identities never
  // leave this function — participants are renumbered on the way through.
  const pids = new Map<string, string>();
  const anonymize = (pid: string) => {
    let id = pids.get(pid);
    if (!id) {
      id = `p${String(pids.size + 1).padStart(2, "0")}`;
      pids.set(pid, id);
    }
    return id;
  };

  const startTs = raw[0].ts;
  return raw.map((event) => {
    const data = event.data;
    let domainName = "unknown";
    try {
      domainName = new URL(event.meta.url ?? "").hostname || "unknown";
    } catch {
      /* keep the fallback */
    }
    return {
      t: event.ts - startTs,
      type: event.type === "navigation" ? "navigation" : "cursor",
      pid: anonymize(event.meta.pid),
      event: String(data.event ?? ""),
      domain: domainName,
      x: typeof data.x === "number" ? data.x : undefined,
      y: typeof data.y === "number" ? data.y : undefined,
      cursor: cursorKeyword(data.cursor),
      duration: typeof data.duration === "number" ? data.duration : undefined,
    } satisfies SampleEvent;
  });
}

/** What one participant looks like on the pad while the sample plays. */
interface SampleTrail {
  trailIndex: number;
  pid: string;
  color: string;
  x: number;
  y: number;
  cursorType: string | undefined;
  lastEventMs: number;
  firstSeen: boolean;
  points: Array<{ x: number; y: number }>;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#8a8279",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #e0dbd4",
  background: "#f5f0e8",
  cursor: "pointer",
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#3d3833",
};

const buttonActiveStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#3d3833",
  color: "#faf7f2",
  border: "1px solid #3d3833",
};

interface SamplePlaybackProps {
  /**
   * The engine the pad already owns, so the sample plays through whatever
   * toggles are currently set rather than through a second configuration.
   */
  getEngine: () => Promise<SoundEngine>;
}

/**
 * Replays a real browsing sample through the pad's engine, so sound settings
 * can be judged against genuine cursor motion rather than random walkers.
 */
export const SamplePlayback = ({ getEngine }: SamplePlaybackProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SoundEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const eventsRef = useRef<SampleEvent[]>(bundledSample as SampleEvent[]);
  const trailsRef = useRef<Map<string, SampleTrail>>(new Map());
  const nextTrailIndexRef = useRef(0);
  const cursorRef = useRef(0);
  const startedAtRef = useRef(0);
  const speedRef = useRef<Speed>(1);
  const loopCountRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [source, setSource] = useState<"bundled" | "live">("bundled");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [readout, setReadout] = useState({ position: 0, active: 0, loops: 0 });

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const sampleDurationMs =
    eventsRef.current.length > 0
      ? eventsRef.current[eventsRef.current.length - 1].t
      : 0;

  /** Drop every trail and rewind to the top of the sample. */
  const rewind = useCallback(() => {
    for (const trail of trailsRef.current.values()) {
      engineRef.current?.retireTrail(trail.trailIndex);
    }
    trailsRef.current.clear();
    cursorRef.current = 0;
    nextTrailIndexRef.current = 0;
  }, []);

  const frame = useCallback(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const events = eventsRef.current;
    const wallElapsed = performance.now() - startedAtRef.current;
    const sampleMs = wallElapsed * speedRef.current;

    // Fire every event whose moment has arrived since the last frame. Cursor
    // moves reposition a trail; clicks and navigations go straight to the
    // engine's own one-shot triggers.
    while (
      cursorRef.current < events.length &&
      events[cursorRef.current].t <= sampleMs
    ) {
      const event = events[cursorRef.current++];
      const x = (event.x ?? 0.5) * width;
      const y = (event.y ?? 0.5) * height;

      if (event.type === "navigation") {
        // Only real page arrivals sound; blur and beforeunload are departures.
        if (event.event === "focus" || event.event === "popstate") {
          engine.triggerNavigation({ x });
        }
        continue;
      }

      let trail = trailsRef.current.get(event.pid);
      if (!trail) {
        const trailIndex = nextTrailIndexRef.current++;
        trail = {
          trailIndex,
          pid: event.pid,
          color: SAMPLE_COLORS[trailIndex % SAMPLE_COLORS.length],
          x,
          y,
          cursorType: event.cursor,
          lastEventMs: sampleMs,
          firstSeen: true,
          points: [],
        };
        trailsRef.current.set(event.pid, trail);
      }

      trail.lastEventMs = sampleMs;
      if (event.cursor) trail.cursorType = event.cursor;

      if (event.event === "click" || event.event === "hold") {
        engine.triggerClick({ x, y, holdDuration: event.duration });
        continue;
      }
      if (event.event !== "move") continue;

      trail.x = x;
      trail.y = y;
      trail.points.push({ x, y });
      if (trail.points.length > TRAIL_LENGTH) trail.points.shift();
    }

    // Retire trails that have gone quiet, so the scene thins out the way the
    // real visualization does rather than accumulating every participant.
    for (const [pid, trail] of trailsRef.current) {
      if (sampleMs - trail.lastEventMs > TRAIL_IDLE_TIMEOUT_MS) {
        engine.retireTrail(trail.trailIndex);
        trailsRef.current.delete(pid);
      }
    }

    const frames: TrailSoundFrame[] = [];
    for (const trail of trailsRef.current.values()) {
      frames.push({
        trailIndex: trail.trailIndex,
        x: trail.x,
        y: trail.y,
        prevX: trail.x,
        prevY: trail.y,
        cursorType: trail.cursorType,
        progress: 0,
        color: trail.color,
        isNewlyActive: trail.firstSeen,
        // The sample's own participant id, so a person keeps one voice across
        // the whole replay and across loops.
        identityKey: `sample-${trail.pid}`,
      });
      trail.firstSeen = false;
    }

    engine.tick(sampleMs, frames);

    const ctx = canvas.getContext("2d");
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        engine.setCanvasWidth(width);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#f5f0e8";
      ctx.fillRect(0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const trail of trailsRef.current.values()) {
        const points = trail.points;
        for (let i = 1; i < points.length; i++) {
          const t = i / points.length;
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x, points[i - 1].y);
          ctx.lineTo(points[i].x, points[i].y);
          ctx.globalAlpha = t * 0.6;
          ctx.lineWidth = 1 + t * 2;
          ctx.strokeStyle = trail.color;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(trail.x, trail.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = trail.color;
        ctx.fill();
      }
    }

    // Loop from the top, with a full rewind so the next pass starts from the
    // same empty scene rather than inheriting the last one's trails.
    if (cursorRef.current >= events.length) {
      rewind();
      startedAtRef.current = performance.now();
      loopCountRef.current++;
    }

    setReadout({
      position: Math.min(sampleMs, sampleDurationMs),
      active: trailsRef.current.size,
      loops: loopCountRef.current,
    });

    rafRef.current = requestAnimationFrame(frame);
  }, [rewind, sampleDurationMs]);

  const handleStart = useCallback(async () => {
    const engine = await getEngine();
    engineRef.current = engine;
    const canvas = canvasRef.current;
    engine.setCanvasWidth(canvas?.clientWidth ?? window.innerWidth);
    if (rafRef.current !== null) return;
    rewind();
    loopCountRef.current = 0;
    startedAtRef.current = performance.now();
    setRunning(true);
    rafRef.current = requestAnimationFrame(frame);
  }, [frame, getEngine, rewind]);

  const handleStop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setRunning(false);
    rewind();
    engineRef.current?.reset();
  }, [rewind]);

  const handleLoadLive = useCallback(async () => {
    setLoadState("loading");
    try {
      const fetched = await fetchSampleEvents("");
      if (fetched.length === 0) throw new Error("no events returned");
      eventsRef.current = fetched;
      setSource("live");
      setLoadState("idle");
    } catch (err) {
      console.warn("Falling back to the bundled sample:", err);
      eventsRef.current = bundledSample as SampleEvent[];
      setSource("bundled");
      setLoadState("error");
    }
    rewind();
    startedAtRef.current = performance.now();
    loopCountRef.current = 0;
  }, [rewind]);

  const handleUseBundled = useCallback(() => {
    eventsRef.current = bundledSample as SampleEvent[];
    setSource("bundled");
    setLoadState("idle");
    rewind();
    startedAtRef.current = performance.now();
    loopCountRef.current = 0;
  }, [rewind]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div style={{ marginBottom: "32px" }}>
      <div
        style={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "12px",
          fontFamily: "'Martian Mono', monospace",
          fontSize: "11px",
        }}
      >
        Real Event Sample
      </div>
      <div style={{ ...labelStyle, marginBottom: "12px" }}>
        Replays a few minutes of real browsing through the same engine the pad
        drives, so settings can be judged against genuine cursor motion. Every
        toggle above applies. Ships with a bundled anonymized sample; loading
        live events pulls a fresh slice and falls back to the bundle offline.
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <button
          onClick={running ? handleStop : handleStart}
          style={running ? buttonActiveStyle : buttonStyle}
        >
          {running ? "stop" : "play sample"}
        </button>
        {SPEEDS.map((option) => (
          <button
            key={option}
            onClick={() => setSpeed(option)}
            style={speed === option ? buttonActiveStyle : buttonStyle}
          >
            {option}x
          </button>
        ))}
        <button
          onClick={handleUseBundled}
          style={source === "bundled" ? buttonActiveStyle : buttonStyle}
        >
          bundled
        </button>
        <button
          onClick={handleLoadLive}
          style={source === "live" ? buttonActiveStyle : buttonStyle}
        >
          {loadState === "loading" ? "loading…" : "load live"}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: `${PAD_HEIGHT}px`,
          border: "1px solid #e0dbd4",
          background: "#f5f0e8",
          display: "block",
        }}
      />

      <div style={{ ...labelStyle, marginTop: "8px" }}>
        {source === "bundled" ? "bundled sample" : "live sample"} |{" "}
        {eventsRef.current.length} events over{" "}
        {(sampleDurationMs / 1000).toFixed(0)}s | position{" "}
        {(readout.position / 1000).toFixed(1)}s | {readout.active} trails |{" "}
        {readout.loops} loops
        {loadState === "error"
          ? " | live fetch failed, using the bundled sample"
          : ""}
      </div>
    </div>
  );
};
