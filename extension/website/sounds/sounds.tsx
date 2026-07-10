// ABOUTME: Sound playground for experimenting with cursor instrument sounds
// ABOUTME: Interactive page to audition each cursor type, chord voicing, and trail crossing dissonance
import React, { useState, useRef, useCallback, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { InstrumentConfig } from "../shared/sound/types";
import { CURSOR_INSTRUMENTS, getInstrument } from "../shared/sound/instruments";
import { SoundEngine } from "../shared/sound/SoundEngine";
import { RippleEffect, RippleSettings } from "../shared/components/ClickRipple";
import { ClickEffect } from "../shared/types";

const RANDOM_RIPPLE_COLORS = [
  "#4a9a8a", // teal
  "#c4724e", // rust
  "#5b8db8", // blue
  "#d4b85c", // gold
];

const PLAYGROUND_RIPPLE_SETTINGS: RippleSettings = {
  clickMinRadius: 12,
  clickMaxRadius: 80,
  clickCoreRadius: 3,
  clickMinDuration: 500,
  clickMaxDuration: 2500,
  clickExpansionDuration: 2400,
  clickStrokeWidth: 4,
  clickOpacity: 0.3,
  clickNumRings: 3,
  clickRingDelayMs: 160,
  clickAnimationStopPoint: 0.45,
};

const D_MINOR_PENTATONIC = [
  { note: "D3", freq: 146.83 },
  { note: "F3", freq: 174.61 },
  { note: "G3", freq: 196.0 },
  { note: "A3", freq: 220.0 },
  { note: "C4", freq: 261.63 },
  { note: "D4", freq: 293.66 },
  { note: "F4", freq: 349.23 },
  { note: "G4", freq: 392.0 },
  { note: "A4", freq: 440.0 },
  { note: "C5", freq: 523.25 },
];

const DISSONANCE_INTERVALS = [
  { name: "Minor 2nd", ratio: 16 / 15, description: "Tense, close" },
  { name: "Tritone", ratio: Math.SQRT2, description: "Unstable, eerie" },
];

const CURSOR_TYPES = ["default", "pointer", "text", "grab", "grabbing", "crosshair", "move"];

const styles = {
  page: {
    fontFamily: "'Atkinson Hyperlegible', sans-serif",
    background: "#faf7f2",
    color: "#3d3833",
    minHeight: "100vh",
    padding: "40px",
    maxWidth: "800px",
    margin: "0 auto",
  } as React.CSSProperties,
  title: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic" as const,
    fontWeight: 200,
    fontSize: "28px",
    marginBottom: "8px",
  } as React.CSSProperties,
  subtitle: {
    fontSize: "13px",
    color: "#8a8279",
    marginBottom: "32px",
    fontFamily: "'Martian Mono', monospace",
  } as React.CSSProperties,
  section: {
    marginBottom: "32px",
  } as React.CSSProperties,
  sectionTitle: {
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
    marginBottom: "12px",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "11px",
  } as React.CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "8px",
  } as React.CSSProperties,
  card: {
    padding: "12px 16px",
    border: "1px solid #e0dbd4",
    background: "#f5f0e8",
    cursor: "pointer",
    transition: "background 0.1s",
    userSelect: "none" as const,
  } as React.CSSProperties,
  cardActive: {
    background: "#3d3833",
    color: "#faf7f2",
  } as React.CSSProperties,
  cardName: {
    fontFamily: "'Martian Mono', monospace",
    fontSize: "12px",
    fontWeight: 400,
    marginBottom: "4px",
  } as React.CSSProperties,
  cardDetail: {
    fontSize: "11px",
    color: "#8a8279",
  } as React.CSSProperties,
  noteRow: {
    display: "flex",
    gap: "4px",
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  noteButton: {
    padding: "8px 12px",
    border: "1px solid #e0dbd4",
    background: "#f5f0e8",
    cursor: "pointer",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "11px",
    minWidth: "48px",
    textAlign: "center" as const,
  } as React.CSSProperties,
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
    fontSize: "13px",
  } as React.CSSProperties,
};

function playInstrument(
  ctx: AudioContext,
  dest: AudioNode,
  instrument: InstrumentConfig,
  frequency: number,
  withFifth: boolean,
): void {
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = instrument.oscillatorType;
  osc.frequency.value = frequency;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = instrument.filterFrequency;
  filter.Q.value = instrument.filterQ;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(instrument.gain, now + instrument.attack);
  gain.gain.linearRampToValueAtTime(
    instrument.gain * instrument.sustain,
    now + instrument.attack + instrument.decay,
  );
  gain.gain.linearRampToValueAtTime(
    0.001,
    now + instrument.attack + instrument.decay + instrument.release,
  );

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.start(now);
  osc.stop(now + instrument.attack + instrument.decay + instrument.release + 0.1);

  if (withFifth) {
    const fifthOsc = ctx.createOscillator();
    fifthOsc.type = instrument.oscillatorType;
    fifthOsc.frequency.value = frequency * 1.5;

    const fifthGain = ctx.createGain();
    fifthGain.gain.setValueAtTime(0, now);
    fifthGain.gain.linearRampToValueAtTime(
      instrument.gain * 0.6,
      now + instrument.attack,
    );
    fifthGain.gain.linearRampToValueAtTime(
      instrument.gain * instrument.sustain * 0.6,
      now + instrument.attack + instrument.decay,
    );
    fifthGain.gain.linearRampToValueAtTime(
      0.001,
      now + instrument.attack + instrument.decay + instrument.release,
    );

    fifthOsc.connect(filter);
    fifthGain.connect(dest);
    fifthOsc.connect(fifthGain);
    fifthOsc.start(now);
    fifthOsc.stop(now + instrument.attack + instrument.decay + instrument.release + 0.1);
  }
}

function playDissonance(
  ctx: AudioContext,
  dest: AudioNode,
  baseFreq: number,
  ratio: number,
): void {
  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = baseFreq;

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = baseFreq * ratio;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(dest);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 2.1);
  osc2.stop(now + 2.1);
}

// Click bells route through SoundEngine.triggerClick so the playground
// always reflects the production click-bell behavior.

const SoundPlayground = () => {
  const ctxRef = useRef<AudioContext | null>(null);
  const driverGainRef = useRef<GainNode | null>(null);
  const engineRef = useRef<SoundEngine | null>(null);
  const [selectedCursor, setSelectedCursor] = useState<string>("default");
  const [chordVoicing, setChordVoicing] = useState(false);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [bellHoldMs, setBellHoldMs] = useState(0);
  const [ripples, setRipples] = useState<ClickEffect[]>([]);

  const ensureAudio = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0.7;
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      driverGainRef.current = gain;
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return { ctx: ctxRef.current, dest: driverGainRef.current! };
  }, []);

  const handlePlayNote = useCallback(
    (noteInfo: { note: string; freq: number }) => {
      const { ctx, dest } = ensureAudio();
      const instrument = getInstrument(selectedCursor);
      playInstrument(ctx, dest, instrument, noteInfo.freq, chordVoicing);
      setActiveNote(noteInfo.note);
      setTimeout(() => setActiveNote(null), 300);
    },
    [selectedCursor, chordVoicing, ensureAudio],
  );

  const handlePlayCursor = useCallback(
    (cursorType: string) => {
      const { ctx, dest } = ensureAudio();
      const instrument = getInstrument(cursorType);
      // Play A3 (220Hz) as reference pitch
      playInstrument(ctx, dest, instrument, 220, chordVoicing);
      setSelectedCursor(cursorType);
    },
    [chordVoicing, ensureAudio],
  );

  const handlePlayDissonance = useCallback(
    (ratio: number) => {
      const { ctx, dest } = ensureAudio();
      playDissonance(ctx, dest, 293.66, ratio); // D4 base
    },
    [ensureAudio],
  );

  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      const engine = new SoundEngine();
      await engine.init();
      engine.setCanvasWidth(window.innerWidth);
      engineRef.current = engine;
    } else {
      engineRef.current.resume();
    }
    return engineRef.current;
  }, []);

  const handlePlayBell = useCallback(
    async (freq: number) => {
      const engine = await ensureEngine();
      // Map frequency → vertical y so SoundEngine.triggerClick picks the
      // matching pitch from its bell scale.
      const BELL_SCALE = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33];
      const idx = BELL_SCALE.indexOf(freq);
      const pitchRatio =
        idx >= 0 ? (BELL_SCALE.length - 1 - idx) / BELL_SCALE.length : 0;
      const y = pitchRatio * (window.innerHeight || 800);
      engine.triggerClick({
        x: window.innerWidth / 2,
        y,
        holdDuration: bellHoldMs > 0 ? bellHoldMs : undefined,
      });
    },
    [ensureEngine, bellHoldMs],
  );

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleRippleComplete = useCallback((id: string) => {
    setRipples((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handlePlayRandomRipple = useCallback(async () => {
    const engine = await ensureEngine();
    // Pin ripple to viewport center so it's easy to validate.
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    const color =
      RANDOM_RIPPLE_COLORS[
        Math.floor(Math.random() * RANDOM_RIPPLE_COLORS.length)
      ];
    const holdDuration = bellHoldMs > 0 ? bellHoldMs : undefined;

    engine.triggerClick({ x, y, holdDuration });

    const effect: ClickEffect = {
      id: `playground-${Date.now()}-${Math.random()}`,
      x,
      y,
      color,
      radiusFactor: Math.random(),
      durationFactor: Math.random(),
      startTime: Date.now(),
      trailIndex: 0,
      holdDuration,
    };
    setRipples((prev) => [...prev, effect]);
  }, [ensureEngine, bellHoldMs]);

  // Keyboard: number keys 1-9,0 play notes
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const keyMap: Record<string, number> = {
        "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
        "6": 5, "7": 6, "8": 7, "9": 8, "0": 9,
      };
      const idx = keyMap[e.key];
      if (idx !== undefined && D_MINOR_PENTATONIC[idx]) {
        handlePlayNote(D_MINOR_PENTATONIC[idx]);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handlePlayNote]);

  const selectedInstrument = getInstrument(selectedCursor);

  return (
    <>
      <svg
        width={typeof window !== "undefined" ? window.innerWidth : 1000}
        height={typeof window !== "undefined" ? window.innerHeight : 1000}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        {ripples.map((r) => (
          <RippleEffect
            key={r.id}
            effect={r}
            settings={PLAYGROUND_RIPPLE_SETTINGS}
            onComplete={handleRippleComplete}
          />
        ))}
      </svg>
    <div style={styles.page}>
      <div style={styles.title}>sound playground</div>
      <div style={styles.subtitle}>
        experiment with cursor instruments in D minor pentatonic
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Instruments by Cursor Type</div>
        <div style={{ fontSize: "12px", color: "#8a8279", marginBottom: "8px" }}>
          Click to audition each cursor type at A3 (220Hz)
        </div>
        <div style={styles.grid}>
          {CURSOR_TYPES.map((type) => {
            const inst = CURSOR_INSTRUMENTS[type];
            const isSelected = selectedCursor === type;
            return (
              <div
                key={type}
                onClick={() => handlePlayCursor(type)}
                style={{
                  ...styles.card,
                  ...(isSelected ? styles.cardActive : {}),
                  cursor: type,
                }}
              >
                <div style={styles.cardName}>{type}</div>
                <div
                  style={{
                    ...styles.cardDetail,
                    ...(isSelected ? { color: "#b0a99f" } : {}),
                  }}
                >
                  {inst.oscillatorType} | {inst.filterFrequency}Hz | atk{" "}
                  {inst.attack}s | rel {inst.release}s
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          Scale — {selectedCursor} instrument
        </div>
        <div style={styles.toggle}>
          <label>
            <input
              type="checkbox"
              checked={chordVoicing}
              onChange={(e) => setChordVoicing(e.target.checked)}
              style={{ marginRight: "6px" }}
            />
            Chord voicing (root + fifth)
          </label>
        </div>
        <div style={{ fontSize: "12px", color: "#8a8279", marginBottom: "8px" }}>
          Keys 1-0 to play. Currently using: {selectedInstrument.oscillatorType},{" "}
          filter {selectedInstrument.filterFrequency}Hz
        </div>
        <div style={styles.noteRow}>
          {D_MINOR_PENTATONIC.map((n, i) => (
            <div
              key={n.note}
              onClick={() => handlePlayNote(n)}
              style={{
                ...styles.noteButton,
                ...(activeNote === n.note
                  ? { background: "#3d3833", color: "#faf7f2" }
                  : {}),
              }}
            >
              <div>{n.note}</div>
              <div style={{ fontSize: "9px", color: "#8a8279" }}>{i + 1}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Click Bells</div>
        <div style={{ fontSize: "12px", color: "#8a8279", marginBottom: "8px" }}>
          Bell sounds via SoundEngine.triggerClick (production path).
          Each tap = exactly one bell.
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "#8a8279",
            marginBottom: "12px",
            fontFamily: "'Martian Mono', monospace",
          }}
        >
          <label>
            hold: {bellHoldMs}ms
            <input
              type="range"
              min={0}
              max={2500}
              step={50}
              value={bellHoldMs}
              onChange={(e) => setBellHoldMs(Number(e.target.value))}
              style={{
                marginLeft: "12px",
                verticalAlign: "middle",
                width: "200px",
              }}
            />
          </label>
        </div>
        <div style={styles.noteRow}>
          {[
            { note: "D4", freq: 293.66 },
            { note: "F4", freq: 349.23 },
            { note: "G4", freq: 392.0 },
            { note: "A4", freq: 440.0 },
            { note: "C5", freq: 523.25 },
            { note: "D5", freq: 587.33 },
          ].map((n) => (
            <div
              key={n.note}
              onClick={() => handlePlayBell(n.freq)}
              style={styles.noteButton}
            >
              {n.note}
            </div>
          ))}
        </div>
        <div style={{ marginTop: "16px" }}>
          <button
            onClick={handlePlayRandomRipple}
            style={{
              ...styles.noteButton,
              padding: "10px 16px",
              border: "1px solid #3d3833",
              cursor: "pointer",
              background: "#3d3833",
              color: "#faf7f2",
              fontFamily: "'Martian Mono', monospace",
              fontSize: "11px",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            play random click + ripple
          </button>
          <span
            style={{
              marginLeft: "12px",
              fontSize: "11px",
              color: "#8a8279",
            }}
          >
            one bell, one ripple — same path AnimatedClicks uses
          </span>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Trail Crossing Dissonance</div>
        <div style={{ fontSize: "12px", color: "#8a8279", marginBottom: "8px" }}>
          Triggered when two cursor trails pass near each other. Base note: D4
        </div>
        <div style={styles.grid}>
          {DISSONANCE_INTERVALS.map((interval) => (
            <div
              key={interval.name}
              onClick={() => handlePlayDissonance(interval.ratio)}
              style={styles.card}
            >
              <div style={styles.cardName}>{interval.name}</div>
              <div style={styles.cardDetail}>
                {interval.description} | ratio: {interval.ratio.toFixed(4)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<SoundPlayground />);
