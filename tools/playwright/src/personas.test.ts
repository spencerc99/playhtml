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
});
