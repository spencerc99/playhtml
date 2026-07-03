// ABOUTME: Provides deterministic seeded randomness for Playwright scenes.
// ABOUTME: Keeps artificial-user behavior reproducible across reruns.

export interface WeightedChoice<T> {
  weight: number;
  value: T;
}

export interface SeededRandom {
  next(): number;
  float(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  bool(probability: number): boolean;
  pick<T>(values: readonly T[]): T;
  weighted<T>(choices: readonly WeightedChoice<T>[]): T;
  fork(label: string): SeededRandom;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRandom(seed: string): SeededRandom {
  const nextValue = mulberry32(hashSeed(seed));

  const random: SeededRandom = {
    next: nextValue,
    float(min, max) {
      if (max <= min) throw new Error("max must be greater than min");
      return min + nextValue() * (max - min);
    },
    int(min, maxInclusive) {
      if (maxInclusive < min) {
        throw new Error("maxInclusive must be at least min");
      }
      return Math.floor(random.float(min, maxInclusive + 1));
    },
    bool(probability) {
      if (probability < 0 || probability > 1) {
        throw new Error("probability must be between 0 and 1");
      }
      return nextValue() < probability;
    },
    pick(values) {
      if (values.length === 0) throw new Error("cannot pick from an empty array");
      return values[random.int(0, values.length - 1)];
    },
    weighted(choices) {
      const available = choices.filter((choice) => choice.weight > 0);
      if (available.length === 0) {
        throw new Error("weighted choices need a positive weight");
      }
      const total = available.reduce((sum, choice) => sum + choice.weight, 0);
      let cursor = random.float(0, total);
      for (const choice of available) {
        cursor -= choice.weight;
        if (cursor <= 0) return choice.value;
      }
      return available[available.length - 1].value;
    },
    fork(label) {
      return createRandom(`${seed}:${label}`);
    },
  };

  return random;
}
