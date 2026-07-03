// ABOUTME: Verifies deterministic random helpers for artificial-user scenes.
// ABOUTME: Covers repeatable numbers, ranges, choices, and weighted choices.

import { describe, expect, test } from "bun:test";
import { createRandom } from "./random";

describe("createRandom", () => {
  test("returns repeatable sequences for the same seed", () => {
    const first = createRandom("fridge-demo");
    const second = createRandom("fridge-demo");

    expect([first.next(), first.next(), first.next()]).toEqual([
      second.next(),
      second.next(),
      second.next(),
    ]);
  });

  test("returns different sequences for different seeds", () => {
    const first = createRandom("fridge-demo");
    const second = createRandom("walking-demo");

    expect([first.next(), first.next(), first.next()]).not.toEqual([
      second.next(),
      second.next(),
      second.next(),
    ]);
  });

  test("picks values from bounded ranges and arrays", () => {
    const random = createRandom("bounded");

    for (let i = 0; i < 20; i++) {
      const value = random.float(10, 12);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThan(12);
    }

    expect(["a", "b", "c"]).toContain(random.pick(["a", "b", "c"]));
  });

  test("weighted picks ignore zero-weight entries", () => {
    const random = createRandom("weighted");

    for (let i = 0; i < 20; i++) {
      expect(
        random.weighted([
          { weight: 0, value: "never" },
          { weight: 1, value: "always" },
        ]),
      ).toBe("always");
    }
  });
});
