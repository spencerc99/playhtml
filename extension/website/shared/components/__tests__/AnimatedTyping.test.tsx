// ABOUTME: Tests AnimatedTyping playback behavior for large keyboard datasets.
// ABOUTME: Covers bounded finished-state rendering, sequence replay, and typing sediment.
import { describe, expect, it } from "vitest";
import type { TypingAction, TypingState } from "../../types";
import {
  COMPLETED_TYPING_VISIBLE_COUNT,
  buildTypingPlaybackSchedule,
  getRecentCompletedTypingTracks,
  getTypingPlaybackElapsed,
  getTypingTextAtTime,
  stepTypingSediment,
  typingSedimentSaturation,
  type TypingSedimentOptions,
  type TypingSedimentState,
} from "../AnimatedTyping";
import { INSTALLATION_FADE_MS } from "../../utils/installationPlaybackQueue";

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
  it("holds finite playback at the end instead of wrapping", () => {
    expect(getTypingPlaybackElapsed(12_000, 10_000, false)).toBe(10_000);
    expect(getTypingPlaybackElapsed(12_000, 10_000, true)).toBe(2_000);
  });

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

function makeRecord(
  id: string,
  startedAt: number,
  durationMs = 10,
): TypingSedimentState {
  return { id, startedAt, durationMs, settledAt: null, departingAt: null, depth: 0 };
}

/** Drive the scheduler over a list of draw-clock times, mutating `records`
 * exactly the way the component's frame loop does. */
function stepThrough(
  records: TypingSedimentState[],
  times: readonly number[],
  options: TypingSedimentOptions,
) {
  let previous = times[0];
  let step = stepTypingSediment(records, times[0], 1000 / 30, options);
  for (const now of times.slice(1)) {
    step = stepTypingSediment(step.kept, now, now - previous, options);
    previous = now;
  }
  return step;
}

const phaseOf = (
  step: ReturnType<typeof stepTypingSediment<TypingSedimentState>>,
  id: string,
) => step.frames.get(id)?.phase;

describe("stepTypingSediment", () => {
  const options = (windowCount: number): TypingSedimentOptions => ({
    windowCount,
    floorOpacity: 0.3,
  });

  it("keeps a finished box settled far past the old hold-and-fade lifetime", () => {
    const records = [makeRecord("a", 0)];
    // 8s hold + 2s fade was the old lifetime; go well beyond it.
    const step = stepThrough(records, [0, 50, 5_000, 11_000, 30_000], options(40));

    expect(step.kept).toHaveLength(1);
    expect(phaseOf(step, "a")).toBe("settled");
    expect(step.frames.get("a")!.opacity).toBeLessThan(1);
    expect(step.frames.get("a")!.opacity).toBeGreaterThanOrEqual(0.3);
  });

  it("departs the oldest settled box once the window overflows", () => {
    const records = [makeRecord("a", 0), makeRecord("b", 100), makeRecord("c", 200)];

    const settledTwo = stepThrough(records, [0, 50, 150], options(2));
    expect(phaseOf(settledTwo, "a")).toBe("settled");
    expect(phaseOf(settledTwo, "b")).toBe("settled");

    const overflowed = stepTypingSediment(settledTwo.kept, 250, 100, options(2));
    expect(phaseOf(overflowed, "a")).toBe("fade-out");
    expect(phaseOf(overflowed, "b")).toBe("settled");
    expect(phaseOf(overflowed, "c")).toBe("settled");
    expect(overflowed.frames.get("a")!.opacity).toBeGreaterThan(0);

    const midFade = stepTypingSediment(
      overflowed.kept,
      250 + INSTALLATION_FADE_MS / 2,
      INSTALLATION_FADE_MS / 2,
      options(2),
    );
    expect(midFade.kept.map((record) => record.id)).toEqual(["a", "b", "c"]);

    const afterFade = stepTypingSediment(
      midFade.kept,
      250 + INSTALLATION_FADE_MS,
      INSTALLATION_FADE_MS / 2,
      options(2),
    );
    expect(afterFade.kept.map((record) => record.id)).toEqual(["b", "c"]);
    expect(afterFade.frames.has("a")).toBe(false);
  });

  it("counts only still-typing boxes against the admission cap", () => {
    const records = [
      ...Array.from({ length: 5 }, (_, index) => makeRecord(`settled-${index}`, index)),
      makeRecord("typing-1", 0, 10_000),
      makeRecord("typing-2", 0, 10_000),
    ];

    const step = stepThrough(records, [0, 50, 1_000], options(40));

    expect(step.kept).toHaveLength(7);
    expect(step.typingCount).toBe(2);
  });

  it("ranks newer settled boxes shallower than older ones", () => {
    const records = [makeRecord("old", 0), makeRecord("mid", 100), makeRecord("new", 200)];

    const step = stepThrough(
      records,
      [0, 50, 150, 250, 1_500, 4_000, 10_000],
      options(4),
    );

    const depth = (id: string) => step.frames.get(id)!.depth;
    expect(depth("new")).toBeLessThan(depth("mid"));
    expect(depth("mid")).toBeLessThan(depth("old"));
    expect(depth("new")).toBeCloseTo(1 / 4, 2);
    expect(depth("old")).toBeCloseTo(3 / 4, 2);
    // Deeper boxes are dimmer and more washed out than shallower ones.
    expect(step.frames.get("new")!.opacity).toBeGreaterThan(
      step.frames.get("old")!.opacity,
    );
    expect(typingSedimentSaturation(depth("new"))).toBeGreaterThan(
      typingSedimentSaturation(depth("old")),
    );
  });

  it("departs a finished box immediately when the window is zero", () => {
    const records = [makeRecord("a", 0)];

    const settled = stepThrough(records, [0, 50], options(0));
    expect(phaseOf(settled, "a")).toBe("fade-out");

    const gone = stepTypingSediment(
      settled.kept,
      50 + INSTALLATION_FADE_MS,
      INSTALLATION_FADE_MS,
      options(0),
    );
    expect(gone.kept).toHaveLength(0);
  });

  it("maps depth to a saturation wash from full to the floor", () => {
    expect(typingSedimentSaturation(0)).toBe(1);
    expect(typingSedimentSaturation(1)).toBeCloseTo(0.55, 5);
    expect(typingSedimentSaturation(0.5)).toBeCloseTo(0.775, 5);
  });
});
