// ABOUTME: Tests which gathering tab writes the advance to the next group activity.
// ABOUTME: Only an admin tab writes, once per activity, and only after the countdown reaches zero.
import { describe, expect, test } from "bun:test";
import {
  activitySecondsLeft,
  shouldWriteActivityAdvance,
} from "../events/gathering/activityAdvance";

const lastChangeTime = 1_000_000;
const expired = lastChangeTime + 31_000;

describe("gathering activity advance", () => {
  test("counts down thirty seconds from the last change", () => {
    expect(activitySecondsLeft(lastChangeTime, lastChangeTime)).toBe(30);
    expect(activitySecondsLeft(lastChangeTime, lastChangeTime + 12_400)).toBe(
      18,
    );
    expect(activitySecondsLeft(lastChangeTime, expired)).toBe(-1);
  });

  test("an admin tab writes the advance once the countdown runs out", () => {
    expect(
      shouldWriteActivityAdvance({
        lastChangeTime,
        now: expired,
        isAdmin: true,
        advancedFrom: null,
      }),
    ).toBe(true);
  });

  test("a non-admin tab never writes the advance", () => {
    expect(
      shouldWriteActivityAdvance({
        lastChangeTime,
        now: expired,
        isAdmin: false,
        advancedFrom: null,
      }),
    ).toBe(false);
  });

  test("an admin tab that already advanced from this activity does not write again", () => {
    expect(
      shouldWriteActivityAdvance({
        lastChangeTime,
        now: expired,
        isAdmin: true,
        advancedFrom: lastChangeTime,
      }),
    ).toBe(false);
  });

  test("an admin tab writes for the next activity after its advance syncs back", () => {
    const nextChangeTime = expired;
    expect(
      shouldWriteActivityAdvance({
        lastChangeTime: nextChangeTime,
        now: nextChangeTime + 31_000,
        isAdmin: true,
        advancedFrom: lastChangeTime,
      }),
    ).toBe(true);
  });

  test("no tab writes while the countdown is still running", () => {
    expect(
      shouldWriteActivityAdvance({
        lastChangeTime,
        now: lastChangeTime + 29_000,
        isAdmin: true,
        advancedFrom: null,
      }),
    ).toBe(false);
  });
});
