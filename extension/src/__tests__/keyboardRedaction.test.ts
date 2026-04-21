// ABOUTME: Tests for keyboard legibility parsing, PII redaction, and partial redaction with stable seeding.
// ABOUTME: Protects the migration path from legacy "abstract"/"full" string values to the numeric legibility model.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LEGIBILITY,
  REDACTION_CHAR,
  parseLegibility,
  redactPII,
  redactNonWhitespace,
  redactWithLegibility,
} from "../utils/keyboardRedaction";

describe("parseLegibility", () => {
  it("maps legacy 'abstract' to 0", () => {
    expect(parseLegibility("abstract")).toBe(0);
  });

  it("maps legacy 'full' to 100", () => {
    expect(parseLegibility("full")).toBe(100);
  });

  it("clamps numbers outside 0-100", () => {
    expect(parseLegibility(-5)).toBe(0);
    expect(parseLegibility(105)).toBe(100);
  });

  it("rounds fractional numbers", () => {
    expect(parseLegibility(50.7)).toBe(51);
    expect(parseLegibility(49.4)).toBe(49);
  });

  it("returns DEFAULT_LEGIBILITY for unknown values", () => {
    expect(parseLegibility(null)).toBe(DEFAULT_LEGIBILITY);
    expect(parseLegibility(undefined)).toBe(DEFAULT_LEGIBILITY);
    expect(parseLegibility("something else")).toBe(DEFAULT_LEGIBILITY);
    expect(parseLegibility({})).toBe(DEFAULT_LEGIBILITY);
  });

  it("passes through in-range integers", () => {
    expect(parseLegibility(0)).toBe(0);
    expect(parseLegibility(50)).toBe(50);
    expect(parseLegibility(100)).toBe(100);
  });

  it("returns DEFAULT_LEGIBILITY for NaN and Infinity", () => {
    expect(parseLegibility(NaN)).toBe(DEFAULT_LEGIBILITY);
    expect(parseLegibility(Infinity)).toBe(DEFAULT_LEGIBILITY);
  });
});

describe("redactPII", () => {
  it("redacts email addresses", () => {
    const out = redactPII("email hi@spencer.place with feedback");
    expect(out).not.toContain("hi@spencer.place");
    expect(out).toContain(REDACTION_CHAR.repeat("hi@spencer.place".length));
  });

  it("redacts US phone numbers", () => {
    const out = redactPII("call me at (555) 123-4567 tomorrow");
    expect(out).not.toContain("555");
    expect(out).not.toContain("4567");
  });

  it("redacts SSN patterns", () => {
    const out = redactPII("ssn 123-45-6789");
    expect(out).not.toContain("123-45-6789");
  });

  it("leaves non-PII text intact", () => {
    expect(redactPII("hello world")).toBe("hello world");
  });
});

describe("redactNonWhitespace", () => {
  it("replaces every non-whitespace character", () => {
    expect(redactNonWhitespace("a b c")).toBe(
      `${REDACTION_CHAR} ${REDACTION_CHAR} ${REDACTION_CHAR}`,
    );
  });

  it("preserves whitespace", () => {
    expect(redactNonWhitespace("  \n\t")).toBe("  \n\t");
  });
});

describe("redactWithLegibility", () => {
  it("at 0% redacts all non-whitespace (matches redactNonWhitespace)", () => {
    expect(redactWithLegibility("hello world", 0, 0)).toBe(
      redactNonWhitespace("hello world"),
    );
  });

  it("at 100% preserves non-PII text (matches redactPII)", () => {
    const input = "write hi@spencer.place now";
    expect(redactWithLegibility(input, 100, 0)).toBe(redactPII(input));
  });

  it("always redacts PII regardless of legibility", () => {
    const inputs = ["email hi@spencer.place", "call (555) 123-4567"];
    for (const input of inputs) {
      for (const pct of [0, 25, 50, 75, 99, 100]) {
        const out = redactWithLegibility(input, pct, 1);
        expect(out).not.toContain("hi@spencer.place");
        expect(out).not.toContain("(555) 123-4567");
      }
    }
  });

  it("is deterministic for same (text, pct, seed)", () => {
    const a = redactWithLegibility("the quick brown fox", 50, 42);
    const b = redactWithLegibility("the quick brown fox", 50, 42);
    expect(a).toBe(b);
  });

  it("differs across seeds at partial legibility", () => {
    const a = redactWithLegibility("the quick brown fox", 50, 1);
    const b = redactWithLegibility("the quick brown fox", 50, 99);
    // Not guaranteed, but extremely likely for a 19-char string at 50%.
    expect(a).not.toBe(b);
  });

  it("redacts more characters as legibility decreases", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const countBlocks = (s: string) =>
      (s.match(new RegExp(REDACTION_CHAR, "g")) || []).length;
    const hi = countBlocks(redactWithLegibility(text, 80, 7));
    const lo = countBlocks(redactWithLegibility(text, 20, 7));
    expect(lo).toBeGreaterThan(hi);
  });

  it("preserves whitespace at all legibility levels", () => {
    for (const pct of [0, 25, 50, 75, 100]) {
      const out = redactWithLegibility("a b\nc\td", pct, 3);
      expect(out[1]).toBe(" ");
      expect(out[3]).toBe("\n");
      expect(out[5]).toBe("\t");
    }
  });

  it("clamps out-of-range pct", () => {
    expect(redactWithLegibility("abc", -50, 0)).toBe(
      redactWithLegibility("abc", 0, 0),
    );
    expect(redactWithLegibility("abc", 500, 0)).toBe(
      redactWithLegibility("abc", 100, 0),
    );
  });

  it("handles empty string", () => {
    expect(redactWithLegibility("", 50, 0)).toBe("");
  });
});
