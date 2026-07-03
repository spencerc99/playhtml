// ABOUTME: Verifies deterministic persona generation for artificial actors.
// ABOUTME: Ensures actor identities are stable, varied, and bounded.

import { describe, expect, test } from "bun:test";
import { createPersonas } from "./personas";

function serializablePersonas(seed: string) {
  return createPersonas(4, seed).map(({ random: _random, ...persona }) => persona);
}

describe("createPersonas", () => {
  test("creates the requested number of deterministic personas", () => {
    expect(serializablePersonas("demo")).toEqual(serializablePersonas("demo"));
    expect(createPersonas(4, "demo")).toHaveLength(4);
  });

  test("creates distinct actor identities", () => {
    const personas = createPersonas(8, "identity");

    expect(new Set(personas.map((persona) => persona.name)).size).toBe(8);
    expect(
      new Set(personas.map((persona) => persona.color)).size,
    ).toBeGreaterThan(4);
  });

  test("bounds tempo and personality values", () => {
    const personas = createPersonas(12, "bounds");

    for (const persona of personas) {
      expect(persona.tempo).toBeGreaterThanOrEqual(0.65);
      expect(persona.tempo).toBeLessThanOrEqual(1.6);
      expect(persona.patience).toBeGreaterThanOrEqual(0);
      expect(persona.patience).toBeLessThanOrEqual(1);
      expect(persona.curiosity).toBeGreaterThanOrEqual(0);
      expect(persona.curiosity).toBeLessThanOrEqual(1);
    }
  });

  test("creates bounded rhythm and motion traits", () => {
    const personas = createPersonas(12, "human-rhythm");

    for (const persona of personas) {
      expect(persona.rhythm.startDelayMs).toBeGreaterThanOrEqual(0);
      expect(persona.rhythm.startDelayMs).toBeLessThanOrEqual(7000);
      expect(persona.rhythm.thinkMinMs).toBeGreaterThanOrEqual(120);
      expect(persona.rhythm.thinkMaxMs).toBeGreaterThan(persona.rhythm.thinkMinMs);
      expect(persona.rhythm.betweenMinMs).toBeGreaterThanOrEqual(180);
      expect(persona.rhythm.betweenMaxMs).toBeGreaterThan(
        persona.rhythm.betweenMinMs,
      );

      expect(persona.motion.jitterPx).toBeGreaterThanOrEqual(0);
      expect(persona.motion.jitterPx).toBeLessThanOrEqual(45);
      expect(persona.motion.pathWobblePx).toBeGreaterThanOrEqual(2);
      expect(persona.motion.pathWobblePx).toBeLessThanOrEqual(30);
      expect(persona.motion.microPauseChance).toBeGreaterThanOrEqual(0);
      expect(persona.motion.microPauseChance).toBeLessThanOrEqual(0.45);

      expect(persona.prompt.attention).toBeGreaterThanOrEqual(0.25);
      expect(persona.prompt.attention).toBeLessThanOrEqual(0.95);
      expect(persona.prompt.commitment).toBeGreaterThanOrEqual(0.25);
      expect(persona.prompt.commitment).toBeLessThanOrEqual(0.95);
    }
  });

  test("staggers actor starts instead of synchronizing every actor", () => {
    const personas = createPersonas(15, "staggered-starts");
    const uniqueDelays = new Set(
      personas.map((persona) => persona.rhythm.startDelayMs),
    );

    expect(uniqueDelays.size).toBeGreaterThan(10);
  });
});
