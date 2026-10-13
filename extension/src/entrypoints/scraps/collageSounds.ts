// ABOUTME: Small synthesized paper-and-scissors sounds for collage actions (lift, place, cut, flip, ...).
// ABOUTME: Built on the fly with Web Audio, so nothing is downloaded; muting is remembered per browser.

export type CollageSound =
  | "pickup"
  | "place"
  | "snap"
  | "rotate"
  | "flip"
  | "cutout"
  | "crop"
  | "duplicate"
  | "delete"
  | "undo"
  | "redo"
  | "layerUp"
  | "layerDown"
  | "paper";

const MUTED_KEY = "wwo-collage-sounds-muted";

/** The last level an exponential ramp can reach; it cannot reach zero. */
const FLOOR = 0.0001;

/** Overall level, under the trail sounds' bells so a collage stays quiet. */
const MASTER_GAIN = 0.7;

/** D minor pentatonic from D3, the scale the trail sounds use. */
const SCALE = [146.83, 174.61, 196.0, 220.0, 261.63]
  .flatMap((f) => [f, f * 2, f * 4])
  .sort((a, b) => a - b);
const note = (i: number) => SCALE[Math.max(0, Math.min(SCALE.length - 1, i))];

let context: AudioContext | null = null;
let master: GainNode | null = null;
let reverbSend: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let mutedCache: boolean | null = null;

export function collageSoundsMuted(): boolean {
  if (mutedCache === null) {
    try {
      mutedCache = localStorage.getItem(MUTED_KEY) === "1";
    } catch {
      mutedCache = false;
    }
  }
  return mutedCache;
}

export function setCollageSoundsMuted(muted: boolean): void {
  mutedCache = muted;
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // Private windows can refuse storage; the choice still holds this visit.
  }
}

function audio(): AudioContext | null {
  if (context) {
    if (context.state === "suspended") void context.resume();
    return context;
  }
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
  if (!Ctor) return null;
  const ctx = new Ctor();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(compressor);
  compressor.connect(ctx.destination);

  // A short room made from decaying noise, for the bells.
  const length = Math.floor(ctx.sampleRate * 1.6);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
  }
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse;
  reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.35;
  reverbSend.connect(reverb);
  reverb.connect(master);

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++)
    noiseData[i] = Math.random() * 2 - 1;

  context = ctx;
  return ctx;
}

/** A small random pitch offset, in cents, so repeats are never identical. */
const jitter = (cents = 25) =>
  Math.pow(2, ((Math.random() * 2 - 1) * cents) / 1200);

function envelope(
  gain: GainNode,
  t: number,
  attack: number,
  decay: number,
  level: number,
) {
  gain.gain.setValueAtTime(FLOOR, t);
  gain.gain.exponentialRampToValueAtTime(level, t + attack);
  gain.gain.exponentialRampToValueAtTime(FLOOR, t + attack + decay);
  gain.gain.linearRampToValueAtTime(0, t + attack + decay + 0.04);
}

function output(ctx: AudioContext, gain: GainNode, pan: number, wet: number) {
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  gain.connect(panner);
  panner.connect(master!);
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    gain.connect(send);
    send.connect(reverbSend!);
  }
}

interface ToneOptions {
  type?: OscillatorType;
  f: number;
  /** Pitch the tone glides to over its whole length. */
  f2?: number;
  a?: number;
  d?: number;
  v?: number;
  at?: number;
  pan?: number;
  lp?: number;
  wet?: number;
}

function tone(ctx: AudioContext, o: ToneOptions) {
  const {
    type = "sine",
    f,
    f2,
    a = 0.004,
    d = 0.2,
    v = 0.3,
    at = 0,
    pan = 0,
    lp,
    wet = 0,
  } = o;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, f), t);
  if (f2)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + a + d);
  envelope(gain, t, a, d, v);
  if (lp) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lp;
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }
  output(ctx, gain, pan, wet);
  osc.start(t);
  osc.stop(t + a + d + 0.08);
}

interface NoiseOptions {
  type?: BiquadFilterType;
  f: number;
  /** Filter frequency the burst sweeps to over its length. */
  f2?: number;
  q?: number;
  a?: number;
  d?: number;
  v?: number;
  at?: number;
  pan?: number;
}

function noise(ctx: AudioContext, o: NoiseOptions) {
  const {
    type = "bandpass",
    f,
    f2,
    q = 1,
    a = 0.002,
    d = 0.08,
    v = 0.3,
    at = 0,
    pan = 0,
  } = o;
  const t = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer;
  source.playbackRate.value = 0.8 + Math.random() * 0.4;
  filter.type = type;
  filter.frequency.setValueAtTime(f, t);
  filter.Q.value = q;
  if (f2) filter.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  envelope(gain, t, a, d, v);
  source.connect(filter);
  filter.connect(gain);
  output(ctx, gain, pan, 0);
  source.start(t, Math.random() * 0.5);
  source.stop(t + a + d + 0.05);
}

/** The trail sounds' soft sine bell, with a quiet octave above it. */
function bell(
  ctx: AudioContext,
  f: number,
  at = 0,
  v = 0.1,
  d = 0.35,
  pan = 0,
) {
  tone(ctx, { f, a: 0.004, d, v, at, pan, wet: 0.6 });
  tone(ctx, {
    f: f * 2.01,
    a: 0.002,
    d: d * 0.35,
    v: v * 0.25,
    at,
    pan,
    wet: 0.4,
  });
}

/** Felt thunk of paper landing on the table. */
const thunk = (ctx: AudioContext, pan: number, v = 0.45) =>
  noise(ctx, { type: "lowpass", f: 480, a: 0.002, d: 0.06, v, pan });
const slap = (ctx: AudioContext, pan: number, v = 0.12) =>
  noise(ctx, { f: 2200, q: 1.2, a: 0.001, d: 0.025, v, pan });

/** One scissor stroke: the blades slide through crackling paper, then close. */
function shear(ctx: AudioContext, at: number, length: number, pan: number) {
  noise(ctx, {
    f: 2000,
    f2: 5600,
    q: 1.4,
    a: length * 0.75,
    d: length * 0.25,
    v: 0.2,
    at,
    pan,
  });
  const crackles = Math.max(3, Math.round(length / 0.02));
  for (let i = 0; i < crackles; i++) {
    noise(ctx, {
      f: 900 + Math.random() * 1800,
      q: 4,
      a: 0.001,
      d: 0.008,
      v: 0.06 + Math.random() * 0.05,
      at: at + (i / crackles) * length,
      pan,
    });
  }
  noise(ctx, {
    f: 6800,
    q: 5,
    a: 0.001,
    d: 0.012,
    v: 0.45,
    at: at + length,
    pan,
  });
  tone(ctx, {
    type: "triangle",
    f: 3150 * jitter(),
    a: 0.001,
    d: 0.03,
    v: 0.022,
    at: at + length,
    pan,
  });
}

/** Paper lifting free once it is cut. */
const lift = (ctx: AudioContext, at: number, pan: number) =>
  noise(ctx, { f: 1800, f2: 5000, q: 0.8, a: 0.04, d: 0.06, v: 0.1, at, pan });

type Voice = (ctx: AudioContext, pan: number) => void;

const VOICES: Record<CollageSound, Voice> = {
  pickup: (ctx, pan) => {
    noise(ctx, { f: 2600, f2: 6000, q: 0.8, a: 0.01, d: 0.07, v: 0.14, pan });
    tone(ctx, { f: note(10) * jitter(), a: 0.003, d: 0.08, v: 0.04, pan });
  },
  // A tap on the table: a thunk with a short wooden pluck.
  place: (ctx, pan) => {
    thunk(ctx, pan, 0.35);
    slap(ctx, pan, 0.14);
    tone(ctx, {
      type: "triangle",
      f: 330 * jitter(),
      f2: 255,
      a: 0.001,
      d: 0.06,
      v: 0.16,
      lp: 2500,
      pan,
    });
  },
  // A small magnetic catch.
  snap: (ctx, pan) => {
    thunk(ctx, pan, 0.25);
    tone(ctx, { f: 900 * jitter(), f2: 600, a: 0.001, d: 0.03, v: 0.06, pan });
  },
  rotate: (ctx, pan) => {
    for (let i = 0; i < 3; i++) {
      noise(ctx, {
        f: 3800,
        q: 6,
        a: 0.001,
        d: 0.012,
        v: 0.35,
        at: i * 0.028,
        pan,
      });
    }
  },
  flip: (ctx, pan) => {
    noise(ctx, { f: 900, f2: 4500, q: 1.2, a: 0.03, d: 0.1, v: 0.25, pan });
    noise(ctx, {
      type: "lowpass",
      f: 600,
      a: 0.002,
      d: 0.05,
      v: 0.3,
      at: 0.13,
      pan,
    });
  },
  // Paper tearing along the cut, then the piece lifting free.
  cutout: (ctx, pan) => {
    for (let i = 0; i < 22; i++) {
      noise(ctx, {
        f: 700 + Math.random() * 2600,
        q: 3,
        a: 0.001,
        d: 0.012 + Math.random() * 0.02,
        v: 0.1 + Math.random() * 0.14,
        at: i * 0.016 + Math.random() * 0.006,
        pan,
      });
    }
    noise(ctx, { f: 1500, f2: 3800, q: 0.9, a: 0.25, d: 0.08, v: 0.08, pan });
    lift(ctx, 0.4, pan);
  },
  crop: (ctx, pan) => shear(ctx, 0, 0.09, pan),
  // Peeling a copy off the original.
  duplicate: (ctx, pan) => {
    noise(ctx, { f: 6000, f2: 1800, q: 1, a: 0.01, d: 0.12, v: 0.14, pan });
    tone(ctx, {
      f: 600 * jitter(),
      f2: 220,
      a: 0.002,
      d: 0.05,
      v: 0.11,
      at: 0.12,
      pan,
    });
    thunk(ctx, pan, 0.25);
  },
  // Crumpled and tossed.
  delete: (ctx, pan) => {
    for (let i = 0; i < 9; i++) {
      noise(ctx, {
        f: 1200 + Math.random() * 4000,
        q: 3,
        a: 0.001,
        d: 0.02 + Math.random() * 0.03,
        v: 0.25 + Math.random() * 0.2,
        at: i * 0.028 + Math.random() * 0.01,
        pan,
      });
    }
    tone(ctx, {
      f: note(6),
      f2: note(1),
      a: 0.004,
      d: 0.3,
      v: 0.07,
      at: 0.05,
      pan,
      wet: 0.3,
    });
  },
  undo: (ctx) => {
    noise(ctx, { f: 5000, f2: 1200, q: 1, a: 0.12, d: 0.03, v: 0.12 });
    [9, 7, 5].forEach((n, i) => bell(ctx, note(n), 0.04 + i * 0.055, 0.09));
  },
  redo: (ctx) => {
    noise(ctx, { f: 1200, f2: 5000, q: 1, a: 0.12, d: 0.03, v: 0.12 });
    [5, 7, 9].forEach((n, i) => bell(ctx, note(n), 0.04 + i * 0.055, 0.09));
  },
  layerUp: (ctx, pan) => {
    noise(ctx, { f: 2000, f2: 4000, a: 0.01, d: 0.05, v: 0.1, pan });
    bell(ctx, note(10), 0, 0.07, 0.25, pan);
  },
  layerDown: (ctx, pan) => {
    noise(ctx, { f: 3000, f2: 1400, a: 0.01, d: 0.05, v: 0.1, pan });
    bell(ctx, note(4), 0, 0.07, 0.25, pan);
  },
  paper: (ctx) => {
    for (let i = 0; i < 5; i++) {
      noise(ctx, {
        f: 1800 + Math.random() * 3000,
        q: 0.7,
        a: 0.03,
        d: 0.08,
        v: 0.12,
        at: i * 0.06,
      });
    }
  },
};

/**
 * Plays one collage action's sound. `pan` runs from -1 (left) to 1 (right),
 * usually where the piece sits in the frame. Call it only from a person's own
 * action: browsers start audio only after a gesture.
 */
export function playCollageSound(sound: CollageSound, pan = 0): void {
  if (collageSoundsMuted()) return;
  try {
    const ctx = audio();
    if (!ctx) return;
    VOICES[sound](ctx, Math.max(-0.8, Math.min(0.8, pan)));
  } catch {
    // Sound is decoration; a refused or broken audio context never stops an edit.
  }
}
