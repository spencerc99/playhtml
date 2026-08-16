// ABOUTME: Tests audio-graph transitions in the movement visualization sound engine.
// ABOUTME: Verifies cursor timbre changes crossfade without stacking full-level oscillators.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SoundEngine } from "../SoundEngine";
import {
  bellScaleForChord,
  CHORD_DWELL_MS,
  CHORD_PROGRESSION,
  D_MINOR_PENTATONIC,
  leadHomeTone,
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

class TestAudioContext {
  currentTime = 1;
  destination = new TestAudioNode();
  sampleRate = 100;
  state: AudioContextState = "running";
  gains: TestGainNode[] = [];
  oscillators: TestOscillatorNode[] = [];

  get nodes(): TestAudioNode[] {
    return createdNodes;
  }

  createBiquadFilter(): BiquadFilterNode {
    return new TestBiquadFilterNode() as unknown as BiquadFilterNode;
  }

  createBuffer(_channels: number, length: number): AudioBuffer {
    return {
      getChannelData: () => new Float32Array(length),
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

  it("rings click bells from the fixed scale when rotation is off", async () => {
    const engine = new SoundEngine();
    await engine.init();

    const before = context.oscillators.length;
    engine.triggerClick({ x: 10, y: 0, holdDuration: 0 });

    // Top of the pad maps to the top of the scale, unchanged from before the
    // progression existed.
    expect(context.oscillators[before].frequency.value).toBe(587.33);
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
    // Every note is a palette pitch, possibly shifted an octave for register.
    for (const pitch of pitches) {
      const inPalette = palette.some(
        (p) => Math.abs(p - pitch) < 0.01 || Math.abs(p * 2 - pitch) < 0.01,
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

  it("chimes an arrival from the top of the palette, high and detuned", async () => {
    const engine = new SoundEngine();
    await engine.init();
    engine.setCanvasWidth(1000);
    engine.setConfig({ trailArrivals: true });

    const state = engine as unknown as {
      flourishNotes: Set<{ oscillator: TestOscillatorNode }>;
    };

    engine.tick(0, [{ ...soloFrame(0, 10, 10), identityKey: "person-a" }]);
    const notes = [...state.flourishNotes];
    expect(notes.length).toBeGreaterThanOrEqual(3);

    // The chime draws only from the top of the palette, doubled — so it rings
    // above the sustained bed rather than inside it, and stays in key. With
    // rotation off the palette is the base D minor pentatonic.
    const top = [...D_MINOR_PENTATONIC]
      .sort((a, b) => a - b)
      .slice(-5)
      .map((hz) => hz * 2);
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

    const dmPalette = CHORD_PROGRESSION[0].pitches;
    const dmHomes = [0, 1].map((i) => engine.getHomeTone(i)!);
    for (const home of dmHomes) {
      expect(dmPalette).toContain(home);
    }

    // Past the dwell the progression moves; a trail's seat is re-derived
    // against the new palette rather than holding a pitch outside it.
    context.currentTime += 1 / 60;
    engine.tick(CHORD_DWELL_MS + 1, framesAt(5));

    const bbPalette = CHORD_PROGRESSION[1].pitches;
    const bbHomes = [0, 1].map((i) => engine.getHomeTone(i)!);
    for (const home of bbHomes) {
      expect(bbPalette).toContain(home);
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
    let previous = engine.getHomeTone(0)!;
    for (let turn = 1; turn <= CHORD_PROGRESSION.length; turn++) {
      context.currentTime += 1 / 60;
      engine.tick(turn * (CHORD_DWELL_MS + 1), frames(3 + turn));

      const palette = CHORD_PROGRESSION[turn % CHORD_PROGRESSION.length].pitches;
      const home = engine.getHomeTone(0)!;
      expect(palette).toContain(home);
      expect(leadHomeTone(previous, palette)).toBe(home);
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

    // Every ringing pitch is a palette tone (possibly octave-shifted for
    // register) — a dissonant crossing rings a continuous baseFreq derived
    // from screen position and would essentially never land on one.
    const palette = CHORD_PROGRESSION[0].pitches;
    for (const pitch of pitches) {
      const inPalette = palette.some(
        (p) =>
          Math.abs(p - pitch) < 0.01 ||
          Math.abs(p * 2 - pitch) < 0.01 ||
          Math.abs(p * 3 - pitch) < 0.01 ||
          Math.abs(p * 6 - pitch) < 0.01,
      );
      expect(inPalette, `${pitch} should be a palette pitch`).toBe(true);
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

describe("SoundEngine layer mixer", () => {
  /**
   * The mixer is a playground diagnostic, so the semantics that matter are the
   * standard ones a mixing desk has: solo overrides everything, mute silences,
   * and clearing restores the whole mix.
   */
  const ALL_LAYERS = [
    "bed",
    "flourish",
    "clickBell",
    "chime",
    "navigation",
    "bassPedal",
    "crossing",
  ] as const;

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
