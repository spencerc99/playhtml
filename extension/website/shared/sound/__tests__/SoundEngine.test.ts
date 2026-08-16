// ABOUTME: Tests audio-graph transitions in the movement visualization sound engine.
// ABOUTME: Verifies cursor timbre changes crossfade without stacking full-level oscillators.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SoundEngine } from "../SoundEngine";
import {
  bellScaleForChord,
  CHORD_DWELL_MS,
  CHORD_PROGRESSION,
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

class TestAudioNode {
  connections: TestAudioNode[] = [];

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

const originalAudioContext = globalThis.AudioContext;
let context: TestAudioContext;

beforeEach(() => {
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
