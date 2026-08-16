// ABOUTME: A/B trail pad for auditioning sustained vs discrete-note sonification
// ABOUTME: Drives SoundEngine.tick from the real cursor plus simulated wandering agents

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CrossingFlavor,
  SoundEngine,
  SoundMode,
} from "../shared/sound/SoundEngine";
import { AuditionAccent, TrailSoundFrame } from "../shared/sound/types";
import {
  DEFAULT_PROGRESSION_ID,
  PROGRESSION_IDS,
  PROGRESSIONS,
  ProgressionId,
  RegisterBand,
} from "../shared/sound/scales";

const PAD_HEIGHT = 300;
/** Trail points kept per agent for the on-canvas ribbon. */
const TRAIL_LENGTH = 60;
/** Reserved trail index for the user's own cursor. */
const CURSOR_TRAIL_INDEX = 0;

const AGENT_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

/**
 * A random-walk cursor. Most of the time it drifts; occasionally it commits to
 * a fast dart across the pad, which is the gesture the soloist logic should
 * pick out of a busy scene.
 */
interface Agent {
  trailIndex: number;
  /** Stands in for a real trail's participant id when deriving its voice. */
  identityKey: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  /** Frames remaining in the current dart, 0 when wandering. */
  dartFrames: number;
  points: Array<{ x: number; y: number }>;
}

const WANDER_ACCEL = 0.35;
const WANDER_DAMPING = 0.92;
const WANDER_MAX_SPEED = 3.5;
const DART_SPEED = 22;
const DART_DURATION_FRAMES = 28;
/** Per-frame chance an idle agent starts a dart. */
const DART_CHANCE = 0.004;

function createAgent(
  trailIndex: number,
  width: number,
  height: number,
): Agent {
  return {
    trailIndex,
    identityKey: `pad-agent-${trailIndex}`,
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0,
    vy: 0,
    color: AGENT_COLORS[trailIndex % AGENT_COLORS.length],
    dartFrames: 0,
    points: [],
  };
}

function stepAgent(agent: Agent, width: number, height: number): void {
  if (agent.dartFrames > 0) {
    agent.dartFrames--;
  } else {
    if (Math.random() < DART_CHANCE) {
      const angle = Math.random() * Math.PI * 2;
      agent.vx = Math.cos(angle) * DART_SPEED;
      agent.vy = Math.sin(angle) * DART_SPEED;
      agent.dartFrames = DART_DURATION_FRAMES;
    } else {
      agent.vx =
        (agent.vx + (Math.random() * 2 - 1) * WANDER_ACCEL) * WANDER_DAMPING;
      agent.vy =
        (agent.vy + (Math.random() * 2 - 1) * WANDER_ACCEL) * WANDER_DAMPING;
      const speed = Math.hypot(agent.vx, agent.vy);
      if (speed > WANDER_MAX_SPEED) {
        agent.vx = (agent.vx / speed) * WANDER_MAX_SPEED;
        agent.vy = (agent.vy / speed) * WANDER_MAX_SPEED;
      }
    }
  }

  agent.x += agent.vx;
  agent.y += agent.vy;

  // Bounce off the pad edges so agents stay in view and in the pan field.
  if (agent.x < 0) {
    agent.x = 0;
    agent.vx = Math.abs(agent.vx);
  } else if (agent.x > width) {
    agent.x = width;
    agent.vx = -Math.abs(agent.vx);
  }
  if (agent.y < 0) {
    agent.y = 0;
    agent.vy = Math.abs(agent.vy);
  } else if (agent.y > height) {
    agent.y = height;
    agent.vy = -Math.abs(agent.vy);
  }

  agent.points.push({ x: agent.x, y: agent.y });
  if (agent.points.length > TRAIL_LENGTH) agent.points.shift();
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  color: string,
  isSoloist: boolean,
): void {
  if (points.length < 2) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 1; i < points.length; i++) {
    const t = i / points.length;
    ctx.beginPath();
    ctx.moveTo(points[i - 1].x, points[i - 1].y);
    ctx.lineTo(points[i].x, points[i].y);
    ctx.globalAlpha = t * (isSoloist ? 0.95 : 0.45);
    ctx.lineWidth = isSoloist ? 1 + t * 3 : 1 + t * 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const head = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(head.x, head.y, isSoloist ? 5 : 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  if (isSoloist) {
    ctx.beginPath();
    ctx.arc(head.x, head.y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
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

const AUDITION_CARDS: Array<{
  accent: AuditionAccent;
  label: string;
  description: string;
}> = [
  {
    accent: "trailArrival",
    label: "trail arrival",
    description:
      "A door-chime scatter of high notes as a trail enters the scene.",
  },
  {
    accent: "trailDeparture",
    label: "trail departure",
    description: "A shorter falling chime, as a trail leaves.",
  },
  {
    accent: "navigation",
    label: "navigation gong",
    description: "One deep resonant note marking a page change.",
  },
  {
    accent: "soloistFlourish",
    label: "soloist flourish",
    description: "A single bell from the soloist run, at mid velocity.",
  },
  {
    accent: "soloistResolve",
    label: "soloist resolve",
    description: "The closing note as the spotlight leaves a trail.",
  },
  {
    accent: "crossingShimmer",
    label: "crossing — shimmer",
    description:
      "The gentle variant, for a quiet scene: two tones a few Hz apart on one chord tone, beating slowly.",
  },
  {
    accent: "crossingSuspension",
    label: "crossing — suspension",
    description:
      "The usual variant: a step above a chord tone, held, then falling onto it. Tension, then release.",
  },
  {
    accent: "crossingHarsh",
    label: "crossing — harsh",
    description:
      "The tritone, reserved for busy scenes and rate-limited hard. Does not resolve.",
  },
  {
    accent: "crossingMerge",
    label: "crossing merge",
    description:
      "The consonant dyad two trails sound instead, when crossings merge.",
  },
  {
    accent: "choralSwell",
    label: "choral swell",
    description:
      "One voice through the whole swell — onset, crescendo, release — in the choral vowel.",
  },
  {
    accent: "trailVoicePair",
    label: "two trail voices",
    description:
      "Two example fingerprints in turn, two seconds each — one cool-coloured trail low, one warm-coloured trail high, so the colour-to-register mapping is audible.",
  },
];

/**
 * The arrangement the pad opens on — the combination Spencer settled on by
 * ear. Playground-only: the live pages read their own settings defaults and
 * keep every experimental toggle off.
 */
const PAD_DEFAULTS = {
  mode: "spotlight" as SoundMode,
  volume: 0.5,
  chordRotation: true,
  progression: DEFAULT_PROGRESSION_ID,
  energyArc: true,
  trailArrivals: true,
  navigationSounds: true,
  trailVoices: true,
  swells: true,
  bassPedal: false,
  choralTimbre: false,
  crossings: "off" as CrossingFlavor,
};

interface TrailPadProps {
  /**
   * Hands the pad's engine getter to the owner, so other sections of the
   * playground can drive the same engine — and therefore the same toggles —
   * rather than standing up a second one with its own configuration.
   */
  onEngineReady?: (getEngine: () => Promise<SoundEngine>) => void;
}

export const TrailPad = ({ onEngineReady }: TrailPadProps = {}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SoundEngine | null>(null);
  const agentsRef = useRef<Agent[]>([]);
  const cursorRef = useRef<{
    x: number;
    y: number;
    inside: boolean;
    points: Array<{ x: number; y: number }>;
  }>({ x: 0, y: 0, inside: false, points: [] });
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const modeRef = useRef<SoundMode>(PAD_DEFAULTS.mode);
  const chordRotationRef = useRef(PAD_DEFAULTS.chordRotation);
  const progressionRef = useRef<ProgressionId>(PAD_DEFAULTS.progression);
  const energyArcRef = useRef(PAD_DEFAULTS.energyArc);
  const trailArrivalsRef = useRef(PAD_DEFAULTS.trailArrivals);
  const navigationSoundsRef = useRef(PAD_DEFAULTS.navigationSounds);
  const bassPedalRef = useRef(PAD_DEFAULTS.bassPedal);
  const trailVoicesRef = useRef(PAD_DEFAULTS.trailVoices);
  const crossingsRef = useRef<CrossingFlavor>(PAD_DEFAULTS.crossings);
  const swellsRef = useRef(PAD_DEFAULTS.swells);
  const choralTimbreRef = useRef(PAD_DEFAULTS.choralTimbre);
  const nextTrailIndexRef = useRef(1);

  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<SoundMode>(PAD_DEFAULTS.mode);
  const [volume, setVolume] = useState(PAD_DEFAULTS.volume);
  const [agentCount, setAgentCount] = useState(0);
  const [chordRotation, setChordRotation] = useState(
    PAD_DEFAULTS.chordRotation,
  );
  const [progression, setProgression] = useState<ProgressionId>(
    PAD_DEFAULTS.progression,
  );
  const [energyArc, setEnergyArc] = useState(PAD_DEFAULTS.energyArc);
  const [trailArrivals, setTrailArrivals] = useState(
    PAD_DEFAULTS.trailArrivals,
  );
  const [navigationSounds, setNavigationSounds] = useState(
    PAD_DEFAULTS.navigationSounds,
  );
  const [bassPedal, setBassPedal] = useState(PAD_DEFAULTS.bassPedal);
  const [trailVoices, setTrailVoices] = useState(PAD_DEFAULTS.trailVoices);
  const [crossings, setCrossings] = useState<CrossingFlavor>(
    PAD_DEFAULTS.crossings,
  );
  const [swells, setSwells] = useState(PAD_DEFAULTS.swells);
  const [choralTimbre, setChoralTimbre] = useState(
    PAD_DEFAULTS.choralTimbre,
  );
  const [readout, setReadout] = useState({
    notes: 0,
    soloist: null as number | null,
    avgVelocity: 0,
    chord: "Dm",
    energy: 0,
    homeTones: [] as Array<{
      trailIndex: number;
      hz: number;
      band: RegisterBand | null;
    }>,
  });

  useEffect(() => {
    modeRef.current = mode;
    engineRef.current?.setConfig({ mode });
  }, [mode]);

  useEffect(() => {
    chordRotationRef.current = chordRotation;
    energyArcRef.current = energyArc;
    progressionRef.current = progression;
    engineRef.current?.setConfig({ chordRotation, energyArc, progression });
  }, [chordRotation, energyArc, progression]);

  useEffect(() => {
    trailArrivalsRef.current = trailArrivals;
    navigationSoundsRef.current = navigationSounds;
    bassPedalRef.current = bassPedal;
    engineRef.current?.setConfig({
      trailArrivals,
      navigationSounds,
      bassPedal,
    });
  }, [trailArrivals, navigationSounds, bassPedal]);

  useEffect(() => {
    trailVoicesRef.current = trailVoices;
    crossingsRef.current = crossings;
    engineRef.current?.setConfig({ trailVoices, crossings });
  }, [trailVoices, crossings]);

  useEffect(() => {
    swellsRef.current = swells;
    choralTimbreRef.current = choralTimbre;
    engineRef.current?.setConfig({ swells, choralTimbre });
  }, [swells, choralTimbre]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      const engine = new SoundEngine();
      await engine.init();
      engine.setConfig({
        mode: modeRef.current,
        chordRotation: chordRotationRef.current,
        progression: progressionRef.current,
        energyArc: energyArcRef.current,
        trailArrivals: trailArrivalsRef.current,
        navigationSounds: navigationSoundsRef.current,
        bassPedal: bassPedalRef.current,
        trailVoices: trailVoicesRef.current,
        crossings: crossingsRef.current,
        swells: swellsRef.current,
        choralTimbre: choralTimbreRef.current,
      });
      engine.setVolume(volume);
      const canvas = canvasRef.current;
      engine.setCanvasWidth(canvas?.clientWidth ?? window.innerWidth);
      engineRef.current = engine;
    } else {
      await engineRef.current.resume();
    }
    return engineRef.current;
  }, [volume]);

  useEffect(() => {
    onEngineReady?.(ensureEngine);
  }, [onEngineReady, ensureEngine]);

  const handleAudition = useCallback(
    async (accent: AuditionAccent) => {
      // Auditioning is often the first thing pressed on a cold page, so the
      // engine may not exist yet and its context may still be suspended.
      const engine = await ensureEngine();
      engine.audition(accent);
    },
    [ensureEngine],
  );

  const frame = useCallback(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const elapsedMs = performance.now() - startedAtRef.current;

    const frames: TrailSoundFrame[] = [];

    const cursor = cursorRef.current;
    if (cursor.inside) {
      const prev = cursor.points[cursor.points.length - 1];
      frames.push({
        trailIndex: CURSOR_TRAIL_INDEX,
        x: cursor.x,
        y: cursor.y,
        prevX: prev?.x ?? cursor.x,
        prevY: prev?.y ?? cursor.y,
        cursorType: "default",
        progress: 0,
        color: "#3d3833",
        isNewlyActive: cursor.points.length === 0,
        identityKey: "pad-cursor",
      });
      cursor.points.push({ x: cursor.x, y: cursor.y });
      if (cursor.points.length > TRAIL_LENGTH) cursor.points.shift();
    }

    for (const agent of agentsRef.current) {
      const prevX = agent.x;
      const prevY = agent.y;
      stepAgent(agent, width, height);
      frames.push({
        trailIndex: agent.trailIndex,
        x: agent.x,
        y: agent.y,
        prevX,
        prevY,
        cursorType: "default",
        progress: 0,
        color: agent.color,
        isNewlyActive: agent.points.length <= 1,
        // Stands in for the participant id real trails carry, so each pad
        // agent gets its own fingerprint rather than sharing one by colour.
        identityKey: agent.identityKey,
      });
    }

    engine.tick(elapsedMs, frames);

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

      const soloist = engine.getSoloistTrailIndex();
      for (const agent of agentsRef.current) {
        drawTrail(
          ctx,
          agent.points,
          agent.color,
          soloist === agent.trailIndex,
        );
      }
      if (cursor.inside) {
        drawTrail(
          ctx,
          cursor.points,
          "#3d3833",
          soloist === CURSOR_TRAIL_INDEX,
        );
      }
    }

    setReadout({
      notes: engine.getActiveNoteCount(),
      soloist: engine.getSoloistTrailIndex(),
      avgVelocity: engine.getSceneAverageVelocity(),
      chord: engine.getCurrentChordName(),
      energy: engine.getEnergy(),
      homeTones: frames
        .map(({ trailIndex }) => ({
          trailIndex,
          hz: engine.getHomeTone(trailIndex),
          band: engine.getRegisterBand(trailIndex),
        }))
        .filter(
          (
            entry,
          ): entry is {
            trailIndex: number;
            hz: number;
            band: RegisterBand | null;
          } => entry.hz !== null,
        ),
    });

    rafRef.current = requestAnimationFrame(frame);
  }, []);

  const handleStart = useCallback(async () => {
    await ensureEngine();
    if (rafRef.current !== null) return;
    startedAtRef.current = performance.now();
    setRunning(true);
    rafRef.current = requestAnimationFrame(frame);
  }, [ensureEngine, frame]);

  const handleStop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setRunning(false);
    engineRef.current?.reset();
  }, []);

  const handleAddAgent = useCallback(() => {
    const canvas = canvasRef.current;
    const width = canvas?.clientWidth ?? 800;
    const agent = createAgent(
      nextTrailIndexRef.current++,
      width,
      PAD_HEIGHT,
    );
    agentsRef.current.push(agent);
    setAgentCount(agentsRef.current.length);
  }, []);

  const handleAddMany = useCallback(() => {
    for (let i = 0; i < 5; i++) handleAddAgent();
  }, [handleAddAgent]);

  const handleRemoveAgent = useCallback(() => {
    const removed = agentsRef.current.pop();
    if (removed) engineRef.current?.retireTrail(removed.trailIndex);
    setAgentCount(agentsRef.current.length);
  }, []);

  const handleClearAgents = useCallback(() => {
    for (const agent of agentsRef.current) {
      engineRef.current?.retireTrail(agent.trailIndex);
    }
    agentsRef.current = [];
    setAgentCount(0);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      cursorRef.current.x = e.clientX - rect.left;
      cursorRef.current.y = e.clientY - rect.top;
      cursorRef.current.inside = true;
    },
    [],
  );

  const handlePointerLeave = useCallback(() => {
    cursorRef.current.inside = false;
    cursorRef.current.points = [];
    engineRef.current?.retireTrail(CURSOR_TRAIL_INDEX);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      engineRef.current?.dispose();
      engineRef.current = null;
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
        Trail Pad — sustained vs spotlight vs notes
      </div>
      <div style={{ ...labelStyle, marginBottom: "12px" }}>
        Start the pad, then move your cursor over it. Add wandering trails to
        hear how a dense scene behaves. The fastest outlier becomes the soloist
        (ringed on canvas): in spotlight mode it lifts and brightens while the
        rest of the sustained voices duck behind it; in notes mode the crowd
        drops to a darker, sparser register.
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
          {running ? "stop" : "start pad"}
        </button>
        <button
          onClick={() => setMode("sustained")}
          style={mode === "sustained" ? buttonActiveStyle : buttonStyle}
        >
          sustained (current)
        </button>
        <button
          onClick={() => setMode("spotlight")}
          style={mode === "spotlight" ? buttonActiveStyle : buttonStyle}
        >
          sustained + spotlight
        </button>
        <button
          onClick={() => setMode("notes")}
          style={mode === "notes" ? buttonActiveStyle : buttonStyle}
        >
          notes (prototype)
        </button>
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
          onClick={() => setChordRotation((v) => !v)}
          style={chordRotation ? buttonActiveStyle : buttonStyle}
        >
          chord rotation
        </button>
        <button
          onClick={() => setEnergyArc((v) => !v)}
          style={energyArc ? buttonActiveStyle : buttonStyle}
        >
          energy arc
        </button>
        <button
          onClick={() => setTrailArrivals((v) => !v)}
          style={trailArrivals ? buttonActiveStyle : buttonStyle}
        >
          trail arrivals
        </button>
        <button
          onClick={() => setBassPedal((v) => !v)}
          style={bassPedal ? buttonActiveStyle : buttonStyle}
        >
          bass pedal
        </button>
        <button
          onClick={() => setNavigationSounds((v) => !v)}
          style={navigationSounds ? buttonActiveStyle : buttonStyle}
        >
          navigation notes
        </button>
        <button
          onClick={() => setTrailVoices((v) => !v)}
          style={trailVoices ? buttonActiveStyle : buttonStyle}
        >
          trail voices
        </button>
        <button
          onClick={() => setSwells((v) => !v)}
          style={swells ? buttonActiveStyle : buttonStyle}
        >
          swells
        </button>
        <button
          onClick={() => setChoralTimbre((v) => !v)}
          style={choralTimbre ? buttonActiveStyle : buttonStyle}
        >
          choral timbre
        </button>
        <span style={labelStyle}>
          each composes with any mode above — trail voices also sets each
          trail's register from its colour (cool low, warm high)
        </span>
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
        <span style={labelStyle}>progression</span>
        <select
          value={progression}
          onChange={(e) => setProgression(e.target.value as ProgressionId)}
          style={{
            ...buttonStyle,
            // Native select arrow, so the control reads as a picker rather
            // than as another one of the toggle buttons beside it.
            appearance: "auto",
          }}
        >
          {PROGRESSION_IDS.map((id) => (
            <option key={id} value={id}>
              {PROGRESSIONS[id].label} — {PROGRESSIONS[id].description}
            </option>
          ))}
        </select>
        <span style={labelStyle}>
          {chordRotation
            ? PROGRESSIONS[progression].description
            : "turn chord rotation on to hear it cycle"}
        </span>
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
        <span style={labelStyle}>crossings</span>
        {(["off", "dissonance", "merge"] as const).map((flavor) => (
          <button
            key={flavor}
            onClick={() => setCrossings(flavor)}
            style={crossings === flavor ? buttonActiveStyle : buttonStyle}
          >
            {flavor}
          </button>
        ))}
        <span style={labelStyle}>
          merge rings the two trails' home tones and briefly pulls their
          timbres together — needs trail voices on to hear the pull. dissonance
          sounds tension that resolves, picking a shimmer, a suspension or the
          harsh tritone depending on how busy the scene is.
        </span>
      </div>

      <div style={{ marginTop: "20px" }}>
        <div style={{ ...labelStyle, marginBottom: "4px", color: "#3d3833" }}>
          Accent Sounds
        </div>
        <div style={{ ...labelStyle, marginBottom: "10px" }}>
          Hear each accent on its own, at the current chord. Does not require
          the matching toggle above.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: "8px",
          }}
        >
          {AUDITION_CARDS.map((card) => (
            <div
              key={card.accent}
              style={{
                border: "1px solid #e0dbd4",
                background: "#faf7f2",
                padding: "10px",
              }}
            >
              <button
                onClick={() => handleAudition(card.accent)}
                style={{ ...buttonStyle, width: "100%" }}
              >
                {card.label}
              </button>
              <div
                style={{ ...labelStyle, marginTop: "8px", lineHeight: 1.4 }}
              >
                {card.description}
              </div>
            </div>
          ))}
        </div>
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
        <button onClick={handleAddAgent} style={buttonStyle}>
          + trail
        </button>
        <button onClick={handleAddMany} style={buttonStyle}>
          + 5 trails
        </button>
        <button onClick={handleRemoveAgent} style={buttonStyle}>
          − trail
        </button>
        <button onClick={handleClearAgents} style={buttonStyle}>
          clear
        </button>
        <span style={labelStyle}>{agentCount} wandering</span>
      </div>

      <div style={{ marginBottom: "12px" }}>
        <label style={labelStyle}>
          volume {volume.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{
              marginLeft: "12px",
              verticalAlign: "middle",
              width: "200px",
            }}
          />
        </label>
      </div>

      <canvas
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{
          width: "100%",
          height: `${PAD_HEIGHT}px`,
          border: "1px solid #e0dbd4",
          background: "#f5f0e8",
          display: "block",
          cursor: "crosshair",
          touchAction: "none",
        }}
      />

      <div style={{ ...labelStyle, marginTop: "8px" }}>
        {mode === "notes"
          ? `notes sounding: ${readout.notes} | soloist: ${
              readout.soloist === null ? "none" : `trail ${readout.soloist}`
            } | scene avg velocity: ${readout.avgVelocity.toFixed(2)} px/frame`
          : mode === "spotlight"
            ? `sustained voices + spotlight | soloist: ${
                readout.soloist === null ? "none" : `trail ${readout.soloist}`
              } | scene avg velocity: ${readout.avgVelocity.toFixed(
                2,
              )} px/frame`
            : "sustained mode — one continuous voice per trail"}
      </div>
      <div style={labelStyle}>
        chord: {readout.chord}
        {chordRotation
          ? ` (${PROGRESSIONS[progression].label})`
          : " (fixed)"}{" "}
        | energy:{" "}
        {energyArc ? readout.energy.toFixed(3) : "off"}
      </div>
      {trailVoices && readout.homeTones.length > 0 && (
        <div style={labelStyle}>
          home tones:{" "}
          {readout.homeTones
            .map(
              ({ trailIndex, hz, band }) =>
                `${trailIndex}:${hz.toFixed(1)}Hz${band ? `/${band}` : ""}`,
            )
            .join(" ")}
        </div>
      )}
    </div>
  );
};
