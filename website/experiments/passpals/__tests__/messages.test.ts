// ABOUTME: Verifies the fade window on transmissions and the bounds on both lists.
// ABOUTME: Covers sanitization, ordering, overflow trimming, and the letter age labels.
import { describe, expect, it } from "vitest";
import {
  activeTransmissions,
  Entry,
  formatAge,
  MAX_BODY_LENGTH,
  overflowCount,
  sanitizeBody,
  sortedLetters,
  TRANSMISSION_TTL_MS,
} from "../messages";

function entry(overrides: Partial<Entry> = {}): Entry {
  return { id: "a", handle: "someone", body: "hi", at: 1000, ...overrides };
}

describe("body sanitization", () => {
  it("trims and collapses runs of spaces", () => {
    expect(sanitizeBody("  so    do you  ")).toBe("so do you");
  });

  it("replaces control characters rather than dropping the message", () => {
    expect(sanitizeBody(`ok${String.fromCharCode(7)}then`)).toBe("ok then");
  });

  it("caps the length", () => {
    expect(sanitizeBody("x".repeat(500))).toHaveLength(MAX_BODY_LENGTH);
  });
});

describe("transmissions", () => {
  const now = 10_000_000;

  it("keeps messages inside the fade window", () => {
    const fresh = entry({ at: now - 1000 });
    expect(activeTransmissions([fresh], now)).toEqual([fresh]);
  });

  it("drops messages past the fade window", () => {
    const stale = entry({ at: now - TRANSMISSION_TTL_MS - 1 });
    expect(activeTransmissions([stale], now)).toEqual([]);
  });

  it("ignores malformed entries instead of rendering them", () => {
    const good = entry({ at: now });
    expect(
      activeTransmissions([null, "nope", { body: "partial" }, good], now),
    ).toEqual([good]);
  });
});

describe("overflow", () => {
  it("reports nothing to trim below the cap", () => {
    expect(overflowCount(10, 200)).toBe(0);
  });

  it("reports how many to drop from the front above the cap", () => {
    expect(overflowCount(205, 200)).toBe(5);
  });
});

describe("letters", () => {
  it("shows the newest letter first", () => {
    const older = entry({ id: "older", at: 1 });
    const newer = entry({ id: "newer", at: 2 });
    expect(sortedLetters([older, newer]).map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("drops malformed letters", () => {
    expect(sortedLetters([{ body: "no id" }, undefined])).toEqual([]);
  });
});

describe("letter ages", () => {
  const now = 400 * 24 * 60 * 60 * 1000;

  it("labels a fresh letter", () => {
    expect(formatAge(now - 1000, now)).toBe("just now");
  });

  it("labels minutes, hours, days, and years", () => {
    expect(formatAge(now - 5 * 60 * 1000, now)).toBe("5 min ago");
    expect(formatAge(now - 3 * 60 * 60 * 1000, now)).toBe("3 hours ago");
    expect(formatAge(now - 2 * 24 * 60 * 60 * 1000, now)).toBe("2 days ago");
    expect(formatAge(0, now)).toBe("1 year ago");
  });
});
