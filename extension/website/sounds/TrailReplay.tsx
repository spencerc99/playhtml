// ABOUTME: Density harness — loops recorded trails at 1 to 100 at once, with a voice readout
// ABOUTME: The way to hear the arrangement at its quiet and crowded extremes on demand

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SoundEngine } from "../shared/sound/SoundEngine";
import { TrailSoundFrame } from "../shared/sound/types";
import { VoiceMotionState } from "../shared/sound/phrasing";
import { articulationBreath } from "../shared/sound/tuning";
import type { SampleEvent } from "./SamplePlayback";
import {
  parseRecording,
  positionAt,
  RecordedTrail,
  recordTrailsFromEvents,
  serializeRecording,
  trailDurationMs,
} from "./recordedTrails";
import bundledSample from "./sampleEvents.json";

const PAD_HEIGHT = 260;

/** How many trails may sound at once. The point of the harness. */
export const DENSITIES = [1, 5, 10, 30, 100] as const;
export type Density = (typeof DENSITIES)[number];

/** Points kept per slot for the drawn ribbon. */
const RIBBON_LENGTH = 40;

/** Pause between a slot finishing one trail and starting the next, in ms. */
const MIN_GAP_MS = 200;
const MAX_GAP_MS = 2500;

/**
 * One trail currently sounding, on its own clock.
 *
 * Each slot keeps its trail index for the life of the harness, so the engine
 * sees a stable identity per slot and a voice is not rebuilt every loop. The
 * trail behind the slot is re-drawn from the library each time it finishes,
 * with the engine told to retire the old one first.
 */
interface Slot {
  trailIndex: number;
  trail: RecordedTrail;
  /** Harness clock the current trail started on. */
  startedMs: number;
  /** Harness clock the next trail starts on, once this one has run out. */
  resumesMs: number;
  ribbon: Array<{ x: number; y: number }>;
  color: string;
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

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
  marginBottom: "12px",
};

const readoutStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "10px",
  color: "#8a8279",
  lineHeight: 1.6,
  whiteSpace: "pre",
  overflowX: "auto",
  maxHeight: "220px",
  overflowY: "auto",
  border: "1px solid #e0dbd4",
  background: "#f5f0e8",
  padding: "10px",
};

/** The readout's one-character shorthand for what a voice is doing. */
const STATE_MARK: Record<VoiceMotionState, string> = {
  moving: "→",
  lingering: "◦",
  resting: "·",
};

const pick = <T,>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

const gap = () => MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);

interface TrailReplayProps {
  /** The shared engine, so the harness plays through the panel's arrangement. */
  getEngine: () => Promise<SoundEngine>;
}

/**
 * Loop a library of recorded trails at a chosen density.
 *
 * An arrangement cannot be tuned by ear on whatever traffic happens to be in
 * the archive: the interesting questions are what one trail alone sounds like
 * and what a hundred at once sound like, and neither turns up on demand. This
 * plays the same recorded gestures at either extreme, and shows what the
 * engine made of them.
 */
export const TrailReplay = ({ getEngine }: TrailReplayProps) => {
  const bundledTrails = useMemo(
    () => recordTrailsFromEvents(bundledSample as SampleEvent[]),
    [],
  );
  const [trails, setTrails] = useState<RecordedTrail[]>(bundledTrails);
  const [density, setDensity] = useState<Density>(5);
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState("bundled sample");
  const [snapshot, setSnapshot] = useState<ReturnType<
    SoundEngine["getVoiceSnapshot"]
  > | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SoundEngine | null>(null);
  const slotsRef = useRef<Slot[]>([]);
  const framesRef = useRef<TrailSoundFrame[]>([]);
  const trailsRef = useRef<RecordedTrail[]>(trails);
  const densityRef = useRef<Density>(density);
  const startedAtRef = useRef(0);

  trailsRef.current = trails;
  densityRef.current = density;

  /** Grow or shrink the slot list to the current density. */
  const resize = useCallback(
    (nowMs: number) => {
      const slots = slotsRef.current;
      const target = densityRef.current;
      const library = trailsRef.current;
      while (slots.length > target) {
        const removed = slots.pop();
        if (removed) engineRef.current?.retireTrail(removed.trailIndex);
      }
      while (slots.length < target && library.length > 0) {
        const trail = pick(library);
        slots.push({
          trailIndex: slots.length,
          trail,
          // A random offset into its own length, so the scene does not start
          // as a hundred trails moving in step — which is the one density no
          // real page ever has.
          startedMs: nowMs - Math.random() * Math.max(1, trailDurationMs(trail)),
          resumesMs: nowMs,
          ribbon: [],
          color: trail.color,
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let cancelled = false;

    const step = (timestamp: number) => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(step);
      if (startedAtRef.current === 0) startedAtRef.current = timestamp;
      const nowMs = timestamp - startedAtRef.current;
      resize(nowMs);

      const canvas = canvasRef.current;
      const width = canvas?.width ?? 0;
      const height = canvas?.height ?? 0;
      const frames = framesRef.current;
      frames.length = 0;

      for (const slot of slotsRef.current) {
        if (nowMs < slot.resumesMs) continue;
        const localMs = nowMs - slot.startedMs;
        const position = positionAt(slot.trail, localMs);
        if (!position) {
          if (localMs > trailDurationMs(slot.trail)) {
            // Finished: rest for a moment, then take another trail. The
            // engine is told the trail left so its voice and its phrasing go
            // with it rather than being inherited by the next gesture.
            engineRef.current?.retireTrail(slot.trailIndex);
            slot.ribbon.length = 0;
            slot.resumesMs = nowMs + gap();
            slot.trail = pick(trailsRef.current);
            slot.color = slot.trail.color;
            slot.startedMs = slot.resumesMs;
          }
          continue;
        }
        const x = position.x * width;
        const y = position.y * height;
        slot.ribbon.push({ x, y });
        if (slot.ribbon.length > RIBBON_LENGTH) slot.ribbon.shift();
        const previous = slot.ribbon[slot.ribbon.length - 2] ?? { x, y };
        frames.push({
          trailIndex: slot.trailIndex,
          x,
          y,
          prevX: previous.x,
          prevY: previous.y,
          cursorType: slot.trail.cursor,
          progress: localMs / Math.max(1, trailDurationMs(slot.trail)),
          color: slot.color,
          isNewlyActive: false,
          identityKey: `${slot.trailIndex}:${slot.trail.id}`,
        });
      }

      engineRef.current?.tick(nowMs, frames);

      const ctx = canvas?.getContext("2d");
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const slot of slotsRef.current) {
          if (slot.ribbon.length < 2) continue;
          // The drawn line breathes with the voice, the same way the archive's
          // trails do — which is the point of watching as well as listening.
          const breath = articulationBreath(
            engineRef.current?.getArticulation(slot.trailIndex),
          );
          ctx.strokeStyle = slot.color;
          ctx.globalAlpha = 0.55 * breath.opacityScale;
          ctx.lineWidth = 1.5 * breath.widthScale;
          ctx.beginPath();
          ctx.moveTo(slot.ribbon[0].x, slot.ribbon[0].y);
          for (const point of slot.ribbon.slice(1)) ctx.lineTo(point.x, point.y);
          ctx.stroke();
          const head = slot.ribbon[slot.ribbon.length - 1];
          ctx.globalAlpha = 0.9 * breath.opacityScale;
          ctx.fillStyle = slot.color;
          ctx.beginPath();
          ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };

    frame = window.requestAnimationFrame(step);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [running, resize]);

  // The readout polls rather than being pushed from the frame loop: it is a
  // whole-arrangement snapshot on the engine's own clock, and re-rendering a
  // hundred rows at 60fps would be the most expensive thing on the page.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSnapshot(engineRef.current?.getVoiceSnapshot() ?? null);
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);

  const start = useCallback(async () => {
    const engine = await getEngine();
    engineRef.current = engine;
    startedAtRef.current = 0;
    setRunning(true);
  }, [getEngine]);

  const stop = useCallback(() => {
    setRunning(false);
    const engine = engineRef.current;
    for (const slot of slotsRef.current) engine?.retireTrail(slot.trailIndex);
    slotsRef.current = [];
    engine?.reset();
    setSnapshot(null);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => stop, [stop]);

  const exportRecording = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify(serializeRecording(trailsRef.current))],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "trail-recording.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const importRecording = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const parsed = parseRecording(JSON.parse(await file.text()));
        if (parsed.length === 0) {
          setSource("no replayable trails in that file");
          return;
        }
        setTrails(parsed);
        setSource(file.name);
        // Every slot is holding a trail from the old library, so the scene is
        // torn down rather than left half in each.
        stop();
      } catch {
        setSource("could not read that file");
      }
    },
    [stop],
  );

  return (
    <div style={{ marginBottom: "48px" }}>
      <div
        style={{
          fontFamily: "'Source Serif 4', Georgia, serif",
          fontStyle: "italic",
          fontSize: "20px",
          marginBottom: "6px",
        }}
      >
        density harness
      </div>
      <div style={{ ...labelStyle, marginBottom: "12px", lineHeight: 1.5 }}>
        the same recorded gestures, looped at whatever density you ask for, so
        the arrangement can be heard alone and in a crowd on demand rather than
        whenever the archive happens to be busy.
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>trails</span>
        {DENSITIES.map((option) => (
          <button
            key={option}
            onClick={() => setDensity(option)}
            style={density === option ? buttonActiveStyle : buttonStyle}
          >
            {option}
          </button>
        ))}
      </div>

      <div style={rowStyle}>
        <button onClick={() => (running ? stop() : start())} style={buttonStyle}>
          {running ? "stop" : "play"}
        </button>
        <button onClick={exportRecording} style={buttonStyle}>
          export recording
        </button>
        <label style={{ ...buttonStyle, display: "inline-block" }}>
          import recording
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(event) => importRecording(event.target.files?.[0])}
          />
        </label>
        <span style={labelStyle}>
          {trails.length} trails · {source}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={860}
        height={PAD_HEIGHT}
        style={{
          width: "100%",
          height: `${PAD_HEIGHT}px`,
          border: "1px solid #e0dbd4",
          background: "#f5f0e8",
          display: "block",
          marginBottom: "12px",
        }}
      />

      <div style={readoutStyle}>
        {snapshot
          ? [
              `energy ${snapshot.energy.toFixed(3)}   chord ${snapshot.chord}   progression ${snapshot.progression}`,
              `full voices ${snapshot.fullVoices}   pooled ${snapshot.pooledVoices}`,
              "",
              ...snapshot.voices.map(
                (voice) =>
                  `${String(voice.trailIndex).padStart(3)} ${STATE_MARK[voice.state]} ` +
                  `${voice.state.padEnd(9)} speed ${voice.speed.toFixed(2).padStart(6)} ` +
                  `art ${voice.articulation.toFixed(2)} bloom ${voice.bloom.toFixed(2)} ` +
                  `${voice.frequency.toFixed(1).padStart(7)}Hz${voice.present ? " soloist" : ""}`,
              ),
            ].join("\n")
          : "not playing"}
      </div>
    </div>
  );
};
