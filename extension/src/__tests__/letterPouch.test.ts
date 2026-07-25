// ABOUTME: Letter pouch tests — starts full, spends down, regenerates one
// ABOUTME: letter per interval, caps at max, tolerates malformed storage.

import { beforeEach, describe, expect, it } from "vitest";
import {
  POUCH_MAX,
  POUCH_REGEN_MS,
  pouchCount,
  spendLetter,
  __resetPouchForTests,
} from "../features/letter-pouch";

const T0 = 1_750_000_000_000;

describe("letter pouch", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPouchForTests();
  });

  it("starts with a full pouch", () => {
    expect(pouchCount(T0)).toBe(POUCH_MAX);
  });

  it("spends letters down to zero, then refuses", () => {
    for (let i = 0; i < POUCH_MAX; i++) expect(spendLetter(T0)).toBe(true);
    expect(pouchCount(T0)).toBe(0);
    expect(spendLetter(T0)).toBe(false);
  });

  it("regenerates one letter per interval, capped at max", () => {
    for (let i = 0; i < POUCH_MAX; i++) spendLetter(T0);
    expect(pouchCount(T0 + POUCH_REGEN_MS - 1)).toBe(0);
    expect(pouchCount(T0 + POUCH_REGEN_MS)).toBe(1);
    expect(pouchCount(T0 + 2 * POUCH_REGEN_MS)).toBe(2);
    expect(pouchCount(T0 + 100 * POUCH_REGEN_MS)).toBe(POUCH_MAX);
  });

  it("does not bank regen time while the pouch is full", () => {
    // Full pouch for a long time, then spend: the next letter takes a full
    // interval from the spend, not from ancient lastRegenAt.
    expect(pouchCount(T0)).toBe(POUCH_MAX);
    const later = T0 + 30 * POUCH_REGEN_MS;
    spendLetter(later);
    expect(pouchCount(later + POUCH_REGEN_MS - 1)).toBe(POUCH_MAX - 1);
    expect(pouchCount(later + POUCH_REGEN_MS)).toBe(POUCH_MAX);
  });

  it("persists across module state resets via localStorage", () => {
    spendLetter(T0);
    __resetPouchForTests({ keepStorage: true });
    expect(pouchCount(T0)).toBe(POUCH_MAX - 1);
  });

  it("degrades malformed storage to a full pouch", () => {
    localStorage.setItem("bottle:pouch:v1", "[not, json");
    expect(pouchCount(T0)).toBe(POUCH_MAX);
  });
});
