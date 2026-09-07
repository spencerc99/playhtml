// ABOUTME: Tests audio-graph transitions in the movement visualization sound engine.
// ABOUTME: Verifies cursor timbre changes crossfade without stacking full-level oscillators.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESENCE_TUNING, haloPitch, SoundEngine } from "../SoundEngine";
import {
  CLICK_BELL,
  CURSOR_INSTRUMENTS,
  getInstrument,
} from "../instruments";
import { SOUND_LAYERS, SoundNotice } from "../types";
import {
  bellScaleForChord,
  chordTones,
  CHORD_DWELL_MS,
  CHORD_PROGRESSION,
  D_MINOR_PENTATONIC,
  foldPitchIntoBand,
  isPitchInCollection,
  leadHomeTone,
  PROGRESSIONS,
  RegisterBand,
  REGISTER_BAND_RANGES,
} from "../scales";

type ParamEvent = {
  method: "cancelAndHold" | "exponentialRamp" | "linearRamp" | "set";
  value?: number;
  time: number;
};

class TestAudioParam {
  value = 0;
  events: ParamEvent[] = [];

  cancelAndHoldAtTime(time: number): void {
    this.events.push({ method: "cancelAndHold", time });
  }

  cancelScheduledValues(): void {}

  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push({ method: "exponentialRamp", value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ method: "linearRamp", value, time });
  }

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.events.push({ method: "set", value, time });
  }
}

/** Every node built during a test, so a test can inspect the whole graph. */
let createdNodes: TestAudioNode[] = [];

class TestAudioNode {
  connections: TestAudioNode[] = [];

  constructor() {
    createdNodes.push(this);
  }

  connect(destination: TestAudioNode): TestAudioNode {
    this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections = [];
  }
}

class TestGainNode extends TestAudioNode {
  gain = new TestAudioParam();
}

class TestOscillatorNode extends TestAudioNode {
  type: OscillatorType = "sine";
  frequency = new TestAudioParam();
  detune = new TestAudioParam();
  startTimes: number[] = [];
  stopTimes: Array<number | undefined> = [];
  onended: (() => void) | null = null;

  start(time = 0): void {
    this.startTimes.push(time);
  }

  stop(time?: number): void {
    this.stopTimes.push(time);
  }
}

class TestBiquadFilterNode extends TestAudioNode {
  type: BiquadFilterType = "lowpass";
  frequency = new TestAudioParam();
  Q = new TestAudioParam();
}

class TestStereoPannerNode extends TestAudioNode {
  pan = new TestAudioParam();
}

class TestDynamicsCompressorNode extends TestAudioNode {
  threshold = new TestAudioParam();
  knee = new TestAudioParam();
  ratio = new TestAudioParam();
  attack = new TestAudioParam();
  release = new TestAudioParam();
}

class TestConvolverNode extends TestAudioNode {
  buffer: AudioBuffer | null = null;
}

class TestBufferSourceNode extends TestAudioNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  startTimes: number[] = [];
  stopTimes: Array<number | undefined> = [];
  onended: (() => void) | null = null;

  start(time = 0): void {
    this.startTimes.push(time);
  }

  stop(time?: number): void {
    this.stopTimes.push(time);
  }
}

class TestAudioContext {
  currentTime = 1;
  destination = new TestAudioNode();
  sampleRate = 100;
  state: AudioContextState = "running";
  gains: TestGainNode[] = [];
  oscillators: TestOscillatorNode[] = [];
  bufferSources: TestBufferSourceNode[] = [];

  createBufferSource(): AudioBufferSourceNode {
    const source = new TestBufferSourceNode();
    this.bufferSources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  get nodes(): TestAudioNode[] {
    return createdNodes;
  }

  createBiquadFilter(): BiquadFilterNode {
    return new TestBiquadFilterNode() as unknown as BiquadFilterNode;
  }

  createBuffer(channels: number, length: number): AudioBuffer {
    // One array per channel, retained — the percussion noise buffer is filled
    // after creation, so a throwaway array would hide whether it was written.
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel],
    } as unknown as AudioBuffer;
  }

  createConvolver(): ConvolverNode {
    return new TestConvolverNode() as unknown as ConvolverNode;
  }

  createDynamicsCompressor(): DynamicsCompressorNode {
    return new TestDynamicsCompressorNode() as unknown as DynamicsCompressorNode;
  }

  createGain(): GainNode {
    const gain = new TestGainNode();
    this.gains.push(gain);
    return gain as unknown as GainNode;
  }

  createOscillator(): OscillatorNode {
    const oscillator = new TestOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }

  createStereoPanner(): StereoPannerNode {
    return new TestStereoPannerNode() as unknown as StereoPannerNode;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }
}

/** Mirrors SWELL_TUNING.onsetMs, which is private to the engine. */
const SWELL_ONSET_MS = 800;

const originalAudioContext = globalThis.AudioContext;
let context: TestAudioContext;

beforeEach(() => {
  createdNodes = [];
  context = new TestAudioContext();
  globalThis.AudioContext = class {
    constructor() {
      return context;
    }
  } as unknown as typeof AudioContext;
});

afterEach(() => {
  globalThis.AudioContext = originalAudioContext;
});

/**
 * Assert a pitch is some octave transposition of a palette tone. Register
 * bands voice a chord tone in the part a trail's colour assigns it, so the
 * pitch class is what stays inside the chord, not the literal frequency.
 */
function expectPitchClassInPalette(pitch: number, palette: number[]): void {
  const matches = palette.some((tone) => {
    const octaves = Math.log2(pitch / tone);
    return Math.abs(octaves - Math.round(octaves)) < 1e-6;
  });
  expect(
    matches,
    `${pitch}Hz is not an octave of any tone in [${palette.join(", ")}]`,
  ).toBe(true);
}

function soloFrame(trailIndex: number, x: number, y: number) {
  return {
    trailIndex,
    x,
    y,
    prevX: x,
    prevY: y,
    cursorType: "default",
    progress: 0,
    color: "#000",
    isNewlyActive: false,
  };
}

describe("cursor type aliases", () => {
  it("voices aliased cursor types as the pointer they name", async () => {
    // `auto` is the commonest value in recorded browsing and means the same
    // arrow `default` does, so the two must stay the same instrument rather
    // than `auto` landing on the fallback by accident.
    expect(getInstrument("auto")).toBe(CURSOR_INSTRUMENTS.default);
    expect(getInstrument("all-scroll")).toBe(CURSOR_INSTRUMENTS.move);
    expect(getInstrument("default")).toBe(CURSOR_INSTRUMENTS.default);

    // An unmapped value still falls back, and that fallback is not the arrow —
    // which is the divergence the alias exists to protect `auto` from.
    const unknown = getInstrument("zoom-in");
    expect(unknown).not.toBe(CURSOR_INSTRUMENTS.default);
    expect(getInstrument(undefined)).toBe(unknown);
  });
});

describe("SoundEngine cursor instruments", () => {
  it("does not restart the master gain ramp when trail count is unchanged", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const frame = {
      trailIndex: 0,
      x: 0,
      y: 0,
      prevX: 0,
      prevY: 0,
      cursorType: "pointer",
      progress: 0,
      color: "#000",
      isNewlyActive: true,
    };
    engine.tick(0, [frame]);
    const masterGainEvents = context.gains[0].gain.events;
    const eventCount = masterGainEvents.length;

    context.currentTime += 1 / 60;
    engine.tick(100, [frame]);

    expect(masterGainEvents).toHaveLength(eventCount);
  });

  it("updates continuous voice parameters at audio control rate", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);

    const frame = (x: number) => ({
      trailIndex: 0,
      x,
      y: 0,
      prevX: 0,
      prevY: 0,
      cursorType: "pointer",
      progress: 0,
      color: "#000",
      isNewlyActive: false,
    });
    engine.tick(0, [frame(0)]);
    context.currentTime += 1 / 60;
    engine.tick(100, [frame(10)]);

    const state = engine as unknown as {
      voices: Map<
        number,
        { gainNode: TestGainNode; panNode: TestStereoPannerNode }
      >;
    };
    const voice = state.voices.get(0)!;
    const gainEventCount = voice.gainNode.gain.events.length;
    const panEventCount = voice.panNode.pan.events.length;

    context.currentTime += 1 / 60;
    engine.tick(200, [frame(20)]);

    expect(voice.gainNode.gain.events).toHaveLength(gainEventCount);
    expect(voice.panNode.pan.events).toHaveLength(panEventCount);

    context.currentTime += 0.05;
    engine.tick(300, [frame(30)]);

    expect(voice.gainNode.gain.events.length).toBeGreaterThan(gainEventCount);
    expect(voice.panNode.pan.events.length).toBeGreaterThan(panEventCount);
  });

  it("crossfades both oscillators when the cursor timbre changes", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);
    engine.setConfig({ cursorInstruments: true, chordVoicing: true });

    engine.tick(0, [
      {
        trailIndex: 0,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0,
        color: "#000",
        isNewlyActive: true,
      },
    ]);
    engine.tick(100, [
      {
        trailIndex: 0,
        x: 10,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0.1,
        color: "#000",
        isNewlyActive: false,
      },
    ]);

    const previousPrimary = context.oscillators[0];
    const previousFifth = context.oscillators[1];

    engine.tick(200, [
      {
        trailIndex: 0,
        x: 20,
        y: 0,
        prevX: 10,
        prevY: 0,
        cursorType: "auto",
        progress: 0.2,
        color: "#000",
        isNewlyActive: false,
      },
    ]);

    const currentPrimary = context.oscillators[2];
    const currentFifth = context.oscillators[3];
    const previousPrimaryLevel = previousPrimary.connections[0];
    const previousFifthLevel = previousFifth.connections[0];
    const currentPrimaryLevel = currentPrimary.connections[0];
    const currentFifthLevel = currentFifth.connections[0];

    for (const level of [previousPrimaryLevel, previousFifthLevel]) {
      expect(level).toBeInstanceOf(TestGainNode);
      expect((level as TestGainNode).gain.events).toContainEqual(
        expect.objectContaining({ method: "linearRamp", value: 0 }),
      );
    }
    for (const level of [currentPrimaryLevel, currentFifthLevel]) {
      expect(level).toBeInstanceOf(TestGainNode);
      expect((level as TestGainNode).gain.events).toContainEqual(
        expect.objectContaining({ method: "set", value: 0 }),
      );
      expect((level as TestGainNode).gain.events).toContainEqual(
        expect.objectContaining({ method: "linearRamp", value: 1 }),
      );
    }
  });

  it("reuses a faded voice when a live trail resumes", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);

    engine.tick(0, [
      {
        trailIndex: 0,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0,
        color: "#000",
        isNewlyActive: true,
      },
    ]);
    engine.tick(100, [
      {
        trailIndex: 0,
        x: 10,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0.5,
        color: "#000",
        isNewlyActive: false,
      },
    ]);
    engine.tick(200, []);
    engine.tick(300, [
      {
        trailIndex: 0,
        x: 20,
        y: 0,
        prevX: 10,
        prevY: 0,
        cursorType: "pointer",
        progress: 0.6,
        color: "#000",
        isNewlyActive: false,
      },
    ]);

    for (let cycle = 0; cycle < 100; cycle++) {
      context.currentTime += 0.1;
      engine.tick(400 + cycle * 200, []);
      context.currentTime += 0.1;
      engine.tick(500 + cycle * 200, [
        {
          trailIndex: 0,
          x: 21 + cycle,
          y: 0,
          prevX: 20 + cycle,
          prevY: 0,
          cursorType: "pointer",
          progress: 0.6,
          color: "#000",
          isNewlyActive: false,
        },
      ]);
    }

    expect(context.oscillators).toHaveLength(2);
    expect(context.oscillators[0].stopTimes).toEqual([]);
    expect(context.oscillators[1].stopTimes).toEqual([]);
  });

  it("retires all state for a finished live trail", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);
    engine.setConfig({ crossingDissonance: true });

    engine.tick(0, [
      {
        trailIndex: 7,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0,
        color: "#000",
        isNewlyActive: true,
      },
    ]);
    engine.tick(100, [
      {
        trailIndex: 7,
        x: 10,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0.5,
        color: "#000",
        isNewlyActive: false,
      },
    ]);

    const primaryLevel = context.oscillators[0].connections[0];
    const state = engine as unknown as {
      voices: Map<number, unknown>;
      prevPositions: Map<number, unknown>;
      trailPaths: Map<number, unknown>;
      crossingCooldowns: Map<string, number>;
    };
    state.crossingCooldowns.set("7-path-2", 100);
    state.crossingCooldowns.set("2-path-7", 100);

    engine.retireTrail(7);

    expect(state.voices.has(7)).toBe(false);
    expect(state.prevPositions.has(7)).toBe(false);
    expect(state.trailPaths.has(7)).toBe(false);
    expect(state.crossingCooldowns).toEqual(new Map());
    expect(primaryLevel.connections).not.toEqual([]);

    context.oscillators[0].onended?.();

    expect(primaryLevel.connections).toEqual([]);
  });

  it("normalizes movement gain across delayed animation frames", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);

    engine.tick(0, [
      {
        trailIndex: 0,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0,
        color: "#000",
        isNewlyActive: true,
      },
    ]);

    context.currentTime += 1 / 60;
    engine.tick(100, [
      {
        trailIndex: 0,
        x: 4,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0.1,
        color: "#000",
        isNewlyActive: false,
      },
    ]);

    const state = engine as unknown as {
      voices: Map<number, { gainNode: TestGainNode }>;
    };
    const gain = state.voices.get(0)!.gainNode.gain;
    const regularFrameTarget = gain.events.at(-1)?.value;

    context.currentTime += 0.25;
    engine.tick(350, [
      {
        trailIndex: 0,
        x: 8,
        y: 0,
        prevX: 4,
        prevY: 0,
        cursorType: "pointer",
        progress: 0.2,
        color: "#000",
        isNewlyActive: false,
      },
    ]);

    const delayedFrameTarget = gain.events.at(-1)?.value;
    expect(delayedFrameTarget).toBeLessThan(regularFrameTarget! / 2);
  });

  it("promotes a lone fast trail with no other trail to compare against", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    // A single cursor sweeping steadily. The candidate must not be measured
    // against a scene average that includes its own samples, or the bar rises
    // with the very speed being measured and nothing is ever promoted.
    for (let step = 0; step < 20; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, step * 12, 0)]);
    }

    expect(engine.getSoloistTrailIndex()).toBe(0);
  });

  it("promotes one fast trail among slower ones", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 10 + step * 12, 10),
        soloFrame(1, 10 + step * 2, 50),
        soloFrame(2, 10 + step * 2, 90),
        soloFrame(3, 10 + step * 2, 130),
      ]);
    }

    expect(engine.getSoloistTrailIndex()).toBe(0);
  });

  it("leaves non-soloist filters on their instrument default", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 10 + step * 12, 10),
        soloFrame(1, 10 + step * 2, 50),
        soloFrame(2, 10 + step * 2, 90),
        soloFrame(3, 10 + step * 2, 130),
      ]);
    }

    const state = engine as unknown as {
      voices: Map<number, { filterNode: TestBiquadFilterNode }>;
    };
    expect(engine.getSoloistTrailIndex()).toBe(0);

    // Ducked voices keep their timbre — only their gain moves. Any automation
    // on their cutoff is the "muffled everything" bug.
    for (const index of [1, 2, 3]) {
      expect(state.voices.get(index)!.filterNode.frequency.events).toEqual([]);
    }
    expect(
      state.voices.get(0)!.filterNode.frequency.events.length,
    ).toBeGreaterThan(0);
  });

  it("never darkens the soloist below its instrument cutoff", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    // Fast enough to promote, slow enough that a low mapping floor would pull
    // the cutoff down rather than open it.
    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, step * 5, 0)]);
    }

    const state = engine as unknown as {
      voices: Map<number, { filterNode: TestBiquadFilterNode }>;
    };
    const events = state.voices.get(0)!.filterNode.frequency.events;
    const ramps = events.filter((event) => event.method === "linearRamp");
    expect(ramps.length).toBeGreaterThan(0);
    for (const ramp of ramps) {
      expect(ramp.value).toBeGreaterThanOrEqual(2000);
    }
  });

  it("restores the instrument cutoff once a soloist is demoted", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 10 + step * 12, 10),
        soloFrame(1, 10 + step * 2, 50),
        soloFrame(2, 10 + step * 2, 90),
        soloFrame(3, 10 + step * 2, 130),
      ]);
    }
    expect(engine.getSoloistTrailIndex()).toBe(0);

    const state = engine as unknown as {
      voices: Map<number, { filterNode: TestBiquadFilterNode }>;
    };
    const events = state.voices.get(0)!.filterNode.frequency.events;

    // Trail 0 slows to match the crowd, so it stops being an outlier. The
    // hysteresis holds the spotlight through the deceleration, so the ramp
    // count is measured from the frame the demotion actually lands on.
    let demotedCount: number | null = null;
    for (let step = 40; step < 90; step++) {
      const beforeTick = events.length;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 490 + (step - 40) * 2, 10),
        soloFrame(1, 10 + step * 2, 50),
        soloFrame(2, 10 + step * 2, 90),
        soloFrame(3, 10 + step * 2, 130),
      ]);
      if (demotedCount === null && engine.getSoloistTrailIndex() === null) {
        demotedCount = beforeTick;
      }
    }

    expect(engine.getSoloistTrailIndex()).toBeNull();
    // Exactly one ramp back to the default instrument cutoff (2000 Hz), not a
    // fresh ramp every frame while demoted.
    const afterDemotion = events.slice(demotedCount!);
    const ramps = afterDemotion.filter(
      (event) => event.method === "linearRamp",
    );
    expect(ramps).toHaveLength(1);
    expect(ramps[0].value).toBe(2000);
  });

  it("keeps spotlight filter ramps longer than the control interval", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, step * 12, 0)]);
    }

    const state = engine as unknown as {
      voices: Map<number, { filterNode: TestBiquadFilterNode }>;
    };
    const events = state.voices.get(0)!.filterNode.frequency.events;
    const holds = events.filter((event) => event.method === "cancelAndHold");

    // Consecutive ramps must still be in flight when the next is scheduled.
    // A ramp that lands before its successor is scheduled leaves a held step,
    // and a staircase of held steps is the audible crackle.
    for (let i = 1; i < holds.length; i++) {
      const gapSeconds = holds[i].time - holds[i - 1].time;
      expect(gapSeconds).toBeLessThan(0.12);
    }
  });

  it("glides a voice's pitch from where it sounds rather than stepping", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);

    const frame = (x: number) => ({
      trailIndex: 0,
      x,
      y: 0,
      prevX: 0,
      prevY: 0,
      cursorType: "pointer",
      progress: 0,
      color: "#000",
      isNewlyActive: false,
    });

    // Several notes, far enough apart in time that each is a fresh pitch move.
    engine.tick(0, [frame(0)]);
    for (let step = 1; step <= 6; step++) {
      context.currentTime += 0.2;
      engine.tick(step * 200, [frame(step * 15)]);
    }

    const state = engine as unknown as {
      voices: Map<number, { oscillator: TestOscillatorNode }>;
    };
    const events = state.voices.get(0)!.oscillator.frequency.events;

    const ramps = events.filter((event) => event.method === "exponentialRamp");
    expect(ramps.length).toBeGreaterThan(0);

    // Every pitch ramp must be preceded by a hold at the ramp's own start, so
    // the curve interpolates from the pitch actually sounding. Without it the
    // ramp is measured from the previous automation event — already long past
    // — and the pitch steps instantly, which is the click.
    for (const ramp of ramps) {
      const rampIndex = events.indexOf(ramp);
      const preceding = events[rampIndex - 1];
      expect(preceding?.method).toBe("cancelAndHold");
      expect(preceding.time).toBeLessThan(ramp.time);
    }

    // Nothing may be written at the hold's instant afterwards: an explicit
    // anchor there would plant the jump the hold exists to avoid.
    for (const ramp of ramps) {
      const rampIndex = events.indexOf(ramp);
      const holdTime = events[rampIndex - 1].time;
      const setsAtHold = events.filter(
        (event) => event.method === "set" && event.time === holdTime,
      );
      expect(setsAtHold).toHaveLength(0);
    }
  });

  it("anchors the fifth's gain when chord voicing is toggled", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);
    engine.setConfig({ cursorInstruments: true, chordVoicing: true });

    const frame = (x: number) => ({
      trailIndex: 0,
      x,
      y: 0,
      prevX: 0,
      prevY: 0,
      cursorType: "pointer",
      progress: 0,
      color: "#000",
      isNewlyActive: false,
    });
    engine.tick(0, [frame(0)]);
    context.currentTime += 1 / 60;
    engine.tick(100, [frame(10)]);

    const state = engine as unknown as {
      voices: Map<number, { fifthGainNode: TestGainNode }>;
    };
    const fifthGain = state.voices.get(0)!.fifthGainNode.gain;
    const before = fifthGain.events.length;

    // Toggle twice, close enough together that the first fade is still in
    // flight when the second is scheduled.
    context.currentTime += 0.05;
    engine.setConfig({ chordVoicing: false });
    context.currentTime += 0.05;
    engine.setConfig({ chordVoicing: true });

    const added = fifthGain.events.slice(before);
    const ramps = added.filter((event) => event.method === "linearRamp");
    expect(ramps.length).toBeGreaterThan(0);

    // Each toggle must hold first, so the fade starts from the level the
    // fifth actually sits at rather than from the previous fade's endpoint.
    for (const ramp of ramps) {
      const preceding = added[added.indexOf(ramp) - 1];
      expect(preceding?.method).toBe("cancelAndHold");
    }
  });

  it("rings click bells from the fixed scale when rotation is off", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const before = context.oscillators.length;
    engine.triggerClick({ x: 10, y: 0, holdDuration: 0 });

    // Top of the pad maps to the top of the scale, unchanged from before the
    // progression existed.
    expect(context.oscillators[before].frequency.value).toBe(523.25);
  });

  it("rings click bells from the active chord while rotation is on", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setConfig({ chordRotation: true });

    const dmBells = bellScaleForChord(CHORD_PROGRESSION[0]);
    let before = context.oscillators.length;
    engine.triggerClick({ x: 10, y: 0, holdDuration: 0 });
    expect(context.oscillators[before].frequency.value).toBe(dmBells.at(-1));

    // Advance past the dwell so the progression moves to the next chord.
    engine.tick(CHORD_DWELL_MS + 1, []);

    const bbBells = bellScaleForChord(CHORD_PROGRESSION[1]);
    before = context.oscillators.length;
    engine.triggerClick({ x: 10, y: 0, holdDuration: 0 });
    const rung = context.oscillators[before].frequency.value;
    expect(rung).toBe(bbBells.at(-1));
    expect(rung).not.toBe(dmBells.at(-1));
  });

  it("starts a note flourish and ducks the sustained voice on promotion", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, step * 12, 0)]);
    }

    expect(engine.getSoloistTrailIndex()).toBe(0);
    // The promotion is carried by discrete notes, not by a louder drone.
    expect(engine.getActiveFlourishNoteCount()).toBeGreaterThan(0);

    const state = engine as unknown as {
      spotlightGains: Map<number, number>;
    };
    // Sustained voice sits below unity while flourishing rather than boosted.
    expect(state.spotlightGains.get(0)!).toBeLessThan(1);
    expect(state.spotlightGains.get(0)!).toBeGreaterThan(0.3);
  });

  it("promotes once through velocity oscillating around the threshold", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(4000);
    engine.setConfig({ mode: "spotlight" });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };

    // Velocity alternating fast/slow across the promote threshold every frame.
    // Without hysteresis this promotes and demotes repeatedly, and every one of
    // those flaps fires a resolving note and re-pays the anticipation gap.
    let x = 0;
    let promotions = 0;
    let demotions = 0;
    let previousSoloist: number | null = null;
    let resolvingNotes = 0;

    for (let step = 0; step < 120; step++) {
      x += step % 2 === 0 ? 14 : 3;
      context.currentTime += 1 / 60;
      const before = state.flourishNotes.size;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);

      const soloist = engine.getSoloistTrailIndex();
      if (soloist !== previousSoloist) {
        if (soloist === null) {
          demotions++;
          // A demotion adds its resolving note in the same tick.
          if (state.flourishNotes.size > before) resolvingNotes++;
        } else {
          promotions++;
        }
      }
      previousSoloist = soloist;
    }

    expect(promotions).toBe(1);
    expect(demotions).toBe(0);
    expect(resolvingNotes).toBe(0);
    expect(engine.getSoloistTrailIndex()).toBe(0);
  });

  it("holds the spotlight through a jittery accelerate-and-decelerate sweep", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(6000);
    engine.setConfig({ mode: "spotlight" });

    // Deterministic +/-30% jitter so the sweep looks like a real cursor rather
    // than a clean ramp.
    let seed = 12345;
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return 0.7 + 0.6 * (seed / 2147483648);
    };

    const frames = 90; // ~1.5s at 60fps
    let x = 0;
    let promotions = 0;
    let demotions = 0;
    let previousSoloist: number | null = null;
    let demotedAtFrame: number | null = null;

    for (let step = 0; step < frames; step++) {
      // 2 -> 20 -> 2 px/frame across the sweep.
      const ramp = 2 + 18 * Math.sin(Math.PI * (step / frames));
      x += ramp * jitter();
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);

      const soloist = engine.getSoloistTrailIndex();
      if (soloist !== previousSoloist) {
        if (soloist === null) {
          demotions++;
          demotedAtFrame ??= step;
        } else {
          promotions++;
        }
      }
      previousSoloist = soloist;
    }

    // One entrance, and no demotion while the sweep is still under way.
    expect(promotions).toBe(1);
    expect(demotions).toBe(0);
    expect(demotedAtFrame).toBeNull();
    expect(engine.getSoloistTrailIndex()).toBe(0);
  });

  it("emits a continuous note stream across an oscillating sweep", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(4000);
    engine.setConfig({ mode: "spotlight" });

    const state = engine as unknown as {
      flourishNotes: Set<unknown>;
    };

    let x = 0;
    let notes = 0;
    let longestGapFrames = 0;
    let framesSinceNote = 0;
    let promoted = false;

    for (let step = 0; step < 120; step++) {
      x += step % 2 === 0 ? 14 : 3;
      context.currentTime += 1 / 60;
      const before = state.flourishNotes.size;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);

      if (!promoted) {
        promoted = engine.getSoloistTrailIndex() !== null;
        continue;
      }
      if (state.flourishNotes.size > before) {
        notes++;
        longestGapFrames = Math.max(longestGapFrames, framesSinceNote);
        framesSinceNote = 0;
      } else {
        framesSinceNote++;
      }
    }

    // ~8.5px per frame of travel and a note every 50px means a note roughly
    // every 6 frames; a flap would open a much longer hole than that.
    expect(notes).toBeGreaterThan(10);
    expect(longestGapFrames).toBeLessThan(12);
  });

  it("carries blocked-interval distance over to the next note", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(8000);
    engine.setConfig({ mode: "spotlight" });

    const state = engine as unknown as {
      flourish: { distanceSinceNote: number } | null;
      flourishNotes: Set<unknown>;
    };

    // Promote on a steady sweep first.
    let x = 0;
    for (let step = 0; step < 40; step++) {
      x += 12;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }
    expect(engine.getSoloistTrailIndex()).toBe(0);

    // A single frame covering far more than one note's worth of distance while
    // the 70ms interval gate is closed. The travel must be banked, not
    // discarded — dropping it would open an audible hole in the run.
    const elapsedAtNote = 40 * 16;
    engine.tick(elapsedAtNote, [soloFrame(0, x, 0)]);
    const bankedBefore = state.flourish!.distanceSinceNote;

    x += 300;
    context.currentTime += 1 / 60;
    // Same elapsed time, so the interval gate is still shut for this travel.
    engine.tick(elapsedAtNote, [soloFrame(0, x, 0)]);

    expect(state.flourish!.distanceSinceNote).toBeGreaterThan(
      bankedBefore + 290,
    );

    // Once the gate opens the banked distance immediately fires a note.
    const before = state.flourishNotes.size;
    context.currentTime += 1 / 60;
    engine.tick(elapsedAtNote + 100, [soloFrame(0, x, 0)]);
    expect(state.flourishNotes.size).toBeGreaterThan(before);
  });

  it("draws flourish notes from the active chord palette under rotation", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight", chordRotation: true });

    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, step * 12, 0)]);
    }

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };
    const palette = CHORD_PROGRESSION[0].pitches;
    const pitches = [...state.flourishNotes].map(
      (note) => note.oscillator.frequency.value,
    );

    expect(pitches.length).toBeGreaterThan(0);
    // Every note is a palette pitch, possibly shifted up by one of the
    // quantized register steps (two-semitone increments up to a major
    // third — the window the register ceiling now allows).
    const registerSteps = [0, 1, 2].map((step) => 2 ** (step / 6));
    for (const pitch of pitches) {
      const inPalette = palette.some((p) =>
        registerSteps.some((step) => Math.abs(p * step - pitch) < 0.01),
      );
      expect(inPalette).toBe(true);
    }
  });

  it("resolves and restores the sustained voice on demotion", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 10 + step * 12, 10),
        soloFrame(1, 10 + step * 2, 50),
        soloFrame(2, 10 + step * 2, 90),
        soloFrame(3, 10 + step * 2, 130),
      ]);
    }
    expect(engine.getSoloistTrailIndex()).toBe(0);

    const state = engine as unknown as {
      spotlightGains: Map<number, number>;
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };
    for (let step = 40; step < 90; step++) {
      // The hysteresis holds the spotlight through the deceleration, so the
      // run keeps playing until the demotion actually lands. Clearing before
      // every tick leaves the demotion's own note as the only survivor.
      state.flourishNotes.clear();
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 490 + (step - 40) * 2, 10),
        soloFrame(1, 10 + step * 2, 50),
        soloFrame(2, 10 + step * 2, 90),
        soloFrame(3, 10 + step * 2, 130),
      ]);
      if (engine.getSoloistTrailIndex() === null) break;
    }

    expect(engine.getSoloistTrailIndex()).toBeNull();

    // Demotion fires exactly one resolving note, on the chord root an octave
    // up from the palette's lowest pitch (D3 -> D4 = 293.66).
    const resolving = [...state.flourishNotes];
    expect(resolving).toHaveLength(1);
    expect(resolving[0].oscillator.frequency.value).toBeCloseTo(293.66, 2);

    // The sustained voice walks back toward unity once the flourish ends.
    expect(state.spotlightGains.get(0)!).toBeGreaterThan(0.55);
  });

  it("caps concurrent flourish notes under sustained fast movement", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(4000);
    engine.setConfig({ mode: "spotlight" });

    // A long, fast sweep: far more note triggers than the budget allows, so
    // the cap is what keeps the graph bounded.
    for (let step = 0; step < 400; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, step * 40, 0)]);
      expect(engine.getActiveFlourishNoteCount()).toBeLessThanOrEqual(16);
    }
  });

  it("sounds one arrival per trail and debounces a flickering trail", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const state = engine as unknown as { flourishNotes: Set<unknown> };

    // A trail appearing sounds a chime cluster.
    engine.tick(0, [soloFrame(0, 10, 10)]);
    const chimeNotes = state.flourishNotes.size;
    expect(chimeNotes).toBeGreaterThanOrEqual(3);
    expect(chimeNotes).toBeLessThanOrEqual(5);

    // Staying present does not retrigger.
    for (let step = 1; step < 20; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, 10 + step, 10)]);
    }
    expect(state.flourishNotes.size).toBe(chimeNotes);

    // Dropping out and back inside the debounce window stays silent, even
    // though the frame reports itself as newly active.
    context.currentTime += 1 / 60;
    engine.tick(400, []);
    context.currentTime += 1 / 60;
    engine.tick(500, [{ ...soloFrame(0, 40, 10), isNewlyActive: true }]);
    expect(state.flourishNotes.size).toBe(chimeNotes);

    // Past the 2s debounce it counts as a genuine new arrival. The same trail
    // chimes the same pattern, so the count doubles exactly.
    context.currentTime += 1 / 60;
    engine.tick(3000, [{ ...soloFrame(0, 40, 10), isNewlyActive: true }]);
    expect(state.flourishNotes.size).toBe(chimeNotes * 2);
  });

  it("caps a batch of arrivals rather than firing a volley", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const state = engine as unknown as { flourishNotes: Set<unknown> };

    // Thirty trails appearing on one frame, as on a day swap. Only the global
    // per-second budget worth of arrivals may sound; the rest drop silently.
    const batch = Array.from({ length: 30 }, (_, i) => soloFrame(i, i * 10, 10));
    engine.tick(0, batch);

    // Two arrivals per second, one chime cluster each — not thirty chimes.
    expect(state.flourishNotes.size).toBeGreaterThanOrEqual(2 * 3);
    expect(state.flourishNotes.size).toBeLessThanOrEqual(2 * 5);
  });

  it("stays silent on arrivals during and just after a reset", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    engine.tick(1000, [soloFrame(0, 10, 10)]);
    const state = engine as unknown as { flourishNotes: Set<unknown> };

    engine.reset();
    state.flourishNotes.clear();

    // The rebuilt scene repopulates immediately; none of it should sound.
    engine.tick(1100, [soloFrame(0, 10, 10), soloFrame(1, 20, 10)]);
    expect(state.flourishNotes.size).toBe(0);

    // Once the suppression window lapses, genuine arrivals resume.
    context.currentTime += 1 / 60;
    engine.tick(3000, [soloFrame(2, 30, 10)]);
    expect(state.flourishNotes.size).toBeGreaterThan(0);
  });

  it("sounds a departure when an arrived trail is retired", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const state = engine as unknown as { flourishNotes: Set<unknown> };
    engine.tick(0, [soloFrame(0, 10, 10)]);
    state.flourishNotes.clear();

    engine.retireTrail(0);
    expect(state.flourishNotes.size).toBe(3);

    // A trail that never arrived has nothing to depart from.
    state.flourishNotes.clear();
    engine.retireTrail(99);
    expect(state.flourishNotes.size).toBe(0);
  });

  it("chimes a soprano trail's arrival from the top of the palette, high and detuned", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };

    // Soprano is the reference register the chime was tuned in, so this is
    // the shipped high shimmer, unchanged by the per-band voicing.
    engine.tick(0, [
      { ...soloFrame(0, 10, 10), color: "#e04a2f", identityKey: "person-a" },
    ]);
    const notes = [...state.flourishNotes];
    expect(notes.length).toBeGreaterThanOrEqual(3);

    // The chime draws only from the top of the palette, at registerMultiplier
    // — so it rings above the sustained bed rather than inside it, and stays
    // in key. With rotation off the palette is the base D minor pentatonic.
    const top = [...D_MINOR_PENTATONIC]
      .sort((a, b) => a - b)
      .slice(-5)
      .map((hz) => hz * 1);
    for (const note of notes) {
      const hz = note.oscillator.frequency.value;
      const isChimeTone = top.some(
        (pitch) => Math.abs(pitch - hz) < 0.5 || Math.abs(pitch * 3 - hz) < 1.5,
      );
      expect(isChimeTone, `${hz} should be a chime tone or its partial`).toBe(
        true,
      );
      // Every note carries its own small detune, so the cluster shimmers.
      expect(Math.abs(note.oscillator.detune.value)).toBeLessThanOrEqual(5);
    }

    // Struck in sequence, not all at once — that spread is what makes it read
    // as a chime rather than as a chord.
    const starts = notes.map((note) => note.oscillator.startTimes[0]);
    expect(new Set(starts).size).toBeGreaterThan(1);
  });

  it("chimes a bass trail's arrival down in its own band, darker and longer", async () => {
    const chimeFor = async (color: string) => {
      const engine = new SoundEngine();
      await engine.init();
      engine.setCanvasWidth(1000);
      engine.setConfig({ trailArrivals: true });
      const state = engine as unknown as {
        flourishNotes: Set<{
          oscillator: TestOscillatorNode;
          peakGain: number;
          partialGainNode: TestGainNode;
        }>;
      };
      engine.tick(0, [
        { ...soloFrame(0, 10, 10), color, identityKey: "person-a" },
      ]);
      return [...state.flourishNotes];
    };

    // A blue trail sings bass, a red one soprano — same seed, same figure,
    // three octaves apart.
    const bass = await chimeFor("#0078bf");
    const soprano = await chimeFor("#e04a2f");
    expect(bass.length).toBe(soprano.length);

    const { minHz, maxHz } = REGISTER_BAND_RANGES.bass;
    for (const note of bass) {
      const hz = note.oscillator.frequency.value;
      // The chime's own notes land in the band; each also rings a 3x partial
      // above it, which is the timbre rather than the register.
      const fundamental = hz > maxHz ? hz / 3 : hz;
      expect(fundamental).toBeGreaterThanOrEqual(minHz);
      expect(fundamental).toBeLessThanOrEqual(maxHz);
    }

    // Same pitch classes as the soprano chime, dropped by whole octaves — the
    // same chime sung lower, not a different figure.
    const pitchClass = (hz: number) => {
      const octaves = Math.log2(hz / D_MINOR_PENTATONIC[0]);
      return Math.round((octaves - Math.floor(octaves)) * 1000);
    };
    expect(bass.map((n) => pitchClass(n.oscillator.frequency.value)).sort()).toEqual(
      soprano.map((n) => pitchClass(n.oscillator.frequency.value)).sort(),
    );

    // Duller and quieter: the 3x partial is stripped back and the peak pulled
    // down, so a low strike reads as woody rather than as a thin bell.
    expect(bass[0].peakGain).toBeLessThan(soprano[0].peakGain);
  });

  it("departs in the band it arrived in, after the trail's colour is gone", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };
    engine.tick(0, [
      { ...soloFrame(0, 10, 10), color: "#0078bf", identityKey: "person-a" },
    ]);
    state.flourishNotes.clear();

    // Retirement has no frame and therefore no colour: the band has to come
    // from what the trail chimed on the way in.
    engine.retireTrail(0);
    const notes = [...state.flourishNotes];
    expect(notes.length).toBeGreaterThan(0);

    const { minHz, maxHz } = REGISTER_BAND_RANGES.bass;
    for (const note of notes) {
      const hz = note.oscillator.frequency.value;
      const fundamental = hz > maxHz ? hz / 3 : hz;
      expect(fundamental).toBeGreaterThanOrEqual(minHz);
      expect(fundamental).toBeLessThanOrEqual(maxHz);
    }
  });

  it("chimes the same pattern for the same trail and differs across trails", async () => {
    const patternFor = async (identityKey: string) => {
      const engine = new SoundEngine();
      await engine.init();
      engine.setCanvasWidth(1000);
      engine.setConfig({ trailArrivals: true });
      const state = engine as unknown as {
        flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
      };
      engine.tick(0, [{ ...soloFrame(0, 10, 10), identityKey }]);
      return [...state.flourishNotes]
        .map((note) => note.oscillator.frequency.value)
        .sort((a, b) => a - b);
    };

    const first = await patternFor("person-a");
    const again = await patternFor("person-a");
    const other = await patternFor("person-b");

    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("falls rather than scatters on a departure", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };
    engine.tick(0, [{ ...soloFrame(0, 10, 10), identityKey: "person-a" }]);
    state.flourishNotes.clear();

    engine.retireTrail(0);
    const notes = [...state.flourishNotes].sort(
      (a, b) => a.oscillator.startTimes[0] - b.oscillator.startTimes[0],
    );
    expect(notes).toHaveLength(3);

    // Each note in the departure sits below the one before it, so the figure
    // reads as leaving. Fundamentals only — the 3x partials ride above.
    const fundamentals = notes
      .map((note) => note.oscillator.frequency.value)
      .filter((hz) => hz < 2000);
    for (let i = 1; i < fundamentals.length; i++) {
      expect(fundamentals[i]).toBeLessThan(fundamentals[i - 1]);
    }
  });

  it("makes no arrival sound while the toggle is off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const state = engine as unknown as { flourishNotes: Set<unknown> };
    engine.tick(0, [soloFrame(0, 10, 10)]);
    engine.retireTrail(0);
    expect(state.flourishNotes.size).toBe(0);
  });

  it("rings the navigation note on the chord root and rate-limits it", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ navigationSounds: true });

    engine.tick(0, []);
    let before = context.oscillators.length;
    engine.triggerNavigation({ x: 500 });

    // Fundamental plus two detuned partials plus an octave shimmer, on the
    // chord root D3 with the octave above it.
    const rung = context.oscillators.slice(before);
    expect(rung).toHaveLength(4);
    expect(rung[0].frequency.value).toBeCloseTo(146.83, 2);
    expect(rung[1].detune.value).toBeLessThan(0);
    expect(rung[2].detune.value).toBeGreaterThan(0);
    expect(rung[3].frequency.value).toBeCloseTo(146.83 * 2, 2);

    // A second navigation inside the rate limit is dropped entirely.
    before = context.oscillators.length;
    context.currentTime += 0.5;
    engine.triggerNavigation({ x: 500 });
    expect(context.oscillators).toHaveLength(before);

    // Past the limit it sounds again.
    context.currentTime += 2;
    engine.triggerNavigation({ x: 500 });
    expect(context.oscillators.length).toBeGreaterThan(before);
  });

  it("auditions every accent with its toggle off and without rate limiting", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const accents = [
      "trailArrival",
      "trailDeparture",
      "navigation",
      "soloistFlourish",
      "soloistResolve",
      "crossingShimmer",
      "crossingSuspension",
      "crossingHarsh",
      "crossingMerge",
      "trailVoicePair",
      "choralSwell",
    ] as const;

    for (const accent of accents) {
      const before = context.oscillators.length;
      engine.audition(accent);
      expect(
        context.oscillators.length,
        `${accent} should sound while its toggle is off`,
      ).toBeGreaterThan(before);
    }

    // Auditioning the navigation gong twice in a row must sound twice — the
    // rate limiter guards scenes, not explicit button presses.
    const beforeRepeat = context.oscillators.length;
    engine.audition("navigation");
    expect(context.oscillators.length).toBeGreaterThan(beforeRepeat);

    // Auditioning must not leave the instrument switched on behind it.
    const config = engine as unknown as {
      config: { navigationSounds?: boolean };
    };
    expect(config.config.navigationSounds).toBeFalsy();
  });

  it("keeps ringing navigation notes in views that never call tick", async () => {
    // The navigation views draw no trails, so tick() never runs there. The
    // rate limiter must read the audio clock rather than the render tick, or
    // every note after the first measures a zero-length gap and is dropped.
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ navigationSounds: true });

    let before = context.oscillators.length;
    engine.triggerNavigation({ x: 500 });
    expect(context.oscillators.length).toBeGreaterThan(before);

    before = context.oscillators.length;
    context.currentTime += 2;
    engine.triggerNavigation({ x: 500 });
    expect(context.oscillators.length).toBeGreaterThan(before);

    before = context.oscillators.length;
    context.currentTime += 2;
    engine.triggerNavigation({ x: 500 });
    expect(context.oscillators.length).toBeGreaterThan(before);
  });

  it("makes no navigation sound while the toggle is off", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const before = context.oscillators.length;
    engine.tick(0, []);
    engine.triggerNavigation({ x: 10 });
    expect(context.oscillators).toHaveLength(before);
  });

  it("holds one bass pedal voice and crossfades it on a chord change", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ bassPedal: true, chordRotation: true });

    engine.tick(0, []);
    expect(engine.getBassPedalVoiceCount()).toBe(1);

    const state = engine as unknown as {
      bassPedalVoices: Array<{
        oscillator: TestOscillatorNode;
        frequency: number;
      }>;
    };
    const firstVoice = state.bassPedalVoices[0];
    // Dm root D3, dropped an octave into D2.
    expect(firstVoice.frequency).toBeCloseTo(146.83 / 2, 2);

    // Advance past the dwell so the progression moves to Bb, whose palette
    // still roots on D3 — the pedal must not move for that.
    engine.tick(CHORD_DWELL_MS + 1, []);
    expect(state.bassPedalVoices[0].frequency).toBeCloseTo(146.83 / 2, 2);

    // F roots on F3, so the pedal does move, and does it by crossfading to a
    // fresh voice rather than sliding the pitch of the one already sounding.
    engine.tick(CHORD_DWELL_MS * 2 + 2, []);
    expect(engine.getBassPedalVoiceCount()).toBe(1);
    const movedVoice = state.bassPedalVoices[0];
    expect(movedVoice.frequency).toBeCloseTo(174.61 / 2, 2);
    expect(movedVoice.oscillator).not.toBe(firstVoice.oscillator);
    // The outgoing voice fades rather than being cut, and never glides.
    expect(firstVoice.oscillator.stopTimes.length).toBe(1);
    expect(firstVoice.oscillator.frequency.events).toHaveLength(0);
  });

  it("only re-ramps the pedal's level when that level actually moves", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    // The energy arc is what gives the pedal a moving level at all; without it
    // the level is a constant and any implementation passes.
    engine.setConfig({ bassPedal: true, energyArc: true });

    engine.tick(0, []);
    const state = engine as unknown as {
      bassPedalVoices: Array<{ gainNode: { gain: TestAudioParam } }>;
    };
    const gain = state.bassPedalVoices[0].gainNode.gain;
    const afterCreation = gain.events.length;

    // Ticks that do not move the energy follower far enough to change the
    // pedal's level must schedule nothing. Re-ramping on each of them cancels
    // the half-second glide still in flight and restarts it from wherever it
    // had reached, so the drone advances as a staircase of held values at the
    // tick rate — a periodic tick under the whole mix, and the louder the
    // scene the more the arc moves and the worse it gets.
    for (let tickMs = 16; tickMs <= 320; tickMs += 16) {
      engine.tick(tickMs, []);
    }

    expect(gain.events.length).toBe(afterCreation);
  });

  it("stays silent and holds no pedal voice while the toggle is off", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.tick(0, []);
    expect(engine.getBassPedalVoiceCount()).toBe(0);

    // Turning it on and back off releases the voice immediately, without
    // waiting for a tick that a paused canvas would never send.
    engine.setConfig({ bassPedal: true });
    engine.tick(100, []);
    expect(engine.getBassPedalVoiceCount()).toBe(1);

    engine.setConfig({ bassPedal: false });
    expect(engine.getBassPedalVoiceCount()).toBe(0);
  });

  it("derives a stable fingerprint per identity key and differs across keys", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true });

    const state = engine as unknown as {
      fingerprints: Map<
        number,
        {
          hash: number;
          detuneCents: number;
          vibratoRateHz: number;
          vibratoDepthCents: number;
          attackScale: number;
        }
      >;
    };

    const move = (trailIndex: number, identityKey: string, x: number) => ({
      ...soloFrame(trailIndex, x, 0),
      identityKey,
    });

    engine.tick(0, [move(0, "person-a", 0), move(1, "person-b", 100)]);
    context.currentTime += 1 / 60;
    engine.tick(16, [move(0, "person-a", 8), move(1, "person-b", 108)]);

    const first = { ...state.fingerprints.get(0)! };
    const other = state.fingerprints.get(1)!;

    // Same key, many frames later: still exactly the same voice.
    for (let step = 2; step < 30; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        move(0, "person-a", step * 8),
        move(1, "person-b", 100 + step * 8),
      ]);
    }
    expect(state.fingerprints.get(0)).toEqual(first);

    // Different keys land on different fingerprints.
    expect(other.hash).not.toBe(first.hash);
    expect(other.detuneCents).not.toBeCloseTo(first.detuneCents, 5);

    // Every derived value stays inside its declared range.
    for (const print of [first, other]) {
      expect(Math.abs(print.detuneCents)).toBeLessThanOrEqual(8);
      expect(print.vibratoRateHz).toBeGreaterThanOrEqual(3);
      expect(print.vibratoRateHz).toBeLessThanOrEqual(6);
      expect(print.vibratoDepthCents).toBeGreaterThanOrEqual(0);
      expect(print.vibratoDepthCents).toBeLessThanOrEqual(4);
      expect(print.attackScale).toBeGreaterThanOrEqual(0.7);
      expect(print.attackScale).toBeLessThanOrEqual(1.4);
    }
  });

  it("keeps a fingerprint keyed to identity rather than to trail index", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true });

    const state = engine as unknown as {
      fingerprints: Map<number, { hash: number }>;
    };

    // The same participant arriving at a different index — what a re-derived
    // trail array does — must sound the same, not take on a new voice.
    engine.tick(0, [{ ...soloFrame(0, 0, 0), identityKey: "person-a" }]);
    context.currentTime += 1 / 60;
    engine.tick(16, [{ ...soloFrame(0, 8, 0), identityKey: "person-a" }]);
    const atIndexZero = state.fingerprints.get(0)!.hash;

    engine.tick(32, [{ ...soloFrame(5, 0, 0), identityKey: "person-a" }]);
    context.currentTime += 1 / 60;
    engine.tick(48, [{ ...soloFrame(5, 8, 0), identityKey: "person-a" }]);

    expect(state.fingerprints.get(5)!.hash).toBe(atIndexZero);
  });

  it("draws each trail's home tone from the palette and re-derives on rotation", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true, chordRotation: true });

    const framesAt = (step: number) => [
      { ...soloFrame(0, step * 8, 0), identityKey: "person-a" },
      { ...soloFrame(1, 100 + step * 8, 0), identityKey: "person-b" },
    ];
    for (let step = 0; step < 4; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, framesAt(step));
    }

    // Home tones are voiced in the trail's own register band, so a seat is an
    // octave transposition of a palette tone rather than the palette tone
    // itself — the pitch class is what has to stay inside the chord.
    const dmPalette = CHORD_PROGRESSION[0].pitches;
    for (const home of [0, 1].map((i) => engine.getHomeTone(i)!)) {
      expectPitchClassInPalette(home, dmPalette);
    }

    // Past the dwell the progression moves; a trail's seat moves with it
    // rather than holding a pitch outside the new chord.
    context.currentTime += 1 / 60;
    engine.tick(CHORD_DWELL_MS + 1, framesAt(5));

    const bbPalette = CHORD_PROGRESSION[1].pitches;
    for (const home of [0, 1].map((i) => engine.getHomeTone(i)!)) {
      expectPitchClassInPalette(home, bbPalette);
    }
  });

  it("leads a home tone to the nearest new chord tone rather than re-hashing", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true, chordRotation: true });

    const frames = (step: number) => [
      { ...soloFrame(0, step * 8, 0), identityKey: "person-a" },
    ];
    for (let step = 0; step < 3; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, frames(step));
    }

    // Walk the whole progression and check each move is a step, not a leap.
    // Re-hashing against every palette is what made a trail jump register on
    // each chord change; leading keeps it as one slowly-gliding line.
    const band = engine.getRegisterBand(0)!;
    let previous = engine.getHomeTone(0)!;
    for (let turn = 1; turn <= CHORD_PROGRESSION.length; turn++) {
      context.currentTime += 1 / 60;
      engine.tick(turn * (CHORD_DWELL_MS + 1), frames(3 + turn));

      const palette = CHORD_PROGRESSION[turn % CHORD_PROGRESSION.length].pitches;
      const home = engine.getHomeTone(0)!;
      expectPitchClassInPalette(home, palette);
      // The engine leads within the palette folded into the trail's own band,
      // so "nearest" is measured among the tones it can actually sing.
      const inBand = palette.map((pitch) => foldPitchIntoBand(pitch, band));
      expect(leadHomeTone(previous, inBand)).toBe(home);
      previous = home;
    }
  });

  it("glides a sounding voice into the new chord instead of snapping", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true, chordRotation: true });

    // Circle the pad rather than tracking a straight line: direction drives
    // pitch selection, so a fixed heading would hold one note and never
    // schedule the ramp this test is about.
    const frames = (step: number) => [
      {
        ...soloFrame(
          0,
          500 + Math.cos(step * 0.9) * 120,
          150 + Math.sin(step * 0.9) * 120,
        ),
        identityKey: "person-a",
      },
    ];
    for (let step = 0; step < 6; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 100, frames(step));
    }

    const oscillator = context.oscillators[0];
    const beforeRotation = oscillator.frequency.events.length;

    // Past the dwell, then keep moving so the voice takes a fresh pitch.
    for (let step = 6; step < 12; step++) {
      context.currentTime += 1 / 60;
      engine.tick(CHORD_DWELL_MS + step * 100, frames(step));
    }

    const rampsAfter = oscillator.frequency.events
      .slice(beforeRotation)
      .filter((event) => event.method === "exponentialRamp");
    expect(rampsAfter.length).toBeGreaterThan(0);

    // The first pitch taken from the new palette is the voice-leading move, so
    // it rides a ~1s glide rather than the 80ms note ramp. Every ramp is
    // scheduled at ctx.currentTime + glide, and the clock only ever advances,
    // so a ramp landing more than half a second past the final clock reading
    // can only have come from the long glide.
    const longestGlide = Math.max(...rampsAfter.map((event) => event.time));
    expect(longestGlide).toBeGreaterThan(context.currentTime + 0.5);
    // Ordinary note moves stay short: the very first ramp of the run (before
    // any rotation) is an 80ms move, not a glide.
    const firstRamp = oscillator.frequency.events.find(
      (event) => event.method === "exponentialRamp",
    )!;
    expect(firstRamp.time).toBeLessThan(context.currentTime + 0.5);
  });

  it("leads every sounding voice onto the new chord, moving or not", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({
      mode: "spotlight",
      trailVoices: true,
      chordRotation: true,
      swells: true,
      progression: "lament",
    });

    const state = engine as unknown as {
      voices: Map<number, { currentFrequency: number }>;
    };

    const COUNT = 8;
    const xs = Array.from({ length: COUNT }, () => 500);
    const ys = Array.from({ length: COUNT }, (_, i) => 30 + i * 20);
    // Each trail creeps on its own compass heading, so between them the crowd
    // holds every degree of the palette rather than one shared note.
    let stalled = false;
    const step = (elapsed: number) => {
      context.currentTime += 1 / 60;
      const frames = xs.map((_, i) => {
        const angle = (i * Math.PI * 2) / COUNT;
        const prevX = xs[i];
        const prevY = ys[i];
        const speed = stalled ? 0.01 : 2;
        xs[i] += Math.cos(angle) * speed;
        ys[i] += Math.sin(angle) * speed;
        return {
          ...soloFrame(i, xs[i], ys[i]),
          prevX,
          prevY,
          identityKey: `person-${i}`,
        };
      });
      engine.tick(elapsed, frames);
    };

    let elapsed = 0;
    for (; elapsed < CHORD_DWELL_MS - 400; elapsed += 16) step(elapsed);
    // Stall the whole crowd just before the rotation lands. A stalled trail is
    // faded rather than released, so its voice keeps sounding while the tick
    // loop skips the pitch update that would otherwise move it onto the new
    // chord — the case that used to leave a previous-chord tone ringing.
    stalled = true;
    for (; elapsed < CHORD_DWELL_MS; elapsed += 16) step(elapsed);

    const before = engine.getCurrentChordName();
    for (; elapsed < CHORD_DWELL_MS + 1500; elapsed += 16) step(elapsed);
    const after = engine.getCurrentChordName();
    expect(after).not.toBe(before);

    const palette = PROGRESSIONS.lament.chords.find(
      (chord) => chord.name === after,
    )!.pitches;
    for (const [trailIndex, voice] of state.voices) {
      expect(
        voice.currentFrequency,
        `trail ${trailIndex} is still sounding a tone from outside ${after}`,
      ).toBeGreaterThan(0);
      expectPitchClassInPalette(voice.currentFrequency, palette);
    }
  });

  it("moves home-tone bias and swell timing together on the traceability dial", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true, swells: true });

    const internals = engine as unknown as {
      homeToneBias(): number;
      swellTimeScale(): number;
    };

    // The story end is whatever the tuning constants say, untouched.
    expect(engine.getTraceability()).toBe(0);
    const storyBias = internals.homeToneBias();
    expect(storyBias).toBeCloseTo(0.4, 5);
    expect(internals.swellTimeScale()).toBeCloseTo(1, 5);

    engine.setTraceability(1);
    expect(engine.getTraceability()).toBe(1);
    expect(internals.homeToneBias()).toBeCloseTo(0.1, 5);
    expect(internals.swellTimeScale()).toBeCloseTo(0.4, 5);

    // Halfway sits halfway along both, so the dial reads as one control.
    engine.setTraceability(0.5);
    expect(internals.homeToneBias()).toBeCloseTo(0.25, 5);
    expect(internals.swellTimeScale()).toBeCloseTo(0.7, 5);

    // Out-of-range positions clamp rather than pushing past either end.
    engine.setTraceability(2);
    expect(internals.homeToneBias()).toBeCloseTo(0.1, 5);
    engine.setTraceability(-1);
    expect(internals.homeToneBias()).toBeCloseTo(0.4, 5);
  });

  it("cycles whichever progression is selected", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ chordRotation: true, progression: "lament" });

    const frames = (step: number) => [soloFrame(0, step * 8, 0)];
    const seen: string[] = [];
    for (let turn = 0; turn < PROGRESSIONS.lament.chords.length; turn++) {
      context.currentTime += 1 / 60;
      engine.tick(turn * (CHORD_DWELL_MS + 1), frames(turn));
      seen.push(engine.getCurrentChordName());
    }

    expect(engine.getProgressionId()).toBe("lament");
    expect(seen).toEqual(["Dm", "Gm", "Bb", "Am"]);
  });

  it("holds each chord twice as long in the two-chord rotation", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ chordRotation: true, progression: "breath" });

    const frames = (step: number) => [soloFrame(0, step * 8, 0)];
    engine.tick(0, frames(0));
    expect(engine.getCurrentChordName()).toBe("Dm");

    // A single base dwell is not enough to turn this rotation.
    context.currentTime += 1 / 60;
    engine.tick(CHORD_DWELL_MS + 1, frames(1));
    expect(engine.getCurrentChordName()).toBe("Dm");

    context.currentTime += 1 / 60;
    engine.tick(CHORD_DWELL_MS * 2 + 1, frames(2));
    expect(engine.getCurrentChordName()).toBe("Bb");
  });

  it("restarts on the home chord when the progression is switched", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ chordRotation: true, progression: "circular" });

    const frames = (step: number) => [soloFrame(0, step * 8, 0)];
    engine.tick(0, frames(0));
    context.currentTime += 1 / 60;
    engine.tick(CHORD_DWELL_MS + 1, frames(1));
    expect(engine.getCurrentChordName()).toBe("Bb");

    // The index into the old rotation means nothing in the new one, so the
    // switch begins on the new rotation's home chord rather than mid-sequence.
    engine.setConfig({ progression: "dorian" });
    context.currentTime += 1 / 60;
    engine.tick(CHORD_DWELL_MS + 100, frames(2));
    expect(engine.getCurrentChordName()).toBe("Dm");

    context.currentTime += 1 / 60;
    engine.tick(CHORD_DWELL_MS * 2 + 200, frames(3));
    expect(engine.getCurrentChordName()).toBe("G");
  });

  it("draws voices from the dorian collection under the dorian rotation", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ chordRotation: true, progression: "dorian" });

    // Advance onto the G chord, the one carrying the B natural.
    const frames = (step: number) => [
      soloFrame(
        0,
        500 + Math.cos(step * 0.8) * 150,
        150 + Math.sin(step * 0.8) * 100,
      ),
    ];
    for (let step = 0; step < 20; step++) {
      context.currentTime += 1 / 60;
      engine.tick(CHORD_DWELL_MS + 1 + step * 100, frames(step));
    }
    expect(engine.getCurrentChordName()).toBe("G");

    const pitches = context.oscillators[0].frequency.events
      .filter((event) => event.method === "exponentialRamp")
      .map((event) => event.value!);
    expect(pitches.length).toBeGreaterThan(0);
    for (const pitch of pitches) {
      expect(isPitchInCollection(pitch, "dorian")).toBe(true);
    }
  });

  it("assigns each trail a register band from its colour", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true });

    // One trail per hue quadrant, in the colour formats real trails carry:
    // hex, rgb() from the RISO palette, and hsl() from a participant colour.
    const trails: Array<{
      index: number;
      color: string;
      expected: RegisterBand;
    }> = [
      { index: 0, color: "#0078bf", expected: "bass" },
      { index: 1, color: "rgb(0, 169, 92)", expected: "tenor" },
      { index: 2, color: "hsl(80, 60%, 50%)", expected: "alto" },
      { index: 3, color: "#e04a2f", expected: "soprano" },
    ];

    const framesAt = (step: number) =>
      trails.map(({ index, color }) => ({
        ...soloFrame(index, index * 100 + step * 8, 0),
        color,
        identityKey: `person-${index}`,
      }));
    for (let step = 0; step < 3; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, framesAt(step));
    }

    for (const { index, expected } of trails) {
      expect(engine.getRegisterBand(index)).toBe(expected);
    }

    // The spread is the point: four trails, four parts, rather than four
    // voices stacked in one octave.
    for (const { index, expected } of trails) {
      const home = engine.getHomeTone(index)!;
      const { minHz, maxHz } = REGISTER_BAND_RANGES[expected];
      expect(home).toBeGreaterThanOrEqual(minHz);
      expect(home).toBeLessThanOrEqual(maxHz);
    }
  });

  it("falls back to the middle band for an unparseable colour", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true });

    const framesAt = (step: number) => [
      {
        ...soloFrame(0, step * 8, 0),
        color: "not-a-colour",
        identityKey: "person-a",
      },
    ];
    for (let step = 0; step < 3; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, framesAt(step));
    }

    // Alto, the middle of the range — not a silent drop into the bass.
    expect(engine.getRegisterBand(0)).toBe("alto");
  });

  it("voices a trail's direction-derived pitches inside its band", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailVoices: true });

    // A soprano-coloured trail circling the pad, so every compass direction
    // gets selected at some point in the run.
    const framesAt = (step: number) => [
      {
        ...soloFrame(
          0,
          500 + Math.cos(step * 0.7) * 200,
          150 + Math.sin(step * 0.7) * 120,
        ),
        color: "hsl(300, 60%, 50%)",
        identityKey: "person-a",
      },
    ];
    for (let step = 0; step < 40; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 100, framesAt(step));
    }

    expect(engine.getRegisterBand(0)).toBe("soprano");

    const { minHz, maxHz } = REGISTER_BAND_RANGES.soprano;
    const pitches = context.oscillators[0].frequency.events
      .filter((event) => event.method === "exponentialRamp")
      .map((event) => event.value!);
    expect(pitches.length).toBeGreaterThan(2);
    for (const pitch of pitches) {
      expect(pitch).toBeGreaterThanOrEqual(minHz);
      expect(pitch).toBeLessThanOrEqual(maxHz);
    }
  });

  it("reports no register band while trail voices are off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    engine.tick(0, [{ ...soloFrame(0, 0, 0), identityKey: "person-a" }]);
    context.currentTime += 1 / 60;
    engine.tick(16, [{ ...soloFrame(0, 8, 0), identityKey: "person-a" }]);

    expect(engine.getRegisterBand(0)).toBeNull();
  });

  it("reports no home tone while trail voices are off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    engine.tick(0, [{ ...soloFrame(0, 0, 0), identityKey: "person-a" }]);
    context.currentTime += 1 / 60;
    engine.tick(16, [{ ...soloFrame(0, 8, 0), identityKey: "person-a" }]);

    expect(engine.getHomeTone(0)).toBeNull();
  });

  it("maps the legacy crossing boolean onto the crossing flavor", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const state = engine as unknown as {
      config: { crossings: string };
    };

    engine.setConfig({ crossingDissonance: true });
    expect(state.config.crossings).toBe("dissonance");

    engine.setConfig({ crossingDissonance: false });
    expect(state.config.crossings).toBe("off");

    // An explicit flavor wins over the legacy boolean when both are sent.
    engine.setConfig({ crossingDissonance: true, crossings: "merge" });
    expect(state.config.crossings).toBe("merge");
  });

  it("sounds a consonant dyad rather than a dissonant interval on a merge", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ crossings: "merge", trailVoices: true });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };

    // Two trails converging on the same point, so one crosses the other's
    // accumulated path.
    for (let step = 0; step < 60; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        { ...soloFrame(0, 100 + step * 6, 100), identityKey: "person-a" },
        { ...soloFrame(1, 460 - step * 6, 100), identityKey: "person-b" },
      ]);
    }

    const pitches = [...state.flourishNotes].map(
      (note) => note.oscillator.frequency.value,
    );
    expect(pitches.length).toBeGreaterThan(0);

    // Every ringing pitch is a palette tone, in some octave (the dyad is
    // folded into the trail's band) and possibly as the 3x partial — a
    // dissonant crossing rings a continuous baseFreq derived from screen
    // position and would essentially never land on one.
    const palette = CHORD_PROGRESSION[0].pitches;
    for (const pitch of pitches) {
      expectPitchClassInPalette(pitch, [
        ...palette,
        ...palette.map((tone) => tone * 3),
      ]);
    }
  });

  it("falls back to root and fifth when merging without trail voices", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ crossings: "merge" });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
      mergePullsUntilMs: Map<number, number>;
    };

    for (let step = 0; step < 60; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 100 + step * 6, 100),
        soloFrame(1, 460 - step * 6, 100),
      ]);
    }

    const fundamentals = [...state.flourishNotes]
      .map((note) => note.oscillator.frequency.value)
      // Each dyad note carries a 3x partial; keep only the fundamentals.
      .filter((hz) => hz < 1000);
    expect(fundamentals.length).toBeGreaterThan(0);

    // Dm root D3 doubled into D4, and the fifth above it.
    const root = 146.83 * 2;
    for (const hz of fundamentals) {
      const isRootOrFifth =
        Math.abs(hz - root) < 0.5 || Math.abs(hz - root * 1.5) < 0.5;
      expect(isRootOrFifth, `${hz} should be the root or its fifth`).toBe(true);
    }

    // With no fingerprints there is nothing personal to pull together.
    expect(state.mergePullsUntilMs.size).toBe(0);
  });

  it("pulls merged voices to unison and lets them drift back", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ crossings: "merge", trailVoices: true });

    const state = engine as unknown as {
      voices: Map<number, { appliedDetuneCents: number }>;
      mergePullsUntilMs: Map<number, number>;
      fingerprints: Map<number, { detuneCents: number }>;
    };

    for (let step = 0; step < 60; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        { ...soloFrame(0, 100 + step * 6, 100), identityKey: "person-a" },
        { ...soloFrame(1, 460 - step * 6, 100), identityKey: "person-b" },
      ]);
    }

    expect(state.mergePullsUntilMs.size).toBeGreaterThan(0);
    const pulled = [...state.mergePullsUntilMs.keys()];
    for (const trailIndex of pulled) {
      expect(state.voices.get(trailIndex)!.appliedDetuneCents).toBe(0);
    }

    // Past the pull duration each voice is handed back its own detune. Both
    // trails move well off the paths they laid down, so this frame is a plain
    // continuation rather than another crossing that would re-arm the pull.
    const elapsedAfterPull = Math.max(...state.mergePullsUntilMs.values()) + 1;
    context.currentTime += 2;
    engine.tick(elapsedAfterPull, [
      { ...soloFrame(0, 400, 900), identityKey: "person-a" },
      { ...soloFrame(1, 500, 950), identityKey: "person-b" },
    ]);

    expect(state.mergePullsUntilMs.size).toBe(0);
    for (const trailIndex of pulled) {
      expect(state.voices.get(trailIndex)!.appliedDetuneCents).toBeCloseTo(
        state.fingerprints.get(trailIndex)!.detuneCents,
        5,
      );
    }
  });

  it("resolves a suspension stepwise down onto a chord tone", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const before = context.oscillators.length;
    engine.audition("crossingSuspension");
    const tones = context.oscillators.slice(before);
    expect(tones).toHaveLength(2);

    const [lower, upper] = tones;
    // The suspended voice starts a step above the chord tone under it. A step,
    // not a leap: more than a whole tone would be a chord tone rather than a
    // suspension.
    const startedAbove = upper.frequency.value;
    expect(startedAbove).toBeGreaterThan(lower.frequency.value);
    const openingInterval = 12 * Math.log2(startedAbove / lower.frequency.value);
    expect(openingInterval).toBeGreaterThan(0.5);
    expect(openingInterval).toBeLessThanOrEqual(2.5);

    // Then it falls onto the tone below, which is the release the whole figure
    // exists for. The old version never resolved, which is why it just sounded
    // wrong rather than tense.
    const resolution = upper.frequency.events.find(
      (event) => event.method === "linearRamp",
    );
    expect(resolution).toBeDefined();
    expect(resolution!.value).toBeCloseTo(lower.frequency.value, 5);
    // Downward: resolving upward would read as a new note, not a settling.
    expect(resolution!.value!).toBeLessThan(startedAbove);
  });

  it("draws the suspension from the current progression's collection", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ chordRotation: true, progression: "dorian" });
    engine.tick(0, [soloFrame(0, 0, 0)]);

    const before = context.oscillators.length;
    engine.audition("crossingSuspension");
    const [lower, upper] = context.oscillators.slice(before);

    // Both voices stay in the key. Folding back out of the crossing register
    // is what the engine does internally to find the neighbour.
    for (const tone of [lower, upper]) {
      expect(isPitchInCollection(tone.frequency.value / 2, "dorian")).toBe(true);
    }
  });

  it("sounds a beating shimmer rather than an interval when the scene is quiet", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const before = context.oscillators.length;
    engine.audition("crossingShimmer");
    const [a, b] = context.oscillators.slice(before);

    // Same chord tone, a few Hz apart — no interval at all, just the beat
    // between them. That is what a near-empty canvas can carry.
    const beatHz = Math.abs(b.frequency.value - a.frequency.value);
    expect(beatHz).toBeGreaterThanOrEqual(4);
    expect(beatHz).toBeLessThanOrEqual(6);
    // Neither voice glides: a shimmer has nothing to resolve.
    for (const tone of [a, b]) {
      expect(
        tone.frequency.events.some((event) => event.method === "linearRamp"),
      ).toBe(false);
    }
  });

  it("picks the crossing variant from how busy the scene is", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ crossings: "dissonance", energyArc: true });

    const state = engine as unknown as {
      energy: number;
      lastTickMs: number;
      lastHarshCrossingMs: number;
      crossingTensionVariant(): string;
    };

    // A still canvas gets the gentlest figure.
    state.energy = 0.05;
    expect(state.crossingTensionVariant()).toBe("shimmer");

    // An ordinary scene gets the suspension.
    state.energy = 0.5;
    expect(state.crossingTensionVariant()).toBe("suspension");

    // Only a genuinely busy one earns the harsh version.
    state.energy = 0.9;
    state.lastTickMs = 100000;
    state.lastHarshCrossingMs = Number.NEGATIVE_INFINITY;
    expect(state.crossingTensionVariant()).toBe("harsh");

    // And it is rate-limited far harder than the per-pair cooldown, so it
    // stays an occasional strain rather than becoming the texture.
    state.lastTickMs = 101000;
    expect(state.crossingTensionVariant()).toBe("suspension");
    state.lastTickMs = 120000;
    expect(state.crossingTensionVariant()).toBe("harsh");
  });

  it("falls back to recent motion when the energy arc is off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ crossings: "dissonance", energyArc: false });

    const state = engine as unknown as { crossingTensionVariant(): string };

    // A barely-moving scene reads as quiet even with the arc switched off.
    for (let step = 0; step < 20; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, 100 + step * 0.05, 0)]);
    }
    expect(state.crossingTensionVariant()).toBe("shimmer");

    // A fast sweep pushes it past the gentle threshold.
    for (let step = 20; step < 60; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, (step % 10) * 90, 0)]);
    }
    expect(state.crossingTensionVariant()).not.toBe("shimmer");
  });

  it("keeps crossing tension quieter than a click bell", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const before = context.gains.length;
    engine.audition("crossingSuspension");
    const peaks = context.gains
      .slice(before)
      .flatMap((gain) =>
        gain.gain.events
          .filter((event) => event.method === "linearRamp")
          .map((event) => event.value!),
      )
      .filter((value) => value > 0);

    expect(peaks.length).toBeGreaterThan(0);
    // A crossing is an inflection, not an event — the click bell stays the
    // strongest accent in the scene.
    for (const peak of peaks) {
      expect(peak).toBeLessThan(0.1);
    }
  });

  it("makes no crossing sound while crossings are off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const state = engine as unknown as {
      flourishNotes: Set<unknown>;
      trailPaths: Map<number, unknown>;
    };

    for (let step = 0; step < 60; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        soloFrame(0, 100 + step * 6, 100),
        soloFrame(1, 460 - step * 6, 100),
      ]);
    }

    expect(state.flourishNotes.size).toBe(0);
    // No path history is accumulated either, so switching crossings on later
    // cannot fire a crossing against a stale path.
    expect(state.trailPaths.size).toBe(0);
  });

  it("gives every voice a vibrato LFO only while trail voices are on", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const state = engine as unknown as {
      voices: Map<
        number,
        { vibrato: { oscillator: TestOscillatorNode } | null }
      >;
    };

    const frame = (x: number) => ({
      ...soloFrame(0, x, 0),
      identityKey: "person-a",
    });
    engine.tick(0, [frame(0)]);
    context.currentTime += 1 / 60;
    engine.tick(16, [frame(8)]);
    expect(state.voices.get(0)!.vibrato).toBeNull();

    // Toggling on reaches the voice already sounding on the next frame,
    // without waiting for it to be torn down and recreated.
    engine.setConfig({ trailVoices: true });
    context.currentTime += 1 / 60;
    engine.tick(32, [frame(16)]);
    expect(state.voices.get(0)!.vibrato).not.toBeNull();

    // Toggling off strips it immediately — a paused canvas may never tick
    // again, and the voice must not keep wobbling after the switch.
    engine.setConfig({ trailVoices: false });
    expect(state.voices.get(0)!.vibrato).toBeNull();
  });

  it("swells only after sustained motion, not on a short gesture", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(4000);
    engine.setConfig({ swells: true });

    const state = engine as unknown as {
      swells: Map<number, { progress: number }>;
    };

    // A gesture shorter than the onset window: fast, but over before the
    // crescendo is allowed to start, so it must stay at the plain multiplier.
    let x = 0;
    let step = 0;
    for (; step * 16 < SWELL_ONSET_MS - 100; step++) {
      x += 8;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }
    expect(state.swells.get(0)!.progress).toBe(0);

    // Keeping the same motion going past the onset starts the crescendo.
    for (; step < 200; step++) {
      x += 8;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }
    const swelled = state.swells.get(0)!.progress;
    expect(swelled).toBeGreaterThan(0.5);
  });

  it("releases the swell once a trail stops", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(4000);
    engine.setConfig({ swells: true });

    const state = engine as unknown as {
      swells: Map<number, { progress: number }>;
    };

    let x = 0;
    let step = 0;
    for (; step < 200; step++) {
      x += 8;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }
    const peak = state.swells.get(0)!.progress;
    expect(peak).toBeGreaterThan(0.5);

    // The trail stops. The release runs over its own duration rather than
    // cutting, so the swell is well down but not instantly zero.
    for (let i = 0; i < 20; i++) {
      step++;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }
    const shortlyAfter = state.swells.get(0)!.progress;
    expect(shortlyAfter).toBeLessThan(peak);
    expect(shortlyAfter).toBeGreaterThan(0);

    for (let i = 0; i < 300; i++) {
      step++;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }
    expect(state.swells.get(0)!.progress).toBeLessThan(0.05);
  });

  it("holds a swell through the short pauses of real cursor motion", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(8000);
    engine.setConfig({ swells: true });

    const state = engine as unknown as {
      swells: Map<number, { progress: number }>;
    };

    // Motion with a still frame every fourth tick — roughly what a real
    // cursor does. Without the grace window each gap would reset the onset
    // and the bed would never actually lean in.
    let x = 0;
    for (let step = 0; step < 250; step++) {
      if (step % 4 !== 3) x += 9;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }

    expect(state.swells.get(0)!.progress).toBeGreaterThan(0.5);
  });

  it("keeps the ensemble breath bounded and centred on unity", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ swells: true });

    const state = engine as unknown as { breathGainScale(): number };

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const samples = 400;
    // Walk the audio clock across several full breath periods.
    for (let i = 0; i < samples; i++) {
      context.currentTime += 21 / 100;
      const value = state.breathGainScale();
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }

    expect(min).toBeGreaterThanOrEqual(0.85 - 1e-9);
    expect(max).toBeLessThanOrEqual(1.15 + 1e-9);
    // It really does traverse the range rather than sitting near one end.
    expect(min).toBeLessThan(0.9);
    expect(max).toBeGreaterThan(1.1);
    // A breath, not a bias: the mean over whole periods stays at unity.
    expect(sum / samples).toBeCloseTo(1, 1);
  });

  it("leaves gain and master untouched while swells are off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(4000);

    const state = engine as unknown as {
      swells: Map<number, unknown>;
      breathGainScale(): number;
      swellGainFor(trailIndex: number, elapsedMs: number, v: number): number;
    };

    let x = 0;
    for (let step = 0; step < 200; step++) {
      x += 8;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, x, 0)]);
    }

    // No state accumulated, and both multipliers are exactly 1, so the plain
    // gain path is arithmetically identical to what it was before swells.
    expect(state.swells.size).toBe(0);
    expect(state.breathGainScale()).toBe(1);
    expect(state.swellGainFor(0, 5000, 10)).toBe(1);
  });

  it("morphs the choral vowel between its closed and open endpoints", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(8000);
    engine.setConfig({ choralTimbre: true });

    const state = engine as unknown as {
      voices: Map<number, { formants: { filters: TestBiquadFilterNode[] } | null }>;
    };

    // Slow drift first: the vowel should sit closed.
    let x = 0;
    for (let step = 0; step < 20; step++) {
      x += 1;
      context.currentTime += 0.05;
      engine.tick(step * 50, [soloFrame(0, x, 0)]);
    }

    const formants = state.voices.get(0)!.formants!;
    expect(formants.filters).toHaveLength(2);

    const lastRamp = (filter: TestBiquadFilterNode) =>
      [...filter.frequency.events]
        .reverse()
        .find((event) => event.method === "linearRamp")?.value ??
      filter.frequency.events.at(-1)!.value!;

    // Closed "ooh" sits at 300/870; slow motion must stay near it.
    expect(lastRamp(formants.filters[0])).toBeLessThan(420);
    expect(lastRamp(formants.filters[1])).toBeLessThan(950);

    // Now a fast sweep: the vowel opens toward "ahh" at 700/1220.
    for (let step = 20; step < 60; step++) {
      x += 40;
      context.currentTime += 0.05;
      engine.tick(step * 50, [soloFrame(0, x, 0)]);
    }

    expect(lastRamp(formants.filters[0])).toBeCloseTo(700, 0);
    expect(lastRamp(formants.filters[1])).toBeCloseTo(1220, 0);
  });

  it("builds no formant filters while the choral timbre is off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const state = engine as unknown as {
      voices: Map<number, { formants: unknown | null }>;
    };

    const frame = (x: number) => soloFrame(0, x, 0);
    engine.tick(0, [frame(0)]);
    context.currentTime += 1 / 60;
    engine.tick(16, [frame(8)]);
    expect(state.voices.get(0)!.formants).toBeNull();

    // Switching on attaches the bank; switching back off tears it down at
    // once, without waiting for a tick a paused canvas may never send.
    engine.setConfig({ choralTimbre: true });
    context.currentTime += 1 / 60;
    engine.tick(32, [frame(16)]);
    expect(state.voices.get(0)!.formants).not.toBeNull();

    engine.setConfig({ choralTimbre: false });
    expect(state.voices.get(0)!.formants).toBeNull();
  });

  it("auditions the choral swell across its full envelope", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);

    const before = context.oscillators.length;
    engine.audition("choralSwell");
    const rung = context.oscillators.slice(before);

    expect(rung).toHaveLength(1);
    // Onset, crescendo and release together run past four seconds, so the
    // envelope can actually be heard rather than flashing past.
    const stopAt = rung[0].stopTimes[0]!;
    expect(stopAt - rung[0].startTimes[0]).toBeGreaterThan(4);
  });

  it("disconnects voice graphs after a playback reset", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);

    engine.tick(0, [
      {
        trailIndex: 0,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0,
        color: "#000",
        isNewlyActive: true,
      },
    ]);
    context.currentTime += 1 / 60;
    engine.tick(100, [
      {
        trailIndex: 0,
        x: 10,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "pointer",
        progress: 0.1,
        color: "#000",
        isNewlyActive: false,
      },
    ]);

    const primaryLevel = context.oscillators[0].connections[0];
    engine.reset();
    context.oscillators[0].onended?.();

    expect(primaryLevel.connections).toEqual([]);
  });
});

describe("sound notices", () => {
  /**
   * A visual standing for an event has to be fired by that event, reported by
   * the engine: only the engine knows which arrivals and navigations it
   * actually counted, so anything drawing on its own schedule would show
   * gestures for events the engine never registered.
   *
   * The notice is for the event, not for the note. The sound toggles gate
   * audio and the visual toggles gate drawing, and neither gates the other —
   * so a page change is still reported with the gong switched off, carrying
   * `played: false`. These pin that separation down.
   */

  it("reports an arrival with the schedule of the chime that sounded", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const notices: SoundNotice[] = [];
    engine.setSoundNoticeListener((notice) => notices.push(notice));

    engine.tick(0, [soloFrame(7, 10, 10)]);

    expect(notices).toHaveLength(1);
    const notice = notices[0];
    expect(notice.kind).toBe("arrival");
    if (notice.kind !== "arrival") throw new Error("expected an arrival");
    expect(notice.trailIndex).toBe(7);
    expect(notice.rising).toBe(true);
    // One offset per note of the cluster, in order, starting at the chime's
    // own first note rather than at a time of the visual's choosing.
    expect(notice.noteOffsetsSeconds.length).toBeGreaterThanOrEqual(3);
    expect(notice.noteOffsetsSeconds.length).toBeLessThanOrEqual(5);
    expect(notice.noteOffsetsSeconds[0]).toBe(0);
    for (let i = 1; i < notice.noteOffsetsSeconds.length; i++) {
      expect(notice.noteOffsetsSeconds[i]).toBeGreaterThan(
        notice.noteOffsetsSeconds[i - 1],
      );
    }
  });

  it("reports a falling notice when a trail's departure chime sounds", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    engine.tick(0, [soloFrame(7, 10, 10)]);
    const notices: SoundNotice[] = [];
    engine.setSoundNoticeListener((notice) => notices.push(notice));

    engine.retireTrail(7);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: "arrival",
      trailIndex: 7,
      rising: false,
    });
  });

  it("reports an arrival the rate cap silenced, marked as unplayed", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const notices: SoundNotice[] = [];
    engine.setSoundNoticeListener((notice) => notices.push(notice));

    // Thirty trails on one frame, as on a day swap. All thirty arrived; only
    // what the global per-second budget lets through is heard.
    engine.tick(0, Array.from({ length: 30 }, (_, i) => soloFrame(i, i * 10, 10)));
    expect(notices).toHaveLength(30);
    expect(notices.filter((n) => n.kind === "arrival" && n.played)).toHaveLength(
      2,
    );
    for (const notice of notices) {
      if (notice.kind !== "arrival") throw new Error("expected arrivals");
      // A silenced arrival carries no note schedule, because there were no
      // notes: a gesture paced by the chime has nothing to pace itself by.
      if (!notice.played) expect(notice.noteOffsetsSeconds).toEqual([]);
    }

    // Staying present is not arriving again, so nothing further is reported.
    notices.length = 0;
    for (let step = 1; step < 20; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [soloFrame(0, 10 + step, 10)]);
    }
    expect(notices).toHaveLength(0);
  });

  it("still reports arrivals and departures with the chime switched off", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: false });

    const notices: SoundNotice[] = [];
    engine.setSoundNoticeListener((notice) => notices.push(notice));

    engine.tick(0, [soloFrame(7, 10, 10)]);
    engine.retireTrail(7);

    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({
      kind: "arrival",
      trailIndex: 7,
      rising: true,
      played: false,
    });
    expect(notices[1]).toMatchObject({
      kind: "arrival",
      trailIndex: 7,
      rising: false,
      played: false,
    });
  });

  it("reports every navigation, saying which of them sounded", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ navigationSounds: true });

    const notices: SoundNotice[] = [];
    engine.setSoundNoticeListener((notice) => notices.push(notice));

    engine.tick(0, []);
    engine.triggerNavigation({ x: 500, trailIndex: 4 });
    expect(notices).toEqual([
      { kind: "navigation", trailIndex: 4, x: 500, played: true },
    ]);

    // Inside the rate limit no note sounds, but the page change still happened.
    context.currentTime += 0.5;
    engine.triggerNavigation({ x: 500, trailIndex: 4 });
    expect(notices).toHaveLength(2);
    expect(notices[1]).toMatchObject({ kind: "navigation", played: false });

    // Past the limit it sounds again.
    context.currentTime += 2;
    engine.triggerNavigation({ x: 600, trailIndex: 4 });
    expect(notices).toHaveLength(3);
    expect(notices[2]).toMatchObject({ kind: "navigation", played: true });
  });

  it("reports a navigation with the gong switched off, so its visual still draws", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ navigationSounds: false });

    const notices: SoundNotice[] = [];
    engine.setSoundNoticeListener((notice) => notices.push(notice));

    engine.triggerNavigation({ x: 500, trailIndex: 4 });

    // The bug this pins: the notice used to sit behind the audio toggle, so
    // switching the gong off silently switched the knot off with it.
    expect(notices).toEqual([
      { kind: "navigation", trailIndex: 4, x: 500, played: false },
    ]);
  });

  it("carries the trail a navigation names, so a gesture can anchor to it", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ navigationSounds: true });

    const notices: SoundNotice[] = [];
    engine.setSoundNoticeListener((notice) => notices.push(notice));

    // The live path used to call this with an empty event, so every notice
    // arrived with no trail and every navigation gesture was dropped.
    engine.triggerNavigation({ x: 250, trailIndex: 11 });

    expect(notices[0]).toMatchObject({
      kind: "navigation",
      trailIndex: 11,
      x: 250,
    });
  });

  it("keeps sounding when a listener throws", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ navigationSounds: true });
    engine.setSoundNoticeListener(() => {
      throw new Error("a drawing bug is not an audio bug");
    });

    engine.tick(0, []);
    const before = context.oscillators.length;
    expect(() => engine.triggerNavigation({ x: 500 })).not.toThrow();
    expect(context.oscillators.length).toBeGreaterThan(before);
  });
});

describe("SoundEngine layer mixer", () => {
  /**
   * The mixer is a playground diagnostic, so the semantics that matter are the
   * standard ones a mixing desk has: solo overrides everything, mute silences,
   * and clearing restores the whole mix.
   */
  // The engine's own list rather than a copy, so adding a family cannot leave
  // this suite testing a stale subset of the buses.
  const ALL_LAYERS = SOUND_LAYERS;

  it("leaves every layer audible by default", async () => {
    const engine = new SoundEngine();
    await engine.init();

    for (const layer of ALL_LAYERS) {
      expect(engine.isLayerAudible(layer)).toBe(true);
    }
    expect(engine.getLayerMix()).toEqual({ muted: [], soloed: [] });
  });

  it("silences only the muted layer", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.setLayerMuted("clickBell", true);

    expect(engine.isLayerAudible("clickBell")).toBe(false);
    expect(engine.isLayerAudible("bed")).toBe(true);
    expect(engine.getLayerMix().muted).toEqual(["clickBell"]);
  });

  it("unmutes a layer again", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.setLayerMuted("clickBell", true);
    engine.setLayerMuted("clickBell", false);

    expect(engine.isLayerAudible("clickBell")).toBe(true);
    expect(engine.getLayerMix().muted).toEqual([]);
  });

  it("silences every layer that is not soloed", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.setLayerSoloed("navigation", true);

    expect(engine.isLayerAudible("navigation")).toBe(true);
    for (const layer of ALL_LAYERS) {
      if (layer === "navigation") continue;
      expect(engine.isLayerAudible(layer)).toBe(false);
    }
  });

  it("sounds the union of multiple solos", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.setLayerSoloed("navigation", true);
    engine.setLayerSoloed("chime", true);

    expect(engine.isLayerAudible("navigation")).toBe(true);
    expect(engine.isLayerAudible("chime")).toBe(true);
    expect(engine.isLayerAudible("bed")).toBe(false);
  });

  it("lets solo win over mute on the same layer", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.setLayerMuted("bed", true);
    engine.setLayerSoloed("bed", true);

    expect(engine.isLayerAudible("bed")).toBe(true);
    // The mute is remembered, so dropping the solo restores it rather than
    // silently discarding what the user set.
    engine.setLayerSoloed("bed", false);
    expect(engine.isLayerAudible("bed")).toBe(false);
  });

  it("restores the muted layers when the last solo is released", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.setLayerMuted("chime", true);
    engine.setLayerSoloed("navigation", true);
    expect(engine.isLayerAudible("bed")).toBe(false);

    engine.setLayerSoloed("navigation", false);

    expect(engine.isLayerAudible("bed")).toBe(true);
    expect(engine.isLayerAudible("chime")).toBe(false);
  });

  it("clears every solo and mute at once", async () => {
    const engine = new SoundEngine();
    await engine.init();

    engine.setLayerMuted("chime", true);
    engine.setLayerSoloed("navigation", true);
    engine.clearLayerMix();

    for (const layer of ALL_LAYERS) {
      expect(engine.isLayerAudible(layer)).toBe(true);
    }
    expect(engine.getLayerMix()).toEqual({ muted: [], soloed: [] });
  });

  /**
   * The buses are the gain nodes wired straight into master, in SOUND_LAYERS
   * order. Finding them by graph position rather than creation index keeps
   * this from breaking when unrelated nodes are added to init().
   */
  function layerBuses(master: TestGainNode): TestGainNode[] {
    return context.gains.filter(
      (gain) => gain !== master && gain.connections.includes(master),
    );
  }

  it("drives each layer's bus gain to zero and back", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const master = context.gains[0];
    const buses = layerBuses(master);
    expect(buses).toHaveLength(ALL_LAYERS.length);

    const bus = buses[ALL_LAYERS.indexOf("clickBell")];
    expect(bus.gain.value).toBe(1);

    engine.setLayerMuted("clickBell", true);
    expect(bus.gain.events.at(-1)).toMatchObject({ value: 0 });

    engine.setLayerMuted("clickBell", false);
    expect(bus.gain.events.at(-1)).toMatchObject({ value: 1 });
  });

  /** How many nodes in the graph currently feed `target`. */
  function feederCount(target: TestGainNode): number {
    return context.nodes.filter((node) => node.connections.includes(target))
      .length;
  }

  it("routes a click bell through its own bus rather than straight to master", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const master = context.gains[0];
    const clickBus = layerBuses(master)[ALL_LAYERS.indexOf("clickBell")];
    const busBefore = feederCount(clickBus);
    const masterBefore = feederCount(master);

    engine.setCanvasWidth(800);
    engine.triggerClick({ x: 100, y: 100, holdDuration: undefined });

    // The bell's panner must land on the click bus. If it reached master
    // directly, muting the layer would do nothing.
    expect(feederCount(clickBus)).toBeGreaterThan(busBefore);
    expect(feederCount(master)).toBe(masterBefore);
  });

  it("routes the navigation note to the navigation bus, not the bell bus", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const master = context.gains[0];
    const buses = layerBuses(master);
    const navBus = buses[ALL_LAYERS.indexOf("navigation")];
    const clickBus = buses[ALL_LAYERS.indexOf("clickBell")];
    const navBefore = feederCount(navBus);
    const clickBefore = feederCount(clickBus);

    // The navigation note is off by default, so the routing can only be
    // observed with the feature switched on.
    engine.setConfig({ navigationSounds: true });
    engine.setCanvasWidth(800);
    engine.triggerNavigation({ x: 400 });

    expect(feederCount(navBus)).toBeGreaterThan(navBefore);
    expect(feederCount(clickBus)).toBe(clickBefore);
  });
});

describe("percussion candidates", () => {
  /** An engine up and running, which is what every audition goes through. */
  const startedEngine = async (): Promise<SoundEngine> => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(800);
    return engine;
  };

  it("schedules a filtered noise burst and a falling thump for a click tap", async () => {
    const engine = await startedEngine();
    engine.audition("clickTap");

    // The noise edge: one looped buffer source through a bandpass, started
    // and given an explicit stop so it cannot run on.
    expect(context.bufferSources.length).toBe(1);
    const source = context.bufferSources[0];
    expect(source.buffer).not.toBeNull();
    expect(source.loop).toBe(true);
    expect(source.startTimes.length).toBe(1);
    expect(source.stopTimes.length).toBe(1);

    const bandpass = createdNodes.find(
      (node): node is TestBiquadFilterNode =>
        node instanceof TestBiquadFilterNode && node.type === "bandpass",
    );
    expect(bandpass).toBeDefined();

    // The thump: a sine ramping down in pitch, which is what separates the tap
    // from a plain noise click.
    const thump = context.oscillators[context.oscillators.length - 1];
    const ramps = thump.frequency.events.filter(
      (event) => event.method === "exponentialRamp",
    );
    expect(ramps.length).toBe(1);
    expect(ramps[0].value!).toBeLessThan(thump.frequency.events[0].value!);
  });

  it("drops the falling thump in the no-thump variant, keeping the noise edge", async () => {
    const engine = await startedEngine();
    engine.audition("clickTapNoThump");

    // The edge survives: the whole point of the variant is the same tap
    // without its low half.
    expect(context.bufferSources.length).toBe(1);
    const bandpass = createdNodes.find(
      (node): node is TestBiquadFilterNode =>
        node instanceof TestBiquadFilterNode && node.type === "bandpass",
    );
    expect(bandpass).toBeDefined();

    // No falling sine anywhere, which is what separates this from "clickTap".
    const falling = context.oscillators.filter((osc) =>
      osc.frequency.events.some((event) => event.method === "exponentialRamp"),
    );
    expect(falling).toEqual([]);
  });

  it("adds a quiet bell under the tap only in the hybrid variant", async () => {
    const gainsOf = async (accent: "clickTap" | "clickTapHybrid") => {
      const engine = await startedEngine();
      const state = engine as unknown as {
        flourishNotes: Set<{ peakGain: number }>;
      };
      engine.audition(accent);
      return [...state.flourishNotes].map((note) => note.peakGain);
    };

    // The pure tap has no pitched content at all; the hybrid's ghost is well
    // under the shipped click bell, so it reads as a hint rather than a bell.
    expect(await gainsOf("clickTap")).toEqual([]);
    const hybrid = await gainsOf("clickTapHybrid");
    expect(hybrid.length).toBe(1);
    expect(hybrid[0]).toBeLessThan(CLICK_BELL.gain);
  });

  it("self-disconnects every percussion graph when its source ends", async () => {
    for (const accent of [
      "clickTap",
      "clickTapNoThump",
      "clickTapHybrid",
    ] as const) {
      createdNodes = [];
      context = new TestAudioContext();
      const engine = await startedEngine();
      engine.audition(accent);

      // Firing every onended is what the browser does when the sources stop;
      // nothing in the graph should still be wired up afterwards.
      for (const source of context.bufferSources) source.onended?.();
      for (const osc of context.oscillators) osc.onended?.();

      const stillConnected = createdNodes.filter(
        (node) => node.connections.length > 0,
      );
      // Only the permanent mix graph (master, layer buses, reverb) survives,
      // and it is built during init rather than by the audition.
      for (const node of stillConnected) {
        expect(
          node instanceof TestBufferSourceNode,
          `${accent} left a buffer source connected`,
        ).toBe(false);
      }
    }
  });

  it("never fires a percussion candidate from a live event path", async () => {
    const engine = await startedEngine();
    engine.setConfig({ trailArrivals: true, navigationSounds: true });

    const before = context.bufferSources.length;

    // Everything a live page (MovementCanvas, AnimatedTrails, LiveTrails) can
    // make the engine do: trails moving, a trail arriving and leaving, a
    // click, a hold, a navigation. None of these reaches percussion — the only
    // doors onto it are `audition` and the explicit `trigger*` calls below,
    // and no live page calls either.
    for (let step = 0; step < 30; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        { ...soloFrame(0, 100 + step * 6, 100), identityKey: "person-a" },
        { ...soloFrame(1, 460 - step * 6, 140), identityKey: "person-b" },
      ]);
    }
    engine.triggerClick({ x: 100, y: 100, holdDuration: undefined });
    engine.triggerClick({ x: 100, y: 100, holdDuration: 900 });
    engine.triggerNavigation({ x: 200 });
    engine.retireTrail(0);
    engine.retireTrail(1);

    expect(context.bufferSources.length).toBe(before);
  });

  it("never fires a pitched candidate instrument from a live event path", async () => {
    // The same guard as above, for the orchestral instruments. They are
    // pitched, so a stray one would not show up as a buffer source — count
    // the notes each would leave behind instead.
    const engine = await startedEngine();
    engine.setConfig({ trailArrivals: true, navigationSounds: true });

    const cantusBefore = engine.getCantus();
    const oscillatorsBefore = context.oscillators.length;

    for (let step = 0; step < 30; step++) {
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        { ...soloFrame(0, 100 + step * 6, 100), identityKey: "person-a" },
      ]);
    }
    engine.triggerClick({ x: 100, y: 100, holdDuration: 900 });
    engine.retireTrail(0);

    // The cantus stays off unless it is switched on: no live path starts it,
    // and `tick` alone must not either.
    expect(cantusBefore).toBeNull();
    expect(engine.getCantus()).toBeNull();

    // Whatever the scene did make (bed voices, the bell, arrival chimes), none
    // of it is a pizzicato: a pluck's filter sweeps, and no shipped voice does.
    const oscillatorsAfter = context.oscillators.length;
    expect(oscillatorsAfter).toBeGreaterThan(oscillatorsBefore);
    const sweptFilters = createdNodes.filter(
      (node): node is TestBiquadFilterNode =>
        node instanceof TestBiquadFilterNode &&
        node.frequency.events.some(
          (event) => event.method === "exponentialRamp",
        ),
    );
    expect(sweptFilters).toEqual([]);
  });

  it("plays the pitched candidates when the replay driver asks explicitly", async () => {
    const engine = await startedEngine();

    const before = context.oscillators.length;
    engine.triggerClickPizzicato(100, 200, "soft");
    // A pluck is its string plus the sub an octave down.
    expect(context.oscillators.length).toBe(before + 2);

    const afterPluck = context.oscillators.length;
    engine.triggerHold(200, "swell");
    // The swell has no tremolo, so it is the three partials alone.
    expect(context.oscillators.length).toBe(afterPluck + 3);
  });

  it("plays percussion when the replay driver asks for it explicitly", async () => {
    // The playground's replay calls this against real recorded events, which
    // is the whole reason it is public. It has to actually sound, or the
    // guard above would be passing for the wrong reason.
    const engine = await startedEngine();

    engine.triggerClickPercussion(100, "tap");
    expect(context.bufferSources.length).toBe(1);

    const oscillatorsBefore = context.oscillators.length;
    engine.triggerHold(400);
    // The timpani roll is the tremolo LFO plus three partials, none of them
    // noise.
    expect(context.oscillators.length).toBe(oscillatorsBefore + 4);
  });

  it("treats the bells variant as a request for no percussion at all", async () => {
    // "bells" means the shipped pitched bell, which the caller rings through
    // `triggerClick` instead — this must not also lay a tap under it.
    const engine = await startedEngine();
    engine.triggerClickPercussion(100, "bells");
    expect(context.bufferSources.length).toBe(0);
  });
});

describe("pizzicato", () => {
  const startedEngine = async (): Promise<SoundEngine> => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(800);
    return engine;
  };

  /** The palette a click bell — and so a pluck — draws from this frame. */
  const bellPalette = (engine: SoundEngine): number[] =>
    bellScaleForChord(
      PROGRESSIONS[engine.getProgressionId()].chords[0],
    );

  it("plucks a tone from the current chord's bell palette", async () => {
    const engine = await startedEngine();
    engine.setConfig({ chordRotation: true });
    engine.triggerClickPizzicato(400, 300, "soft");

    // The string is the first oscillator; the second is its sub an octave
    // down, which is why the palette check is on the pitch class.
    const string = context.oscillators[0];
    expectPitchClassInPalette(string.frequency.value, bellPalette(engine));
    expect(context.oscillators[1].frequency.value).toBeCloseTo(
      string.frequency.value / 2,
      6,
    );
  });

  it("takes its pitch from the click's height, like the bell does", async () => {
    const pitchAt = async (y: number): Promise<number> => {
      createdNodes = [];
      context = new TestAudioContext();
      const engine = await startedEngine();
      engine.setConfig({ chordRotation: true });
      engine.triggerClickPizzicato(400, y, "soft");
      return context.oscillators[0].frequency.value;
    };

    // Higher up the window is higher in the palette — the same mapping the
    // shipped click bell uses, so swapping instrument does not move the note.
    expect(await pitchAt(50)).toBeGreaterThan(await pitchAt(700));
  });

  it("sweeps the filter shut across the decay and stops dead", async () => {
    const engine = await startedEngine();
    engine.triggerClickPizzicato(400, 300, "soft");

    const filter = createdNodes.find(
      (node): node is TestBiquadFilterNode =>
        node instanceof TestBiquadFilterNode &&
        node.frequency.events.some(
          (event) => event.method === "exponentialRamp",
        ),
    );
    expect(filter).toBeDefined();
    const [start, end] = filter!.frequency.events.map((event) => event.value!);
    expect(end).toBeLessThan(start);

    // Short and finite: every oscillator has an explicit stop, and the whole
    // note is over well inside half a second.
    for (const osc of context.oscillators) {
      expect(osc.stopTimes.length).toBe(1);
      expect(osc.stopTimes[0]! - osc.startTimes[0]).toBeLessThan(0.5);
    }
  });

  it("makes the crisp variant shorter and brighter than the soft one", async () => {
    const lengthAndType = async (variant: "soft" | "crisp") => {
      createdNodes = [];
      context = new TestAudioContext();
      const engine = await startedEngine();
      engine.triggerClickPizzicato(400, 300, variant);
      const string = context.oscillators[0];
      return {
        length: string.stopTimes[0]! - string.startTimes[0],
        type: string.type,
        noiseBursts: context.bufferSources.length,
      };
    };

    const soft = await lengthAndType("soft");
    const crisp = await lengthAndType("crisp");
    expect(crisp.length).toBeLessThan(soft.length);
    expect(soft.type).toBe("triangle");
    expect(crisp.type).toBe("sawtooth");

    // The fingernail is an attack component only — the soft pluck has no
    // noise at all, and the crisp one has exactly one very short burst.
    expect(soft.noiseBursts).toBe(0);
    expect(crisp.noiseBursts).toBe(1);
    const edge = context.bufferSources[0];
    expect(edge.stopTimes[0]! - edge.startTimes[0]).toBeLessThanOrEqual(0.02);
  });

  it("puts a quieter grace note in front of the double variant", async () => {
    const engine = await startedEngine();
    engine.setConfig({ chordRotation: true });
    engine.triggerClickPizzicato(400, 300, "double");

    // Two plucks, so four oscillators: the grace note's string and sub, then
    // the main note's.
    expect(context.oscillators.length).toBe(4);
    const graceStart = context.oscillators[0].startTimes[0];
    const mainStart = context.oscillators[2].startTimes[0];
    expect(mainStart).toBeGreaterThan(graceStart);
    // One gesture, not two clicks: the gap stays inside a tenth of a second.
    expect(mainStart - graceStart).toBeLessThanOrEqual(0.1);

    // The ornament is a different chord tone, and both are inside the palette.
    const palette = bellPalette(engine);
    expectPitchClassInPalette(context.oscillators[0].frequency.value, palette);
    expectPitchClassInPalette(context.oscillators[2].frequency.value, palette);
    expect(context.oscillators[0].frequency.value).not.toBe(
      context.oscillators[2].frequency.value,
    );

    // And it is quieter, or it reads as the note rather than as its flick.
    const peaks = context.gains
      .map(
        (gain) =>
          gain.gain.events.find((event) => event.method === "linearRamp")
            ?.value ?? 0,
      )
      .filter((value) => value > 0);
    expect(Math.min(...peaks)).toBeLessThan(Math.max(...peaks));
  });
});

describe("timpani", () => {
  const startedEngine = async (): Promise<SoundEngine> => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(800);
    return engine;
  };

  /** Every oscillator that is not the tremolo LFO, low to high. */
  const partialsOf = (): TestOscillatorNode[] =>
    context.oscillators
      .filter((osc) => osc.frequency.value > 20)
      .sort((a, b) => a.frequency.value - b.frequency.value);

  it("pitches the roll on the current chord root, low", async () => {
    const engine = await startedEngine();
    engine.setConfig({ chordRotation: true });
    engine.triggerHold(400, "root");

    const root = PROGRESSIONS[engine.getProgressionId()].chords[0].pitches[0];
    const partials = partialsOf();
    // Timpani register: an octave below the palette's D3 root, so D2-D3.
    expect(partials[0].frequency.value).toBeCloseTo(root * 0.5, 6);
    expect(partials[0].frequency.value).toBeGreaterThan(60);
    expect(partials[0].frequency.value).toBeLessThan(160);
  });

  it("carries the pitch on partials, so it survives a small speaker", async () => {
    const engine = await startedEngine();
    engine.triggerHold(400, "root");

    // A bare low sine disappears on a laptop; the 2x and 3x partials are what
    // make the note audible at all, so all three have to be there.
    const partials = partialsOf();
    expect(partials.length).toBe(3);
    const fundamental = partials[0].frequency.value;
    expect(partials[1].frequency.value).toBeCloseTo(fundamental * 2, 6);
    expect(partials[2].frequency.value).toBeCloseTo(fundamental * 3, 6);

    // And the lowpass has to sit above them, or it undoes the whole point.
    const lowpass = createdNodes.find(
      (node): node is TestBiquadFilterNode =>
        node instanceof TestBiquadFilterNode &&
        node.type === "lowpass" &&
        node.frequency.value > fundamental,
    );
    expect(lowpass).toBeDefined();
    expect(lowpass!.frequency.value).toBeGreaterThan(fundamental * 3);
  });

  it("alternates root and fifth only in the root+fifth variant", async () => {
    const stepsOf = async (variant: "root" | "rootFifth") => {
      createdNodes = [];
      context = new TestAudioContext();
      const engine = await startedEngine();
      engine.triggerHold(400, variant);
      return partialsOf()[0].frequency.events.map((event) => event.value!);
    };

    // The plain roll sets its pitch once and holds it.
    expect(await stepsOf("root")).toHaveLength(1);

    const alternating = await stepsOf("rootFifth");
    expect(alternating.length).toBeGreaterThan(1);
    // Every step is either the root or a perfect fifth above it.
    const root = alternating[0];
    for (const step of alternating) {
      const ratio = step / root;
      expect(Math.abs(ratio - 1) < 1e-6 || Math.abs(ratio - 1.5) < 1e-6).toBe(
        true,
      );
    }
  });

  it("drops the tremolo for the swell variant", async () => {
    const oscillatorCount = async (variant: "root" | "swell") => {
      createdNodes = [];
      context = new TestAudioContext();
      const engine = await startedEngine();
      engine.triggerHold(400, variant);
      return context.oscillators.length;
    };

    // The rolled variant carries an LFO the swell does not.
    expect(await oscillatorCount("root")).toBe(4);
    expect(await oscillatorCount("swell")).toBe(3);
  });

  it("lets a longer hold sound longer, inside bounds", async () => {
    const lengthFor = async (holdSeconds: number | undefined) => {
      createdNodes = [];
      context = new TestAudioContext();
      const engine = await startedEngine();
      engine.triggerHold(400, "root", holdSeconds);
      const osc = partialsOf()[0];
      return osc.stopTimes[0]! - osc.startTimes[0];
    };

    const short = await lengthFor(0.5);
    const long = await lengthFor(2.5);
    expect(long).toBeGreaterThan(short);

    // Clamped either side, so a stray hold cannot leave a roll running.
    expect(await lengthFor(30)).toBeLessThan(3.5);
    expect(await lengthFor(0.01)).toBeGreaterThan(0.3);
  });

  it("self-disconnects the roll when its oscillators end", async () => {
    const engine = await startedEngine();
    engine.triggerHold(400, "rootFifth");
    for (const osc of context.oscillators) osc.onended?.();

    const stillConnected = createdNodes.filter(
      (node) =>
        node instanceof TestOscillatorNode && node.connections.length > 0,
    );
    expect(stillConnected).toEqual([]);
  });
});

describe("cantus firmus", () => {
  const startedEngine = async (): Promise<SoundEngine> => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(800);
    return engine;
  };

  /**
   * Run the engine's clock far enough forward to collect `count` cantus notes.
   * The line sings every 8-15s, so this steps in whole seconds rather than
   * frames — nothing in the cantus depends on frame rate.
   */
  const collectNotes = (
    engine: SoundEngine,
    count: number,
    options: { fromSecond?: number } = {},
  ): TestOscillatorNode[] => {
    const notes: TestOscillatorNode[] = [];
    // Only oscillators created from here on are this call's; a second call on
    // the same engine must not re-collect the first call's notes.
    let seen = context.oscillators.length;
    const start = options.fromSecond ?? 0;
    for (
      let second = start;
      second < start + 400 && notes.length < count;
      second++
    ) {
      context.currentTime += 1;
      engine.tick(second * 1000, []);
      // Each note is a sine plus its triangle partial; the sine is the note.
      for (const osc of context.oscillators.slice(seen)) {
        if (osc.type === "sine" && osc.startTimes.length > 0) notes.push(osc);
      }
      seen = context.oscillators.length;
    }
    return notes;
  };

  it("stays silent until it is switched on", async () => {
    const engine = await startedEngine();
    expect(engine.getCantus()).toBeNull();
    expect(collectNotes(engine, 1)).toEqual([]);
  });

  it("sings from the current chord, voice-led to the nearest tone", async () => {
    const engine = await startedEngine();
    engine.setConfig({ chordRotation: true });
    engine.setCantus("tenor");

    const notes = collectNotes(engine, 4);
    expect(notes.length).toBeGreaterThanOrEqual(4);

    // Every note belongs to some chord in the rotation — the line follows the
    // harmony rather than sitting on a fixed scale.
    const chords = PROGRESSIONS[engine.getProgressionId()].chords;
    for (const note of notes) {
      const inSomeChord = chords.some((chord) =>
        chord.pitches.some((tone) => {
          const octaves = Math.log2(note.frequency.value / tone);
          return Math.abs(octaves - Math.round(octaves)) < 1e-6;
        }),
      );
      expect(
        inSomeChord,
        `${note.frequency.value}Hz belongs to no chord in the rotation`,
      ).toBe(true);
    }

    // Voice leading: consecutive notes step rather than leap. A tritone is the
    // furthest `leadHomeTone` can ever move, so nothing should exceed it.
    for (let i = 1; i < notes.length; i++) {
      const semitones = Math.abs(
        12 *
          Math.log2(notes[i].frequency.value / notes[i - 1].frequency.value),
      );
      expect(semitones).toBeLessThanOrEqual(6 + 1e-6);
    }
  });

  it("holds each note long enough that the line overlaps", async () => {
    const engine = await startedEngine();
    engine.setCantus("tenor");

    const notes = collectNotes(engine, 2);
    expect(notes.length).toBeGreaterThanOrEqual(2);

    // A note runs at least eight seconds, and the next one starts before it
    // has finished — that overlap is what makes it one voice.
    const first = notes[0];
    const length = first.stopTimes[0]! - first.startTimes[0];
    expect(length).toBeGreaterThan(7);
    expect(notes[1].startTimes[0]).toBeLessThan(first.stopTimes[0]!);
  });

  it("sits in a mid register and drifts its pan across each note", async () => {
    const engine = await startedEngine();
    engine.setCantus("tenor");
    const notes = collectNotes(engine, 1);
    expect(notes.length).toBe(1);

    // Roughly C3-C4: below the bells, above the timpani.
    expect(notes[0].frequency.value).toBeGreaterThan(100);
    expect(notes[0].frequency.value).toBeLessThan(280);

    const panner = createdNodes.find(
      (node): node is TestStereoPannerNode =>
        node instanceof TestStereoPannerNode &&
        node.pan.events.some((event) => event.method === "linearRamp"),
    );
    expect(panner).toBeDefined();
    const [from, to] = panner!.pan.events.map((event) => event.value!);
    expect(from).not.toBe(to);
    for (const value of [from, to]) {
      expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
  });

  it("puts the soprano an octave above the tenor, and quieter", async () => {
    const firstNote = async (variant: "tenor" | "soprano") => {
      createdNodes = [];
      context = new TestAudioContext();
      const engine = await startedEngine();
      engine.setCantus(variant);
      const notes = collectNotes(engine, 1);
      // The note's own level node: the one that starts at the floor value the
      // cantus envelope opens from, rather than the master gain.
      const level = context.gains.find((gain) =>
        gain.gain.events.some(
          (event) => event.method === "set" && event.value === 0.0001,
        ),
      );
      expect(level).toBeDefined();
      const peak = level!.gain.events.find(
        (event) => event.method === "linearRamp",
      )!.value!;
      return { pitch: notes[0].frequency.value, peak };
    };

    const tenor = await firstNote("tenor");
    const soprano = await firstNote("soprano");
    expect(soprano.pitch).toBeCloseTo(tenor.pitch * 2, 6);
    // Up an octave the same level reads louder, hence the trim.
    expect(soprano.peak).toBeLessThan(tenor.peak);
  });

  it("offsets the duet's second voice rather than doubling the first", async () => {
    const engine = await startedEngine();
    engine.setCantus("duet");

    const notes = collectNotes(engine, 4);
    expect(notes.length).toBeGreaterThanOrEqual(4);

    // Two voices alternating: no two notes start together, or the duet is one
    // thicker voice rather than two.
    const starts = notes.map((note) => note.startTimes[0]);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("routes the line to its own mixer family", async () => {
    // The cantus belongs to no trail and no event, so it has to be silenceable
    // on its own to judge whether the scene holds together without it.
    const engine = await startedEngine();
    engine.setLayerMuted("cantus", true);
    expect(engine.getLayerMix().muted).toContain("cantus");
  });

  it("stops when it is switched off", async () => {
    const engine = await startedEngine();
    engine.setCantus("tenor");
    expect(collectNotes(engine, 1).length).toBe(1);

    engine.setCantus(null);
    expect(engine.getCantus()).toBeNull();
    // Continue the same clock rather than rewinding it — the line's next note
    // was already due, so a rewind would prove nothing.
    expect(collectNotes(engine, 1, { fromSecond: 400 })).toEqual([]);
  });
});

describe("offline rendering", () => {
  it("uses a caller-supplied context and leaves it open on dispose", async () => {
    // The offline render pipeline hands the engine an OfflineAudioContext and
    // renders the graph faster than real time. Nothing about the synthesis
    // changes; the engine must simply not open or close a context it was
    // given.
    const provided = new TestAudioContext();
    const engine = new SoundEngine(provided as unknown as BaseAudioContext);
    await engine.init();
    engine.setCanvasWidth(800);

    engine.triggerClickPizzicato(400, 300, "soft");
    expect(provided.oscillators.length).toBeGreaterThan(0);

    let closed = false;
    provided.close = () => {
      closed = true;
      return Promise.resolve();
    };
    engine.dispose();
    expect(closed).toBe(false);
  });
});

describe("spotlight promotion across playback clocks", () => {
  /**
   * One fast trail sweeping past a crowd of slow ones, played back at a given
   * tick interval. The gesture is defined in pixels per millisecond, so the
   * SAME physical motion is described at every cadence — only the sampling
   * changes, which is exactly what differs between the replay's 60fps rAF and
   * the archive page's slower ticks.
   */
  const sweep = async (tickMs: number) => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ mode: "spotlight" });

    // The promotion floor is 4px per 1/60s frame, i.e. 0.24 px/ms. The sweeper
    // travels a little over that — a real archive sweep, not a synthetic
    // sprint, so the test actually exercises the floor rather than clearing it
    // by an order of magnitude. The crowd drifts at a fifteenth of the speed,
    // well outside the 2.5x ratio.
    const fastPxPerMs = 0.3;
    const slowPxPerMs = 0.02;

    let promoted = false;
    for (let step = 0; step <= Math.ceil(3000 / tickMs); step++) {
      const elapsed = step * tickMs;
      const frames = [
        soloFrame(0, 100 + fastPxPerMs * elapsed, 300),
        soloFrame(1, 200 + slowPxPerMs * elapsed, 400),
        soloFrame(2, 500 + slowPxPerMs * elapsed, 500),
        soloFrame(3, 700 + slowPxPerMs * elapsed, 600),
      ];
      context.currentTime = elapsed / 1000;
      engine.tick(elapsed, frames);
      if (engine.getSoloistTrailIndex() === 0) promoted = true;
    }

    engine.dispose();
    return promoted;
  };

  // The replay's cadence, which is where the thresholds were tuned by ear.
  it("promotes the outlier at 60fps replay cadence", async () => {
    expect(await sweep(1000 / 60)).toBe(true);
  });

  // The archive page's own tick, and the hidden-tab fallback it drops to.
  // Velocity was measured as raw per-tick distance, so a slower tick inflated
  // every reading and a faster one shrank it below the promotion floor — the
  // same sweep promoted or not purely by how often the page happened to tick.
  it.each([25, 50, 100, 250])(
    "promotes the same sweep at a %ims tick",
    async (tickMs) => {
      expect(await sweep(tickMs)).toBe(true);
    },
  );

  /**
   * The regression this normalization exists for. A raw per-tick distance
   * shrinks as the page ticks more often, so a sweep that promotes at the
   * archive's slow tick silently stops promoting once the tab is foregrounded
   * and rAF speeds up — the soloist "never gets chosen" even though the motion
   * on screen is identical. 0.26 px/ms sits just over the 0.24 px/ms floor, so
   * it promotes only when velocity is expressed per reference frame.
   */
  it("promotes a just-over-floor sweep at a fast tick, not only a slow one", async () => {
    const nearFloorSweep = async (tickMs: number) => {
      const engine = new SoundEngine();
      await engine.init();
      engine.setCanvasWidth(1000);
      engine.setConfig({ mode: "spotlight" });

      let promoted = false;
      for (let step = 0; step <= Math.ceil(3000 / tickMs); step++) {
        const elapsed = step * tickMs;
        const frames = [
          soloFrame(0, 100 + 0.26 * elapsed, 300),
          soloFrame(1, 200 + 0.012 * elapsed, 400),
          soloFrame(2, 500 + 0.012 * elapsed, 500),
        ];
        context.currentTime = elapsed / 1000;
        engine.tick(elapsed, frames);
        if (engine.getSoloistTrailIndex() === 0) promoted = true;
      }
      engine.dispose();
      return promoted;
    };

    // 8ms is a 120Hz display, the fastest cadence the page realistically hits.
    expect(await nearFloorSweep(8)).toBe(true);
    expect(await nearFloorSweep(1000 / 60)).toBe(true);
  });

  it("leaves a scene with no outlier unpromoted at every cadence", async () => {
    for (const tickMs of [1000 / 60, 100, 250]) {
      const engine = new SoundEngine();
      await engine.init();
      engine.setCanvasWidth(1000);
      engine.setConfig({ mode: "spotlight" });

      for (let step = 0; step <= Math.ceil(3000 / tickMs); step++) {
        const elapsed = step * tickMs;
        // Everyone drifts at the same slow rate: no outlier, so the absolute
        // floor must keep the spotlight off however often the page ticks.
        const frames = [0, 1, 2, 3].map((i) =>
          soloFrame(i, 100 + i * 150 + 0.02 * elapsed, 300 + i * 80),
        );
        context.currentTime = elapsed / 1000;
        engine.tick(elapsed, frames);
        expect(engine.getSoloistTrailIndex()).toBeNull();
      }
      engine.dispose();
    }
  });
});

describe("smoothing that must advance on real elapsed time", () => {
  /**
   * The engine's exponential smoothers express their speed as a duration, so
   * the same wall-clock stretch has to advance one of them by the same amount
   * however it is cut into ticks. Stepping by a fixed nominal frame instead
   * means a slow tick advances fifteen times too little, and a ramp specified
   * as half a second takes most of a minute on a backgrounded tab.
   */
  interface SmoothingState {
    spotlightGains: Map<number, number>;
    swells: Map<number, { progress: number }>;
  }

  const sweepFor = async (
    tickMs: number,
    tickCount: number,
    read: (state: SmoothingState) => number,
  ) => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(8000);
    engine.setConfig({ mode: "spotlight", swells: true });

    let x = 0;
    for (let step = 1; step <= tickCount; step++) {
      // Same distance per millisecond either way, so the two runs are the same
      // gesture sampled at two rates rather than two different gestures.
      x += 0.75 * tickMs;
      context.currentTime += tickMs / 1000;
      engine.tick(step * tickMs, [
        soloFrame(0, x, 0),
        soloFrame(1, 1000 + step * 0.01, 500),
      ]);
    }

    const value = read(
      engine as unknown as {
        spotlightGains: Map<number, number>;
        swells: Map<number, { progress: number }>;
      },
    );
    engine.dispose();
    return value;
  };

  // Both rates stay inside the swell's motion grace window, so the two runs
  // differ only in how finely the same 3s of travel is sampled.
  const COARSE_TICK_MS = 200;
  const FINE_TICK_MS = 25;
  const SPAN_MS = 3000;

  it("advances the spotlight gain the same over 3s of coarse ticks as of fine ones", async () => {
    const read = (s: { spotlightGains: Map<number, number> }) =>
      s.spotlightGains.get(0)!;
    const coarse = await sweepFor(COARSE_TICK_MS, SPAN_MS / COARSE_TICK_MS, read);
    const fine = await sweepFor(FINE_TICK_MS, SPAN_MS / FINE_TICK_MS, read);

    // Both runs cover the same span, so the smoothed multiplier has reached
    // the same place. Exponential smoothing is not exactly rate-invariant, so
    // this is a tolerance rather than an equality — but a fixed-frame step
    // would leave the coarse run far short of the fine one, well outside it.
    // The soloist here is a bell voice, whose sustained tone ducks under its
    // own flourish, so the multiplier has travelled down from 1 rather than up.
    expect(coarse).toBeLessThan(1);
    expect(fine).toBeLessThan(1);
    expect(coarse).toBeCloseTo(fine, 1);
  });

  it("advances the swell the same over 3s of coarse ticks as of fine ones", async () => {
    const read = (s: { swells: Map<number, { progress: number }> }) =>
      s.swells.get(0)!.progress;
    const coarse = await sweepFor(COARSE_TICK_MS, SPAN_MS / COARSE_TICK_MS, read);
    const fine = await sweepFor(FINE_TICK_MS, SPAN_MS / FINE_TICK_MS, read);

    expect(coarse).toBeGreaterThan(0);
    expect(fine).toBeGreaterThan(0);
    expect(coarse).toBeCloseTo(fine, 1);
  });
});

describe("presence on a driven promotion", () => {
  /**
   * Sweep one trail fast enough to take the spotlight while a second trail
   * crawls, and report what the soloist's own sustained voice ended up doing.
   * The trail is coloured into the soprano band deliberately: that is the
   * register the old descant's lift was silently cancelled in, and the
   * register presence must now leave alone.
   */
  const promoteSoloist = async (
    soloistVoice: "bells" | "presence",
    steps = 60,
  ) => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(8000);
    engine.setConfig({ mode: "spotlight", soloistVoice, trailVoices: true });

    const state = engine as unknown as {
      voices: Map<
        number,
        {
          currentFrequency: number;
          present: boolean;
          halo: { oscillator: TestOscillatorNode; gain: { gain: TestAudioParam } } | null;
          reverbSend: { gain: TestAudioParam } | null;
          filterNode: { frequency: TestAudioParam };
        }
      >;
      spotlightGains: Map<number, number>;
    };

    let x = 0;
    for (let step = 0; step < steps; step++) {
      x += 12;
      context.currentTime += 1 / 60;
      engine.tick(step * 16, [
        { ...soloFrame(0, x, 0), color: "#ff4466" },
        soloFrame(1, 1000 + step * 0.2, 500),
      ]);
    }

    expect(engine.getSoloistTrailIndex()).toBe(0);
    const voice = state.voices.get(0)!;
    return {
      engine,
      voice,
      spotlightGain: state.spotlightGains.get(0)!,
    };
  };

  it("leaves the soloist in the register it was already singing in", async () => {
    const plain = await promoteSoloist("bells");
    const present = await promoteSoloist("presence");

    expect(present.voice.present).toBe(true);

    // The whole point of presence over a descant: the promoted trail keeps the
    // part its colour assigned it. A promotion that moved the pitch would make
    // it a different voice rather than the same voice stepping forward.
    expect(present.voice.currentFrequency).toBeCloseTo(
      plain.voice.currentFrequency,
      4,
    );

    plain.engine.dispose();
    present.engine.dispose();
  });

  it("opens the filter, leans the gain in and dries the voice out", async () => {
    const { engine, voice, spotlightGain } = await promoteSoloist("presence");

    const ramps = voice.filterNode.frequency.events.filter(
      (event) => event.method === "linearRamp",
    );
    expect(ramps[ramps.length - 1]?.value).toBe(PRESENCE_TUNING.filterHz);

    // The flourish soloist ducks its sustained voice so its discrete notes can
    // carry the promotion. Presence has no discrete notes, so it leans in
    // instead — a duck here would cancel the promotion it is carrying.
    expect(spotlightGain).toBeGreaterThan(1);

    // Less of the soloist reaches the room, which is what puts it in front of
    // the reverb rather than inside it.
    const sendRamps = voice.reverbSend!.gain.events.filter(
      (event) => event.method === "linearRamp",
    );
    expect(sendRamps[sendRamps.length - 1]?.value).toBe(
      PRESENCE_TUNING.reverbSendScale,
    );

    engine.dispose();
  });

  it("returns the send to the room when the promotion ends", async () => {
    const { engine, voice } = await promoteSoloist("presence");
    expect(voice.present).toBe(true);

    // Demote by handing the spotlight to nobody: presence must hand back
    // everything it took, or a trail that once soloed stays permanently dry.
    engine.setConfig({ mode: "sustained" });
    context.currentTime += 1 / 60;
    engine.tick(2000, [{ ...soloFrame(0, 900, 0), color: "#ff4466" }]);

    expect(voice.present).toBe(false);
    const sendRamps = voice.reverbSend!.gain.events.filter(
      (event) => event.method === "linearRamp",
    );
    expect(sendRamps[sendRamps.length - 1]?.value).toBe(1);
    // The halo leaves first, so the voice is alone again before it finishes
    // stepping back.
    expect(voice.halo).toBeNull();

    engine.dispose();
  });

  it("holds the halo back until the promotion has lasted, then doubles at the octave", async () => {
    // Well short of the onset delay: a brief spotlight must not flicker a
    // second voice in and out.
    const early = await promoteSoloist("presence", 20);
    expect(early.voice.present).toBe(true);
    expect(early.voice.halo).toBeNull();
    early.engine.dispose();

    const held = await promoteSoloist("presence", 90);
    const halo = held.voice.halo;
    expect(halo).not.toBeNull();

    // Exactly the octave, or exactly the voice's own pitch when doubling would
    // climb past the soprano band. Anything in between reads as out of tune.
    expect(halo!.oscillator.frequency.value).toBeCloseTo(
      haloPitch(held.voice.currentFrequency),
      4,
    );
    const doubled = held.voice.currentFrequency * PRESENCE_TUNING.haloMultiple;
    expect(halo!.oscillator.frequency.value).toBe(
      doubled > PRESENCE_TUNING.haloCeilingHz
        ? held.voice.currentFrequency
        : doubled,
    );
    expect(halo!.oscillator.frequency.value).toBeLessThanOrEqual(
      PRESENCE_TUNING.haloCeilingHz,
    );

    held.engine.dispose();
  });
});

describe("the presence audition", () => {
  it("leans one chord tone forward over a quiet pad, with its double behind it", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ soloistVoice: "presence" });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };
    engine.audition("soloistPresence");

    const pitches = [...state.flourishNotes].map(
      (note) => note.oscillator.frequency.value,
    );

    // The leaning tone and its double, plus one voice per pad tone.
    expect(pitches).toHaveLength(2 + PRESENCE_TUNING.auditionPadTones);

    const tones = chordTones(
      (engine as unknown as { flourishPalette(): number[] }).flourishPalette(),
    );
    const base = tones[0];
    expect(pitches).toContain(base);
    expect(pitches).toContain(haloPitch(base));

    // Every tone is drawn from the same chord, so the crowd the voice steps
    // out of is the harmony it is stepping forward within.
    for (const pitch of pitches) {
      expectPitchClassInPalette(pitch, tones);
    }

    // The pad is a bed, not a second subject.
    const pair = [base, haloPitch(base)];
    const padTones = [...state.flourishNotes].filter(
      (note) => !pair.includes(note.oscillator.frequency.value),
    );
    expect(padTones).toHaveLength(PRESENCE_TUNING.auditionPadTones);
    expect(PRESENCE_TUNING.auditionPadGain).toBeLessThan(1);

    engine.dispose();
  });
});

describe("envelopes that must not be cut mid-sound", () => {
  /**
   * The last value an envelope is scheduled to reach, and when. A one-shot
   * note's oscillator is stopped at a fixed time, so whatever the envelope is
   * holding at that moment is cut mid-cycle — which is only silent if the
   * envelope actually reached zero first.
   */
  const finalRamp = (param: TestAudioParam) => {
    const ramps = param.events.filter(
      (event) => event.method === "linearRamp" || event.method === "exponentialRamp",
    );
    return ramps[ramps.length - 1];
  };

  it("walks the click bell to true zero before stopping its oscillators", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setConfig({ trailVoices: true });

    const gainsBefore = context.gains.length;
    const oscillatorsBefore = context.oscillators.length;
    engine.triggerClick({ x: 10, y: 10, holdDuration: undefined });

    // The bell's two envelopes, in the order triggerClick builds them.
    const [fundamental, partial] = context.gains.slice(gainsBefore);
    for (const envelope of [fundamental, partial]) {
      const last = finalRamp(envelope.gain);
      // An exponential ramp cannot reach zero; without a final linear walk the
      // envelope levels off at its floor and the stop cuts a sounding tone.
      expect(last?.method).toBe("linearRamp");
      expect(last?.value).toBe(0);
    }

    // And every oscillator stops at or after its envelope reaches silence,
    // never before it.
    const silentAt = finalRamp(fundamental.gain)!.time;
    for (const oscillator of context.oscillators.slice(oscillatorsBefore)) {
      for (const stopTime of oscillator.stopTimes) {
        expect(stopTime).toBeGreaterThanOrEqual(silentAt);
      }
    }

    engine.dispose();
  });

  it("fits a repeated pluck's envelope inside its own repeat interval", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setConfig({ trailVoices: true, cursorInstruments: true });

    const frame = (x: number, prevX: number) => ({
      trailIndex: 0,
      x,
      y: 0,
      prevX,
      prevY: 0,
      cursorType: "text",
      progress: 0,
      color: "#000",
      isNewlyActive: false,
    });

    // A percussive voice retriggers one gain node in place every
    // PLUCK_REPEAT_INTERVAL_MS, so its envelope has to have finished before
    // the next pluck is scheduled. An envelope longer than the interval means
    // every pluck cancels a decay still in flight, which holds the gain at its
    // peak rather than decaying it — the gain then walks upward pluck by pluck
    // and steps at each retrigger.
    const PLUCK_REPEAT_INTERVAL_MS = 120;

    // Drive the trail long enough to voice two plucks, so the second one's
    // schedule can be measured against the first one's envelope.
    const pluckTimes: number[] = [];
    let elapsedMs = 0;
    let x = 0;
    for (let step = 0; step < 30; step++) {
      const prevX = x;
      x += 30;
      engine.tick(elapsedMs, [frame(x, prevX)]);
      const voice = context.gains.find((gain) =>
        gain.gain.events.some((event) => event.method === "exponentialRamp"),
      );
      if (voice && pluckTimes.length < voice.gain.events.filter(
        (event) => event.method === "exponentialRamp",
      ).length) {
        pluckTimes.push(context.currentTime);
      }
      elapsedMs += 1000 / 60;
      context.currentTime += 1 / 60;
    }

    const voiceGain = context.gains.find((gain) =>
      gain.gain.events.some((event) => event.method === "exponentialRamp"),
    );
    expect(voiceGain, "the text cursor never voiced a pluck").toBeDefined();

    const decays = voiceGain!.gain.events.filter(
      (event) => event.method === "exponentialRamp",
    );
    expect(decays.length).toBeGreaterThan(0);

    // Each decay must land within one repeat interval of the pluck that
    // scheduled it.
    decays.forEach((decay, index) => {
      const scheduledAt = pluckTimes[index];
      expect(scheduledAt, `no recorded start for decay ${index}`).toBeDefined();
      expect(decay.time - scheduledAt).toBeLessThanOrEqual(
        PLUCK_REPEAT_INTERVAL_MS / 1000,
      );
    });

    engine.dispose();
  });

  it("closes a stopped trail's breath without cancelling its envelope", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setConfig({ trailVoices: true, cursorInstruments: true, swells: true });

    const frame = (x: number, prevX: number) => ({
      trailIndex: 0,
      x,
      y: 0,
      prevX,
      prevY: 0,
      cursorType: "text",
      progress: 0,
      color: "#000",
      isNewlyActive: false,
    });

    // Move the trail far enough to voice plucks, which schedule attack and
    // decay ahead of the clock on the voice's envelope gain.
    let elapsedMs = 0;
    let x = 0;
    for (let step = 0; step < 20; step++) {
      const prevX = x;
      x += 30;
      engine.tick(elapsedMs, [frame(x, prevX)]);
      elapsedMs += 1000 / 60;
      context.currentTime += 1 / 60;
    }

    const state = engine as unknown as {
      voices: Map<number, { gainNode: TestGainNode; fadeNode: TestGainNode }>;
    };
    const voice = state.voices.get(0);
    expect(voice, "the trail never took a voice").toBeDefined();

    const envelopeHoldsWhileMoving = voice!.gainNode.gain.events.filter(
      (event) => event.method === "cancelAndHold",
    ).length;

    // Now hold the trail still, which is what closes its breath. An idle trail
    // is faded on every tick it stays still, so this runs many times over.
    for (let step = 0; step < 20; step++) {
      engine.tick(elapsedMs, [frame(x, x)]);
      elapsedMs += 1000 / 60;
      context.currentTime += 1 / 60;
    }

    // The breath is closed on a node of its own, so the fade's repeated
    // anchoring never reaches the envelope's param. Cancelling there would
    // truncate a pluck's scheduled decay mid-flight, and a truncated envelope
    // is a step discontinuity — the ticking this separation exists to remove.
    expect(
      voice!.gainNode.gain.events.filter(
        (event) => event.method === "cancelAndHold",
      ).length,
    ).toBe(envelopeHoldsWhileMoving);

    // And the fade actually happened, on the node that owns it.
    const fadeRamps = voice!.fadeNode.gain.events.filter(
      (event) => event.method === "linearRamp" && event.value === 0,
    );
    expect(fadeRamps.length).toBeGreaterThan(0);

    engine.dispose();
  });
});

describe("the one-shot note budget", () => {
  it("cuts the note furthest through its envelope, not the quietest", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const state = engine as unknown as {
      flourishNotes: Set<{
        peakGain: number;
        startedAtMs: number;
        durationMs: number;
      }>;
      enforceFlourishBudget(): void;
    };

    // An arrival chime is quieter than a flourish note by design, so a budget
    // that chose by peak gain evicted every chime the engine ever scheduled
    // and none of the flourish notes competing with them.
    const chime = { peakGain: 0.026, startedAtMs: 900, durationMs: 2000 };
    const flourish = { peakGain: 0.055, startedAtMs: 0, durationMs: 1000 };

    const nowMs = context.currentTime * 1000;
    // The flourish is further through its own envelope than the chime, so it
    // is what a cut costs least.
    expect((nowMs - flourish.startedAtMs) / flourish.durationMs).toBeGreaterThan(
      (nowMs - chime.startedAtMs) / chime.durationMs,
    );

    const cap = 16;
    for (let index = 0; index < cap - 2; index++) {
      state.flourishNotes.add({
        peakGain: 0.055,
        startedAtMs: 800,
        durationMs: 5000,
      });
    }
    state.flourishNotes.add(chime as never);
    state.flourishNotes.add(flourish as never);
    expect(state.flourishNotes.size).toBe(cap);

    state.enforceFlourishBudget();

    expect(state.flourishNotes.has(chime as never)).toBe(true);
    expect(state.flourishNotes.has(flourish as never)).toBe(false);

    engine.dispose();
  });

  it("never evicts a note that has not started while a sounding one remains", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const state = engine as unknown as {
      flourishNotes: Set<{
        peakGain: number;
        startedAtMs: number;
        durationMs: number;
      }>;
      enforceFlourishBudget(): void;
    };

    const nowMs = context.currentTime * 1000;
    // A chime cluster is scheduled with delays, so several of its notes are
    // still in the future when the next note wants a slot. Cutting one of
    // those silences a chime that never sounded at all.
    const pending = {
      peakGain: 0.026,
      startedAtMs: nowMs + 500,
      durationMs: 2000,
    };
    const sounding = {
      peakGain: 0.055,
      startedAtMs: nowMs - 900,
      durationMs: 1000,
    };

    for (let index = 0; index < 14; index++) {
      state.flourishNotes.add({
        peakGain: 0.055,
        startedAtMs: nowMs - 100,
        durationMs: 5000,
      });
    }
    state.flourishNotes.add(pending as never);
    state.flourishNotes.add(sounding as never);

    state.enforceFlourishBudget();

    expect(state.flourishNotes.has(pending as never)).toBe(true);
    expect(state.flourishNotes.has(sounding as never)).toBe(false);

    engine.dispose();
  });
});

describe("automation timeline", () => {
  /**
   * A ramp that lands inside the one already running on the same param is an
   * automation shape with two answers for the same instant, and Web Audio does
   * not say which wins. An implementation that resolves it by carrying the
   * earlier ramp's slope past the new endpoint drives the param far outside
   * the range either ramp asked for and holds it there — a click going in and
   * a stuck offset after.
   *
   * The sustained bed reaches that shape constantly: a trail that starts
   * moving opens its breath over the control ramp, and a trail that stops a
   * tick later closes it over a shorter fade that lands inside the open. This
   * asserts the engine never emits the shape, on the param it emitted it on.
   */
  const assertRampsNeverLandInsideEachOther = (param: TestAudioParam): void => {
    let runningEnd = Number.NEGATIVE_INFINITY;
    for (const event of param.events) {
      if (event.method !== "linearRamp" && event.method !== "exponentialRamp") {
        if (event.method === "set") runningEnd = Number.NEGATIVE_INFINITY;
        continue;
      }
      expect(
        event.time,
        `a ramp ending ${event.time} lands inside the ramp running until ${runningEnd}`,
      ).toBeGreaterThanOrEqual(runningEnd);
      runningEnd = event.time;
    }
  };

  it("never lands a voice's breath ramp inside the one already running", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);
    engine.setConfig({ swells: false, cursorInstruments: false });

    const moving = (x: number) => ({
      trailIndex: 0,
      x,
      y: 0,
      prevX: x - 20,
      prevY: 0,
      cursorType: "default",
      progress: 0,
      color: "#000",
      isNewlyActive: false,
    });
    const still = (x: number) => ({ ...moving(x), prevX: x });

    engine.tick(0, [{ ...moving(0), isNewlyActive: true }]);

    // A long stillness first, so the breath is closing over the release ramp,
    // then one moving frame to reopen it, then stillness again on the very
    // next frame. The reopen runs the control ramp and the close that follows
    // it one frame later is shorter, so it lands inside — the shape itself.
    // The engine reads velocity from its own previous position, so a still
    // frame has to repeat the position rather than merely claim it did.
    let x = 20;
    let frame = 1;
    const step = (isMoving: boolean) => {
      context.currentTime += 1 / 60;
      if (isMoving) x += 40;
      engine.tick(frame * (1000 / 60), [isMoving ? moving(x) : still(x)]);
      frame++;
    };

    for (let round = 0; round < 6; round++) {
      // Stillness closes the breath, then one moving frame reopens it over the
      // control ramp, then the very next frame is still again and closes it
      // over a shorter fade that lands inside the open. That interruption is
      // the shape.
      for (let held = 0; held < 4; held++) step(false);
      step(true);
      step(false);
    }

    const fades = context.gains.filter((gain) =>
      gain.gain.events.some(
        (event) => event.method === "linearRamp" && event.value === 1,
      ),
    );
    expect(fades.length).toBeGreaterThan(0);
    for (const fade of fades) assertRampsNeverLandInsideEachOther(fade.gain);

    engine.dispose();
  });

  it("keeps a retired voice's oscillator running until its fade reaches zero", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(100);
    engine.setConfig({ swells: true, cursorInstruments: false });

    engine.tick(0, [
      {
        trailIndex: 0,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "default",
        progress: 0,
        color: "#000",
        isNewlyActive: true,
      },
    ]);
    // Moving, so the voice is sounding and its control ramp is in flight when
    // the retirement lands and has to be clamped past it.
    context.currentTime += 1 / 60;
    engine.tick(1000 / 60, [
      {
        trailIndex: 0,
        x: 40,
        y: 0,
        prevX: 0,
        prevY: 0,
        cursorType: "default",
        progress: 0,
        color: "#000",
        isNewlyActive: false,
      },
    ]);
    context.currentTime += 1 / 60;
    engine.retireTrail(0);

    const faded = context.gains.filter((gain) =>
      gain.gain.events.some(
        (event) => event.method === "linearRamp" && event.value === 0,
      ),
    );
    expect(faded.length).toBeGreaterThan(0);
    for (const gain of faded) assertRampsNeverLandInsideEachOther(gain.gain);

    // Every stop lands at or after the fade that precedes it, so nothing is
    // cut while it is still sounding.
    for (const oscillator of context.oscillators) {
      for (const stopTime of oscillator.stopTimes) {
        if (stopTime === undefined) continue;
        for (const gain of faded) {
          const lastZero = [...gain.gain.events]
            .reverse()
            .find(
              (event) => event.method === "linearRamp" && event.value === 0,
            );
          if (!lastZero) continue;
          expect(stopTime).toBeGreaterThanOrEqual(lastZero.time);
        }
      }
    }

    engine.dispose();
  });
});
