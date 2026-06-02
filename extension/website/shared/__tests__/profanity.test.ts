// ABOUTME: Tests for the shared profanity-check utility.
// ABOUTME: Verifies word-boundary matching and case-insensitive behavior.

import { describe, it, expect } from "vitest";
import { containsProfanity } from "../profanity";

describe("containsProfanity", () => {
  it("returns false for clean strings", () => {
    expect(containsProfanity("hello world")).toBe(false);
    expect(containsProfanity("octopuses have three hearts")).toBe(false);
    expect(containsProfanity("")).toBe(false);
  });

  it("matches with word boundaries (case-insensitive)", () => {
    expect(containsProfanity("oh shit")).toBe(true);
    expect(containsProfanity("OH SHIT")).toBe(true);
    expect(containsProfanity("Shit happens")).toBe(true);
  });

  it("does not flag inner substrings of unrelated words", () => {
    expect(containsProfanity("classic literature")).toBe(false);
    expect(containsProfanity("assassin")).toBe(false);
  });
});
