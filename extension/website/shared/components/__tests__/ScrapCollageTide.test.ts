// ABOUTME: Unit tests for the internet-scraps tide rotation queue and its rhythm.
// ABOUTME: Covers pool re-derivation, independent wash-in/wash-out, band bias, waves, and fairness.

import { describe, expect, it } from "vitest";
import {
  deriveTideState,
  nextTideEvent,
  occupiedTideSlots,
  washInTide,
  washOutTide,
  type TideState,
} from "../ScrapCollage";

const POOL = ["a", "b", "c", "d", "e"];

/** Deterministic stand-in for Math.random that replays a fixed draw sequence. */
function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

function fullShore(size: number, poolSize: number): TideState {
  const keys = Array.from({ length: poolSize }, (_, index) => `k${index}`);
  return deriveTideState(keys, size);
}

describe("deriveTideState", () => {
  it("puts the first targetCount keys ashore and queues the rest", () => {
    expect(deriveTideState(POOL, 3)).toEqual({
      ashore: ["a", "b", "c"],
      offshore: ["d", "e"],
    });
  });

  it("leaves the offshore queue empty when the pool fits ashore", () => {
    expect(deriveTideState(["a", "b"], 5)).toEqual({
      ashore: ["a", "b"],
      offshore: [],
    });
  });

  it("keeps ashore and offshore ordering for keys still in the pool", () => {
    const previous: TideState = { ashore: ["c", "a"], offshore: ["e", "b"] };
    expect(deriveTideState(POOL, 2, previous)).toEqual({
      ashore: ["c", "a"],
      offshore: ["e", "b", "d"],
    });
  });

  it("drops keys the filter removed and queues newly matching keys at the back", () => {
    const previous: TideState = { ashore: ["a", "b"], offshore: ["c"] };
    expect(deriveTideState(["b", "x", "y"], 2, previous)).toEqual({
      ashore: ["b", "x"],
      offshore: ["y"],
    });
  });

  it("does not duplicate a key that appears in both previous halves", () => {
    const previous: TideState = { ashore: ["a"], offshore: ["a", "b"] };
    const tide = deriveTideState(["a", "b"], 1, previous);
    expect([...tide.ashore, ...tide.offshore]).toEqual(["a", "b"]);
  });

  it("clamps a targetCount larger than the pool", () => {
    expect(deriveTideState(["a"], 10).ashore).toEqual(["a"]);
  });

  it("fills bare slots back in when the pool is re-derived", () => {
    const previous: TideState = { ashore: ["a", null, "c"], offshore: ["d"] };
    expect(deriveTideState(["a", "c", "d"], 3, previous)).toEqual({
      ashore: ["a", "c", "d"],
      offshore: [],
    });
  });
});

describe("washOutTide", () => {
  it("bares the slot and sends the key to the back of the queue", () => {
    const state: TideState = { ashore: ["a", "b", "c"], offshore: ["d", "e"] };
    expect(washOutTide(state, 1)).toEqual({
      ashore: ["a", null, "c"],
      offshore: ["d", "e", "b"],
    });
  });

  it("leaves every other slot untouched", () => {
    const state: TideState = { ashore: ["a", "b", "c"], offshore: [] };
    const next = washOutTide(state, 2);
    expect(next.ashore[0]).toBe("a");
    expect(next.ashore[1]).toBe("b");
  });

  it("washes out even when nothing is waiting offshore", () => {
    const state: TideState = { ashore: ["a", "b"], offshore: [] };
    expect(washOutTide(state, 0)).toEqual({
      ashore: [null, "b"],
      offshore: ["a"],
    });
  });

  it("returns the same state for a bare or out-of-range slot", () => {
    const state: TideState = { ashore: ["a", null], offshore: ["b"] };
    expect(washOutTide(state, 1)).toBe(state);
    expect(washOutTide(state, 5)).toBe(state);
    expect(washOutTide(state, -1)).toBe(state);
  });
});

describe("washInTide", () => {
  it("takes the queue head into the requested bare slot", () => {
    const state: TideState = { ashore: ["a", null, "c"], offshore: ["d", "e"] };
    expect(washInTide(state, 1)).toEqual({
      ashore: ["a", "d", "c"],
      offshore: ["e"],
    });
  });

  it("fills the first bare slot when none is requested", () => {
    const state: TideState = { ashore: [null, "b", null], offshore: ["d"] };
    expect(washInTide(state)).toEqual({
      ashore: ["d", "b", null],
      offshore: [],
    });
  });

  it("falls back to the first bare slot when the requested one is occupied", () => {
    const state: TideState = { ashore: ["a", null], offshore: ["d"] };
    expect(washInTide(state, 0).ashore).toEqual(["a", "d"]);
  });

  it("adds a slot at the end of a full shore", () => {
    const state: TideState = { ashore: ["a", "b"], offshore: ["c"] };
    expect(washInTide(state)).toEqual({
      ashore: ["a", "b", "c"],
      offshore: [],
    });
  });

  it("returns the same state when nothing is offshore", () => {
    const state: TideState = { ashore: ["a", null], offshore: [] };
    expect(washInTide(state)).toBe(state);
  });
});

describe("occupiedTideSlots", () => {
  it("reports only the slots holding a scrap", () => {
    expect(
      occupiedTideSlots({ ashore: ["a", null, "c", null], offshore: [] }),
    ).toEqual([0, 2]);
  });

  it("reports nothing for a fully bare shore", () => {
    expect(occupiedTideSlots({ ashore: [null, null], offshore: ["a"] })).toEqual(
      [],
    );
  });
});

describe("nextTideEvent", () => {
  const alwaysLow = sequenceRandom([0]);
  const alwaysHigh = sequenceRandom([0.999]);

  it("keeps its delay inside the jitter band", () => {
    const state = fullShore(20, 40);
    for (let draw = 0; draw <= 20; draw += 1) {
      const event = nextTideEvent(state, 20, sequenceRandom([draw / 20]));
      expect(event.delayMs).toBeGreaterThanOrEqual(1000);
      expect(event.delayMs).toBeLessThanOrEqual(7000);
    }
  });

  it("draws different delays for different draws", () => {
    const state = fullShore(20, 40);
    expect(nextTideEvent(state, 20, alwaysLow).delayMs).not.toBe(
      nextTideEvent(state, 20, alwaysHigh).delayMs,
    );
  });

  it("only sheds when the shore is already at target", () => {
    const state = fullShore(20, 40);
    for (let draw = 0; draw <= 10; draw += 1) {
      const event = nextTideEvent(state, 20, sequenceRandom([draw / 10]));
      expect(event.kind).not.toBe("in");
    }
  });

  it("refills when the shore has drifted below the band floor", () => {
    // 20 target, floor at 17: 14 ashore is well under it.
    const state: TideState = {
      ashore: [
        ...Array.from({ length: 14 }, (_, index) => `k${index}`),
        ...Array.from({ length: 6 }, () => null),
      ],
      offshore: ["x", "y"],
    };
    for (let draw = 0; draw <= 10; draw += 1) {
      expect(nextTideEvent(state, 20, sequenceRandom([draw / 10])).kind).toBe(
        "in",
      );
    }
  });

  it("goes either way inside the band", () => {
    // 20 target, floor 17: 18 ashore sits inside the band.
    const state: TideState = {
      ashore: [
        ...Array.from({ length: 18 }, (_, index) => `k${index}`),
        null,
        null,
      ],
      offshore: ["x"],
    };
    expect(nextTideEvent(state, 20, sequenceRandom([0])).kind).toBe("in");
    expect(nextTideEvent(state, 20, sequenceRandom([0.9])).kind).not.toBe("in");
  });

  it("sheds rather than stalling when the queue is empty", () => {
    const state: TideState = {
      ashore: ["a", "b", null, null, null],
      offshore: [],
    };
    expect(nextTideEvent(state, 5, alwaysLow).kind).not.toBe("in");
  });

  it("washes in rather than emptying the last scrap off a bare shore", () => {
    const state: TideState = { ashore: [null, null], offshore: ["a"] };
    expect(nextTideEvent(state, 2, alwaysHigh).kind).toBe("in");
  });

  it("keeps wave sizes and stagger inside their bounds", () => {
    const state = fullShore(20, 40);
    let sawWave = false;
    for (let draw = 0; draw < 200; draw += 1) {
      // Third draw decides wave-or-not, fourth its size, fifth the stagger.
      const event = nextTideEvent(
        state,
        20,
        sequenceRandom([0.9, draw / 200, 0.01, draw / 200, draw / 200]),
      );
      if (event.kind !== "wave") continue;
      sawWave = true;
      expect(event.count).toBeGreaterThanOrEqual(2);
      expect(event.count).toBeLessThanOrEqual(4);
      expect(event.staggerMs).toBeGreaterThanOrEqual(100);
      expect(event.staggerMs).toBeLessThanOrEqual(300);
    }
    expect(sawWave).toBe(true);
  });

  it("gives single events a count of one and no stagger", () => {
    const state = fullShore(20, 40);
    const event = nextTideEvent(state, 20, sequenceRandom([0.9, 0.5, 0.99]));
    expect(event.kind).toBe("out");
    expect(event.count).toBe(1);
    expect(event.staggerMs).toBe(0);
  });

  it("never takes more scraps than are ashore in a wave", () => {
    const state: TideState = {
      ashore: ["a", "b", "c", null, null],
      offshore: [],
    };
    const event = nextTideEvent(state, 5, sequenceRandom([0.9, 0.5, 0.01, 0.99]));
    expect(event.count).toBeLessThanOrEqual(3);
  });

  it("does not wave when too few scraps are ashore to spare them", () => {
    const state: TideState = { ashore: ["a", "b", null], offshore: [] };
    expect(nextTideEvent(state, 3, sequenceRandom([0.9, 0.5, 0.01])).kind).toBe(
      "out",
    );
  });
});

describe("tide rhythm over time", () => {
  /**
   * Runs the real scheduler against a seeded random source, applying each event
   * the way the component does, so the assertions below describe the actual
   * rhythm rather than a stand-in for it.
   */
  function runTide(
    poolSize: number,
    targetCount: number,
    steps: number,
    rand: () => number,
  ) {
    const keys = Array.from({ length: poolSize }, (_, index) => `k${index}`);
    let state = deriveTideState(keys, targetCount);
    const seen = new Set<string>(
      state.ashore.filter((key): key is string => key !== null),
    );
    const counts: number[] = [];
    const delays: number[] = [];
    const waveSizes: number[] = [];

    for (let step = 0; step < steps; step += 1) {
      const event = nextTideEvent(state, targetCount, rand);
      delays.push(event.delayMs);
      if (event.kind === "in") {
        state = washInTide(state);
      } else {
        if (event.kind === "wave") waveSizes.push(event.count);
        for (let taken = 0; taken < event.count; taken += 1) {
          const occupied = occupiedTideSlots(state);
          if (occupied.length === 0) break;
          state = washOutTide(
            state,
            occupied[Math.floor(rand() * occupied.length)],
          );
        }
      }
      for (const key of state.ashore) {
        if (key !== null) seen.add(key);
      }
      counts.push(occupiedTideSlots(state).length);
    }

    return { state, seen, counts, delays, waveSizes };
  }

  /** Cheap deterministic PRNG so the run is reproducible without a dependency. */
  function seededRand(seed: number): () => number {
    let value = seed;
    return () => {
      value = (value * 1103515245 + 12345) % 2147483648;
      return value / 2147483648;
    };
  }

  it("holds the ashore count inside the band around the target", () => {
    const targetCount = 20;
    const { counts } = runTide(60, targetCount, 400, seededRand(7));
    const floor = Math.floor(targetCount * 0.85);
    const ceiling = Math.round(targetCount * 1.05);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(floor - 4);
    expect(Math.max(...counts)).toBeLessThanOrEqual(ceiling);
  });

  it("breathes rather than sitting at the target", () => {
    const { counts } = runTide(60, 20, 400, seededRand(11));
    expect(new Set(counts).size).toBeGreaterThan(1);
    expect(Math.min(...counts)).toBeLessThan(20);
  });

  it("mixes wash-ins, wash-outs, and waves", () => {
    const { waveSizes } = runTide(60, 20, 600, seededRand(3));
    expect(waveSizes.length).toBeGreaterThan(0);
    for (const size of waveSizes) {
      expect(size).toBeGreaterThanOrEqual(2);
      expect(size).toBeLessThanOrEqual(4);
    }
  });

  it("varies the rests between events", () => {
    const { delays } = runTide(60, 20, 200, seededRand(5));
    expect(new Set(delays).size).toBeGreaterThan(20);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(7000);
    }
  });

  it("cycles the whole pool ashore so nothing starves offshore", () => {
    const poolSize = 40;
    const { seen } = runTide(poolSize, 12, 3000, seededRand(13));
    expect(seen.size).toBe(poolSize);
  });

  it("never loses or duplicates a key across the tide", () => {
    const poolSize = 40;
    const { state } = runTide(poolSize, 12, 500, seededRand(17));
    const held = [
      ...state.ashore.filter((key): key is string => key !== null),
      ...state.offshore,
    ];
    expect(new Set(held).size).toBe(held.length);
    expect(held.length).toBe(poolSize);
  });
});
