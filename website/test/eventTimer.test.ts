// ABOUTME: Tests the shared event stopwatch's elapsed time for running, paused and old saved rooms.
// ABOUTME: Old rooms only have {time, isRunning}; they must show their saved seconds, never NaN.
import { describe, expect, test } from "bun:test";
import {
  formatTime,
  isTimerRunning,
  timerElapsedMs,
  type TimerData,
} from "../events/eventTimer";

function display(data: TimerData, now: number) {
  return formatTime(Math.floor(timerElapsedMs(data, now) / 1000));
}

describe("event timer", () => {
  test("a running timer adds the time since it started to what came before", () => {
    const data: TimerData = {
      time: 10,
      isRunning: true,
      startedAt: 1_000_000,
      pausedElapsedMs: 10_500,
    };
    expect(isTimerRunning(data)).toBe(true);
    expect(timerElapsedMs(data, 1_000_000 + 65_000)).toBe(75_500);
    expect(display(data, 1_000_000 + 3_600_000)).toBe("01:00:10");
  });

  test("a paused timer stays at its accumulated time", () => {
    const data: TimerData = {
      time: 75,
      isRunning: false,
      pausedElapsedMs: 75_500,
    };
    expect(isTimerRunning(data)).toBe(false);
    expect(timerElapsedMs(data, 1_000_000)).toBe(75_500);
    expect(timerElapsedMs(data, 9_000_000)).toBe(75_500);
    expect(display(data, 9_000_000)).toBe("00:01:15");
  });

  test("a start time later than now does not count backwards", () => {
    const data: TimerData = {
      time: 5,
      isRunning: true,
      startedAt: 2_000,
      pausedElapsedMs: 5_000,
    };
    expect(timerElapsedMs(data, 1_000)).toBe(5_000);
  });

  test("an old room saved as running with no start time shows its saved seconds, paused", () => {
    const data = { time: 42, isRunning: true } as TimerData;
    expect(isTimerRunning(data)).toBe(false);
    expect(timerElapsedMs(data, 1_000_000)).toBe(42_000);
    expect(timerElapsedMs(data, 9_000_000)).toBe(42_000);
    expect(display(data, 9_000_000)).toBe("00:00:42");
  });

  test("an old room with no saved time shows zero", () => {
    const data = { isRunning: true } as TimerData;
    expect(timerElapsedMs(data, 1_000_000)).toBe(0);
    expect(display(data, 1_000_000)).toBe("00:00:00");
  });
});
