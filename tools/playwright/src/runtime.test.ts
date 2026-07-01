// ABOUTME: Verifies runner planning helpers for artificial-user browser sessions.
// ABOUTME: Keeps browser process count and cursor event cadence bounded.

import { describe, expect, test } from "bun:test";
import {
  chooseBrowserLaunchMode,
  chooseRecordedActor,
  smoothMoveSteps,
} from "./runtime";

describe("chooseBrowserLaunchMode", () => {
  test("uses one shared browser for scenes that do not need an extension", () => {
    expect(chooseBrowserLaunchMode({ extension: false })).toBe("shared");
    expect(chooseBrowserLaunchMode({})).toBe("shared");
  });

  test("keeps persistent browser contexts for extension scenes", () => {
    expect(chooseBrowserLaunchMode({ extension: true })).toBe("persistent");
  });
});

describe("chooseRecordedActor", () => {
  test("defaults to the first actor", () => {
    expect(chooseRecordedActor(4, undefined)).toBe(0);
  });

  test("uses the configured actor index when it is valid", () => {
    expect(chooseRecordedActor(4, 2)).toBe(2);
  });

  test("rejects actor indexes outside the launched actor set", () => {
    expect(() => chooseRecordedActor(4, 4)).toThrow(
      "recordActor must be between 0 and 3",
    );
  });
});

describe("smoothMoveSteps", () => {
  test("defaults cursor movement to 60 fps recording cadence", () => {
    expect(smoothMoveSteps(1000)).toBe(60);
  });

  test("keeps short moves smooth without flooding mouse events", () => {
    expect(smoothMoveSteps(120)).toBe(8);
  });
});
