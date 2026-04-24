// ABOUTME: Sound playground for experimenting with cursor instrument sounds
// ABOUTME: Interactive page to audition each cursor type, chord voicing, and trail crossing dissonance
import React, { useState, useRef, useCallback, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { InstrumentConfig } from "./sound/types";
import { CURSOR_INSTRUMENTS, CLICK_BELL, getInstrument } from "./sound/instruments";

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

function playBell(ctx: AudioContext, dest: AudioNode, frequency: number): void {
  const now = ctx.currentTime;
  const instrument = CLICK_BELL;

  const osc = ctx.createOscillator();
  osc.type = instrument.oscillatorType;
  osc.frequency.value = frequency;

  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = frequency * 3;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(instrument.gain, now + instrument.attack);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    now + instrument.attack + instrument.release,
  );

  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0, now);
  gain2.gain.linearRampToValueAtTime(
    instrument.gain * 0.3,
    now + instrument.attack,
  );
  gain2.gain.exponentialRampToValueAtTime(
    0.001,
    now + instrument.attack + instrument.release / 2,
  );

  osc.connect(gain);
  osc2.connect(gain2);
  gain.connect(dest);
  gain2.connect(dest);

  osc.start(now);
  osc2.start(now);
  osc.stop(now + instrument.attack + instrument.release + 0.1);
  osc2.stop(now + instrument.attack + instrument.release + 0.1);
}

const SoundPlayground = () => {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const [selectedCursor, setSelectedCursor] = useState<string>("default");
  const [chordVoicing, setChordVoicing] = useState(false);
  const [activeNote, setActiveNote] = useState<string | null>(null);

  const ensureAudio = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0.7;
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      masterGainRef.current = gain;
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return { ctx: ctxRef.current, dest: masterGainRef.current! };
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

  const handlePlayBell = useCallback(
    (freq: number) => {
      const { ctx, dest } = ensureAudio();
      playBell(ctx, dest, freq);
    },
    [ensureAudio],
  );

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
          Bell sounds triggered by click events (D minor pentatonic, octave 4-5)
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
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<SoundPlayground />);
