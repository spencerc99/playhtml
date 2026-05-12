// ABOUTME: Tests AnimatedTyping playback behavior for large keyboard datasets.
// ABOUTME: Verifies bounded finished-state rendering and sequence replay.
import { describe, expect, it } from "vitest";
import type { TypingAction, TypingState } from "../../types";
import {
  COMPLETED_TYPING_VISIBLE_COUNT,
  buildTypingPlaybackSchedule,
  getRecentCompletedTypingTracks,
  getTypingTextAtTime,
} from "../AnimatedTyping";

function makeTypingState(index: number, sequence: TypingAction[]): TypingState {
  return {
    animation: {
      event: {
        id: `event-${index}`,
        type: "keyboard",
        ts: index,
        data: { x: 0.5, y: 0.5 },
        meta: {
          pid: "participant",
          sid: "session",
          url: "https://example.com",
          vw: 1280,
          vh: 720,
          tz: "UTC",
        },
      },
      x: index,
      y: index,
      color: "#111",
      startTime: index,
      sequence,
    },
    startOffsetMs: index * 100,
    durationMs: 40,
    textboxSize: { width: 200, height: 40 },
    fontSize: 14,
    positionOffset: { x: 0, y: 0 },
  };
}

describe("AnimatedTyping playback", () => {
  it("keeps completed typing tracks bounded to recent history", () => {
    const states = Array.from({ length: 500 }, (_, index) =>
      makeTypingState(index, [
        { action: "type", text: `${index}`, timestamp: 0 },
      ]),
    );

    const schedule = buildTypingPlaybackSchedule(states);
    const completed = getRecentCompletedTypingTracks(schedule, 50_000);

    expect(completed).toHaveLength(COMPLETED_TYPING_VISIBLE_COUNT);
    expect(completed[0].id).toBe("typing-state-450");
    expect(completed.at(-1)?.id).toBe("typing-state-499");
  });

  it("replays typing and backspace actions at a specific time", () => {
    const [track] = buildTypingPlaybackSchedule([
      makeTypingState(0, [
        { action: "type", text: "hello", timestamp: 0 },
        { action: "backspace", deletedCount: 2, timestamp: 100 },
        { action: "type", text: "p", timestamp: 200 },
      ]),
    ]).tracks;

    expect(getTypingTextAtTime(track, 250, 1)).toBe("help");
  });
});
