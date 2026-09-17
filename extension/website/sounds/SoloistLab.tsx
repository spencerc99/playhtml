// ABOUTME: The soloist lab — the promotion lifecycle's tunables, its phases, and three scenes to hear them in
// ABOUTME: Turns the numbers by ear rather than by rebuild, and draws a ring on whoever is soloing

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  SPOTLIGHT_TUNING_DEFAULTS,
  SPOTLIGHT_TUNING_RANGES,
  type SoundEngine,
  type SpotlightPhase,
  type SpotlightTuning,
} from "../shared/sound/SoundEngine";
import type { TrailSoundFrame } from "../shared/sound/types";

/**
 * The lab is a listening instrument, not a settings page.
 *
 * A promotion is a sequence — audition, entrance, reign, release, cooldown —
 * and every one of its lengths is a number somebody has to choose by ear. The
 * only way to choose them is to hear the same promotion at several settings,
 * which means the scene has to be the same every time and the numbers have to
 * move without a reload. So: three fixed scenarios, sliders that reach into a
 * running engine, and a readout of which phase you are hearing.
 *
 * The scenarios are deterministic. Their motion comes from a seeded generator
 * and a fixed step, so the second time you play one it is the same scene, which
 * is what makes two settings comparable at all.
 */

const WARM_INK = "#3d3833";
const WARM_PAPER = "#faf7f2";
const WARM_PANEL = "#f5f0e8";
const WARM_LINE = "#e0dbd4";
const WARM_MUTED = "#8a8279";
const MONO = "'Martian Mono', monospace";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 300;
const FRAME_MS = 1_000 / 60;
/** How long a scenario runs. Long enough for a promotion to happen twice. */
const SCENARIO_MS = 20_000;

const styles = {
  section: {
    border: `1px solid ${WARM_LINE}`,
    background: WARM_PANEL,
    padding: "20px",
    marginBottom: "24px",
  } as React.CSSProperties,
  heading: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic" as const,
    fontWeight: 200,
    fontSize: "20px",
    color: WARM_INK,
    marginBottom: "6px",
  } as React.CSSProperties,
  blurb: {
    fontFamily: MONO,
    fontSize: "11px",
    lineHeight: 1.6,
    color: WARM_MUTED,
    marginBottom: "16px",
    maxWidth: "60ch",
  } as React.CSSProperties,
  label: {
    fontFamily: MONO,
    fontSize: "10px",
    color: WARM_MUTED,
    letterSpacing: "0.04em",
  } as React.CSSProperties,
  button: {
    padding: "8px 14px",
    border: `1px solid ${WARM_LINE}`,
    background: WARM_PAPER,
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: "11px",
    color: WARM_INK,
  } as React.CSSProperties,
  buttonActive: {
    padding: "8px 14px",
    border: `1px solid ${WARM_INK}`,
    background: WARM_INK,
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: "11px",
    color: WARM_PAPER,
  } as React.CSSProperties,
  canvas: {
    width: "100%",
    maxWidth: `${CANVAS_WIDTH}px`,
    aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
    border: `1px solid ${WARM_LINE}`,
    background: WARM_PANEL,
    display: "block",
  } as React.CSSProperties,
};

/**
 * The three scenes, and what each is for.
 *
 * They are not a demo reel. Each one is a question the tuning has to answer,
 * and between them they cover the two ways the lifecycle can be wrong: too shy
 * to promote anybody, and so eager it promotes everybody.
 */
const SCENARIOS = [
  {
    id: "one-fast",
    title: "one fast among five",
    blurb:
      "The case the spotlight is for. One cursor sweeps, five drift. It should promote once, hold, and step back — and you should be able to hear which part of that you are in.",
  },
  {
    id: "churny-crowd",
    title: "churny crowd",
    blurb:
      "Six cursors trading the lead three times a second — faster than an audition. Nobody is driving the scene, so nobody should be promoted, and an audition that keeps restarting is the lifecycle working rather than failing.",
  },
  {
    id: "single-cursor",
    title: "single cursor",
    blurb:
      "One cursor alone, sweeping as hard as it likes. It must never promote — a soloist is a voice stepping out of a crowd, and there is no crowd here.",
  },
] as const;

type ScenarioId = (typeof SCENARIOS)[number]["id"];

/** Deterministic per scenario, so two settings are heard on the same scene. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const TRAIL_COLORS = [
  "#c25f4a",
  "#4a8fc2",
  "#c2a04a",
  "#6ac24a",
  "#a04ac2",
  "#4ac2a0",
];

interface LabTrail {
  trailIndex: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  points: Array<{ x: number; y: number }>;
}

/**
 * One scenario's motion, as a pure function of the frame number.
 *
 * Pure rather than stateful so a replay is bit-identical: the whole point of
 * the lab is to change one number and hear the difference, which only works if
 * everything else is the same.
 */
const advanceScenario = (
  scenario: ScenarioId,
  trails: LabTrail[],
  frame: number,
  random: () => number,
): void => {
  const seconds = (frame * FRAME_MS) / 1_000;

  for (const trail of trails) {
    trail.prevX = trail.x;
    trail.prevY = trail.y;
  }

  if (scenario === "single-cursor") {
    const trail = trails[0];
    trail.x = CANVAS_WIDTH * (0.5 + 0.45 * Math.sin(seconds * 5.5));
    trail.y = CANVAS_HEIGHT * (0.5 + 0.35 * Math.cos(seconds * 4.1));
    return;
  }

  if (scenario === "one-fast") {
    // The lead sweeps hard and steadily; the crowd drifts. The lead changes
    // once, halfway through, so a release and a second promotion are both in
    // earshot inside one run.
    const lead = seconds < SCENARIO_MS / 2_000 ? 0 : 1;
    trails.forEach((trail, index) => {
      const fast = index === lead;
      const rate = fast ? 5.5 : 0.22;
      const phase = index * 0.9;
      trail.x =
        CANVAS_WIDTH * (0.5 + 0.44 * Math.sin(seconds * rate + phase));
      trail.y =
        CANVAS_HEIGHT * (0.5 + 0.36 * Math.cos(seconds * rate * 0.81 + phase));
    });
    return;
  }

  // churny-crowd: the lead changes three times a second — comfortably faster
  // than an audition, so no trail is ever driving the scene for long enough to
  // claim it. The refusal is the thing being demonstrated.
  const lead = Math.floor(seconds / 0.32) % trails.length;
  trails.forEach((trail, index) => {
    const fast = index === lead;
    const rate = fast ? 4.8 : 0.6 + random() * 0.2;
    const phase = index * 1.3;
    trail.x = CANVAS_WIDTH * (0.5 + 0.42 * Math.sin(seconds * rate + phase));
    trail.y =
      CANVAS_HEIGHT * (0.5 + 0.34 * Math.cos(seconds * rate * 0.77 + phase));
  });
};

const trailCountFor = (scenario: ScenarioId): number =>
  scenario === "single-cursor" ? 1 : 6;

/**
 * Draw the ring that says who is soloing.
 *
 * The lifecycle is most of what there is to understand about the spotlight, and
 * hearing a promotion without seeing which trail took it — or that an audition
 * keeps starting over on a different one — is most of why the numbers were hard
 * to choose. A solid ring is a promotion; a dashed one is an audition that may
 * yet come to nothing.
 */
const drawSoloistRing = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  auditioning: boolean,
): void => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, auditioning ? 11 : 15, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = auditioning ? 1 : 2;
  ctx.globalAlpha = auditioning ? 0.55 : 1;
  ctx.setLineDash(auditioning ? [3, 4] : []);
  ctx.stroke();
  ctx.restore();
};

/** The order the phases run in, for the readout's little track. */
const PHASE_ORDER: SpotlightPhase[] = [
  "idle",
  "auditioning",
  "entrance",
  "reign",
  "release",
  "cooldown",
];

const PhaseReadout: React.FC<{
  phase: SpotlightPhase;
  soloist: number | null;
  candidate: number | null;
}> = ({ phase, soloist, candidate }) => (
  <div style={{ marginBottom: "16px" }}>
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
      {PHASE_ORDER.map((name) => {
        const active = name === phase;
        return (
          <div
            key={name}
            style={{
              fontFamily: MONO,
              fontSize: "10px",
              padding: "4px 8px",
              border: `1px solid ${active ? WARM_INK : WARM_LINE}`,
              background: active ? WARM_INK : WARM_PAPER,
              color: active ? WARM_PAPER : WARM_MUTED,
            }}
          >
            {name}
          </div>
        );
      })}
    </div>
    <div style={{ ...styles.label, marginTop: "8px" }}>
      {soloist !== null
        ? `trail ${soloist} has the spotlight`
        : candidate !== null
          ? `trail ${candidate} is auditioning`
          : "nobody is soloing"}
    </div>
  </div>
);

/**
 * The tunables, grouped the way they are heard rather than the way they are
 * stored: the shape of a promotion in time, the tests that decide whether one
 * happens at all, and what a promoted voice actually sounds like.
 */
const GROUPS: Array<{
  title: string;
  blurb: string;
  keys: Array<keyof SpotlightTuning>;
}> = [
  {
    title: "the shape in time",
    blurb: "How long each part of a promotion lasts.",
    keys: [
      "auditionMs",
      "entranceMs",
      "minReignMs",
      "reignDevelopMs",
      "releaseMs",
      "sceneCooldownMs",
    ],
  },
  {
    title: "who, and whether",
    blurb:
      "The tests a trail has to clear to be promoted, and the ones that end a reign. The demote pair sit well under the promote pair on purpose: judging both directions on one threshold makes a normal sweep flap several times a second.",
    keys: [
      "minTrailsForSpotlight",
      "velocityRatio",
      "minVelocity",
      "demoteVelocityRatio",
      "demoteMinVelocity",
    ],
  },
  {
    title: "what it sounds like",
    blurb:
      "The character of a promoted voice. It does not move in register at all — it steps forward in every other dimension instead.",
    keys: [
      "gain",
      "filterHz",
      "reverbSendScale",
      "vibratoDepthScale",
      "vibratoRateScale",
      "haloOnsetMs",
      "haloGain",
    ],
  },
];

const TuningSlider: React.FC<{
  name: keyof SpotlightTuning;
  value: number;
  onChange: (value: number) => void;
}> = ({ name, value, onChange }) => {
  const range = SPOTLIGHT_TUNING_RANGES[name];
  const isDefault = value === SPOTLIGHT_TUNING_DEFAULTS[name];
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(150px, 1fr) 2fr minmax(90px, auto)",
        gap: "10px",
        alignItems: "center",
        marginBottom: "6px",
      }}
    >
      <span
        style={{
          ...styles.label,
          color: isDefault ? WARM_MUTED : WARM_INK,
        }}
      >
        {name}
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: "100%", accentColor: WARM_INK }}
      />
      <span
        style={{
          ...styles.label,
          textAlign: "right",
          color: isDefault ? WARM_MUTED : WARM_INK,
        }}
      >
        {value} {range.unit}
      </span>
    </label>
  );
};

interface SoloistLabProps {
  /** Starts (or resumes) the page's one engine, on the user's own gesture. */
  getEngine: () => Promise<SoundEngine>;
}

export const SoloistLab: React.FC<SoloistLabProps> = ({ getEngine }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SoundEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef<ScenarioId | null>(null);

  const [running, setRunning] = useState<ScenarioId | null>(null);
  const [tuning, setTuning] = useState<SpotlightTuning>({
    ...SPOTLIGHT_TUNING_DEFAULTS,
  });
  const [readout, setReadout] = useState<{
    phase: SpotlightPhase;
    soloist: number | null;
    candidate: number | null;
  }>({ phase: "idle", soloist: null, candidate: null });

  const applyTuning = useCallback((next: Partial<SpotlightTuning>) => {
    setTuning((previous) => {
      const merged = { ...previous, ...next };
      // Straight into the running engine: the whole point is to hear the change
      // on the promotion in flight rather than on the next reload.
      engineRef.current?.setSpotlightTuning(next);
      return merged;
    });
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    runningRef.current = null;
    setRunning(null);
    const engine = engineRef.current;
    if (engine) {
      // A scenario that simply stopped feeding frames would leave its voices
      // hanging on the last thing they were doing. Reset is what a scene
      // ending actually looks like.
      engine.reset();
    }
    setReadout({ phase: "idle", soloist: null, candidate: null });
  }, []);

  const play = useCallback(
    async (scenario: ScenarioId) => {
      if (runningRef.current) stop();
      const engine = await getEngine();
      engineRef.current = engine;
      engine.setSpotlightTuning(tuning);
      engine.setCanvasWidth(CANVAS_WIDTH);
      engine.reset();

      const random = seededRandom(
        scenario.split("").reduce((hash, ch) => hash * 31 + ch.charCodeAt(0), 7),
      );
      const trails: LabTrail[] = Array.from(
        { length: trailCountFor(scenario) },
        (_, index) => ({
          trailIndex: index,
          x: CANVAS_WIDTH / 2,
          y: CANVAS_HEIGHT / 2,
          prevX: CANVAS_WIDTH / 2,
          prevY: CANVAS_HEIGHT / 2,
          points: [],
        }),
      );

      runningRef.current = scenario;
      setRunning(scenario);
      let frame = 0;
      let firstFrame = true;

      const step = (): void => {
        if (runningRef.current !== scenario) return;
        const elapsedMs = frame * FRAME_MS;
        if (elapsedMs > SCENARIO_MS) {
          stop();
          return;
        }

        advanceScenario(scenario, trails, frame, random);

        const frames: TrailSoundFrame[] = trails.map((trail, index) => {
          trail.points.push({ x: trail.x, y: trail.y });
          if (trail.points.length > 40) trail.points.shift();
          return {
            trailIndex: trail.trailIndex,
            x: trail.x,
            y: trail.y,
            prevX: trail.prevX,
            prevY: trail.prevY,
            cursorType: "default",
            progress: 0,
            color: TRAIL_COLORS[index % TRAIL_COLORS.length],
            isNewlyActive: firstFrame,
            identityKey: `lab-${scenario}-${trail.trailIndex}`,
          };
        });
        firstFrame = false;
        engine.tick(elapsedMs, frames);

        const soloist = engine.getSoloistTrailIndex();
        const candidate = engine.getSpotlightCandidateTrailIndex();
        setReadout({ phase: engine.getSpotlightPhase(), soloist, candidate });

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) {
          const dpr = window.devicePixelRatio || 1;
          if (canvas.width !== Math.round(CANVAS_WIDTH * dpr)) {
            canvas.width = Math.round(CANVAS_WIDTH * dpr);
            canvas.height = Math.round(CANVAS_HEIGHT * dpr);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = WARM_PANEL;
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          trails.forEach((trail, index) => {
            const color = TRAIL_COLORS[index % TRAIL_COLORS.length];
            for (let i = 1; i < trail.points.length; i++) {
              const t = i / trail.points.length;
              ctx.beginPath();
              ctx.moveTo(trail.points[i - 1].x, trail.points[i - 1].y);
              ctx.lineTo(trail.points[i].x, trail.points[i].y);
              ctx.globalAlpha = t * 0.6;
              ctx.lineWidth = 1 + t * 2;
              ctx.strokeStyle = color;
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(trail.x, trail.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            if (trail.trailIndex === soloist) {
              drawSoloistRing(ctx, trail.x, trail.y, color, false);
            } else if (trail.trailIndex === candidate) {
              drawSoloistRing(ctx, trail.x, trail.y, color, true);
            }
          });
        }

        frame++;
        rafRef.current = requestAnimationFrame(step);
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [getEngine, stop, tuning],
  );

  useEffect(() => stop, [stop]);

  const scenario = SCENARIOS.find((entry) => entry.id === running);

  return (
    <div style={styles.section}>
      <div style={styles.heading}>soloist lab</div>
      <div style={styles.blurb}>
        a promotion is a sequence, not a switch. play a scenario, watch which
        phase it is in, and move the numbers while it runs — everything below
        reaches the engine on the next tick, so you hear the change on the
        promotion in flight.
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        {SCENARIOS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            style={running === entry.id ? styles.buttonActive : styles.button}
            onClick={() => (running === entry.id ? stop() : void play(entry.id))}
          >
            {running === entry.id ? `stop ${entry.title}` : entry.title}
          </button>
        ))}
      </div>

      <div style={{ ...styles.blurb, marginBottom: "12px", minHeight: "3em" }}>
        {scenario?.blurb ?? "pick a scene. each one is about 20 seconds."}
      </div>

      <PhaseReadout {...readout} />

      <canvas ref={canvasRef} style={styles.canvas} />

      <div style={{ marginTop: "20px" }}>
        {GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: "20px" }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: "11px",
                color: WARM_INK,
                marginBottom: "4px",
              }}
            >
              {group.title}
            </div>
            <div style={{ ...styles.blurb, marginBottom: "10px" }}>
              {group.blurb}
            </div>
            {group.keys.map((key) => (
              <TuningSlider
                key={key}
                name={key}
                value={tuning[key]}
                onChange={(value) => applyTuning({ [key]: value })}
              />
            ))}
          </div>
        ))}

        <button
          type="button"
          style={styles.button}
          onClick={() => {
            setTuning({ ...SPOTLIGHT_TUNING_DEFAULTS });
            engineRef.current?.resetSpotlightTuning();
          }}
        >
          back to defaults
        </button>
      </div>
    </div>
  );
};
