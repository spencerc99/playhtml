// ABOUTME: Unit tests for moderation record extraction, hashing, and removal.
// ABOUTME: Uses bun:test with fixtures mirroring real playhtml page data shapes.
import { describe, expect, it } from "bun:test";
import { hashRecord } from "../moderation";

describe("hashRecord", () => {
  it("is stable for identical record content", () => {
    const a = { word: "hello", color: "#abc", x: 1, y: 2 };
    const b = { word: "hello", color: "#abc", x: 1, y: 2 };
    expect(hashRecord(a)).toBe(hashRecord(b));
  });

  it("is order-independent across keys", () => {
    const a = { word: "hello", color: "#abc" };
    const b = { color: "#abc", word: "hello" };
    expect(hashRecord(a)).toBe(hashRecord(b));
  });

  it("differs when content differs", () => {
    expect(hashRecord({ word: "hello" })).not.toBe(hashRecord({ word: "world" }));
  });
});
