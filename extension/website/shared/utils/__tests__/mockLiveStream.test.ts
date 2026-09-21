// ABOUTME: Tests the dev-only synthetic live event stream used to run live pages offline.
// ABOUTME: Covers option parsing, seeded determinism, and consumer-shaped cursor/keyboard/viewport output.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CollectionEvent,
  KeyboardEventData,
  TypingAction,
} from "../../types";
import {
  parseMockLiveStreamOptions,
  startMockLiveStream,
  type MockLiveStreamOptions,
} from "../mockLiveStream";
import { latestDrawableCursorEventId } from "../cursorInstallation";
import { groupTypingEvents } from "../typingEventGroups";
import {
  groupScrollEvents,
  scrollEventGroupHasVisibleActivity,
} from "../scrollEventGroups";

const START_TIME = Date.UTC(2026, 2, 1, 12, 0, 0);

function options(
  overrides: Partial<MockLiveStreamOptions> = {},
): MockLiveStreamOptions {
  return {
    seed: 7,
    people: 10,
    kinds: new Set(["cursor", "keyboard", "viewport"] as const),
    backfillSeconds: 90,
    tempo: 1,
    ...overrides,
  };
}

/** Run the stream from a fixed wall clock and return every emitted batch. */
function runStream(
  streamOptions: MockLiveStreamOptions,
  runForMs: number,
): CollectionEvent[][] {
  vi.setSystemTime(START_TIME);
  const batches: CollectionEvent[][] = [];
  const stop = startMockLiveStream(streamOptions, (events) => {
    batches.push(events);
  });
  vi.advanceTimersByTime(runForMs);
  stop();
  return batches;
}

function flatten(batches: CollectionEvent[][]): CollectionEvent[] {
  return batches.flat();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_TIME);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseMockLiveStreamOptions", () => {
  it("returns null unless mockLive is present and enabled", () => {
    expect(parseMockLiveStreamOptions("")).toBeNull();
    expect(parseMockLiveStreamOptions("?screen=cursors")).toBeNull();
    expect(parseMockLiveStreamOptions("?mockLive=0")).toBeNull();
    expect(parseMockLiveStreamOptions("?mockLive=false")).toBeNull();
    expect(parseMockLiveStreamOptions("?mockLive=FALSE")).toBeNull();
  });

  it("defaults every option when only the flag is present", () => {
    const parsed = parseMockLiveStreamOptions("?mockLive=1");
    expect(parsed).not.toBeNull();
    expect(parsed?.seed).toBe(1);
    expect(parsed?.people).toBe(8);
    expect(parsed?.backfillSeconds).toBe(0);
    expect(parsed?.tempo).toBe(1);
    expect([...(parsed?.kinds ?? [])].sort()).toEqual([
      "cursor",
      "keyboard",
      "viewport",
    ]);
  });

  it("accepts a bare flag with no value", () => {
    expect(parseMockLiveStreamOptions("?mockLive")).not.toBeNull();
  });

  it("reads seed, people, backfill, and tempo", () => {
    const parsed = parseMockLiveStreamOptions(
      "?mockLive=1&mockLiveSeed=42&mockLivePeople=12&mockLiveBackfill=90&mockLiveTempo=2.5",
    );
    expect(parsed).toMatchObject({
      seed: 42,
      people: 12,
      backfillSeconds: 90,
      tempo: 2.5,
    });
  });

  it("clamps people to 1..40 and keeps tempo positive", () => {
    expect(parseMockLiveStreamOptions("?mockLive=1&mockLivePeople=0")?.people).toBe(1);
    expect(parseMockLiveStreamOptions("?mockLive=1&mockLivePeople=999")?.people).toBe(40);
    expect(
      parseMockLiveStreamOptions("?mockLive=1&mockLiveTempo=-4")?.tempo,
    ).toBeGreaterThan(0);
  });

  it("falls back to defaults for unparseable numbers", () => {
    const parsed = parseMockLiveStreamOptions(
      "?mockLive=1&mockLiveSeed=abc&mockLivePeople=&mockLiveTempo=xyz",
    );
    expect(parsed).toMatchObject({ seed: 1, people: 8, tempo: 1 });
  });

  it("reads a csv subset of kinds and ignores unknown entries", () => {
    const parsed = parseMockLiveStreamOptions(
      "?mockLive=1&mockLiveKinds=cursor, KEYBOARD ,bogus",
    );
    expect([...(parsed?.kinds ?? [])].sort()).toEqual(["cursor", "keyboard"]);
  });

  it("treats an all-unknown kinds list as no filter", () => {
    const parsed = parseMockLiveStreamOptions("?mockLive=1&mockLiveKinds=bogus");
    expect([...(parsed?.kinds ?? [])].sort()).toEqual([
      "cursor",
      "keyboard",
      "viewport",
    ]);
  });
});

describe("startMockLiveStream", () => {
  it("emits the backfill history in the first batch and then live batches", () => {
    const batches = runStream(options(), 5000);
    expect(batches.length).toBeGreaterThan(1);

    const first = batches[0];
    expect(first.length).toBeGreaterThan(50);
    // The backfill window ends at the start time.
    expect(Math.min(...first.map((e) => e.ts))).toBeGreaterThanOrEqual(
      START_TIME - 90_000,
    );
    expect(Math.max(...first.map((e) => e.ts))).toBeLessThanOrEqual(START_TIME);

    // Later batches are live, i.e. after the start time.
    const live = flatten(batches.slice(1));
    expect(live.length).toBeGreaterThan(0);
    expect(Math.max(...live.map((e) => e.ts))).toBeGreaterThan(START_TIME);
  });

  it("does not emit history when backfill is zero", () => {
    const batches = runStream(options({ backfillSeconds: 0 }), 6000);
    const all = flatten(batches);
    expect(all.length).toBeGreaterThan(0);
    expect(Math.min(...all.map((e) => e.ts))).toBeGreaterThanOrEqual(START_TIME);
  });

  it("emits ts-ascending batches of unique ids", () => {
    const batches = runStream(options(), 8000);
    for (const batch of batches) {
      for (let i = 1; i < batch.length; i++) {
        expect(batch[i].ts).toBeGreaterThanOrEqual(batch[i - 1].ts);
      }
    }
    const all = flatten(batches);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const event of all) {
      expect(event.id).toMatch(/^mock-mock-p\d{2}-\d+$/);
    }
  });

  it("keeps batching on roughly a one second cadence", () => {
    const batches = runStream(options({ backfillSeconds: 0 }), 10_000);
    // ~1s ± 200ms jitter over 10s.
    expect(batches.length).toBeGreaterThanOrEqual(8);
    expect(batches.length).toBeLessThanOrEqual(13);
  });

  it("stops emitting after the returned stop function runs", () => {
    vi.setSystemTime(START_TIME);
    const batches: CollectionEvent[][] = [];
    const stop = startMockLiveStream(options(), (events) =>
      batches.push(events),
    );
    vi.advanceTimersByTime(4000);
    const countAtStop = batches.length;
    stop();
    vi.advanceTimersByTime(20_000);
    expect(batches.length).toBe(countAtStop);
  });

  it("produces identical output for the same seed", () => {
    const first = flatten(runStream(options({ seed: 99 }), 6000));
    const second = flatten(runStream(options({ seed: 99 }), 6000));

    expect(second.length).toBe(first.length);
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(second.map((e) => e.type)).toEqual(first.map((e) => e.type));
    expect(second.map((e) => e.ts)).toEqual(first.map((e) => e.ts));
    expect(second.map((e) => `${e.data.x},${e.data.y}`)).toEqual(
      first.map((e) => `${e.data.x},${e.data.y}`),
    );
    expect(second.map((e) => e.meta.url)).toEqual(first.map((e) => e.meta.url));
  });

  it("produces different output for a different seed", () => {
    const first = flatten(runStream(options({ seed: 1 }), 6000));
    const second = flatten(runStream(options({ seed: 2 }), 6000));
    expect(second.map((e) => e.id)).not.toEqual(first.map((e) => e.id));
  });

  it("only emits the requested kinds", () => {
    const cursorOnly = flatten(
      runStream(options({ kinds: new Set(["cursor"] as const) }), 6000),
    );
    expect(cursorOnly.length).toBeGreaterThan(0);
    expect(new Set(cursorOnly.map((e) => e.type))).toEqual(new Set(["cursor"]));

    const keyboardOnly = flatten(
      runStream(options({ kinds: new Set(["keyboard"] as const) }), 6000),
    );
    expect(keyboardOnly.length).toBeGreaterThan(0);
    expect(new Set(keyboardOnly.map((e) => e.type))).toEqual(
      new Set(["keyboard"]),
    );
  });

  it("makes a busier stream at a higher tempo", () => {
    const slow = flatten(runStream(options({ tempo: 0.5 }), 6000)).length;
    const fast = flatten(runStream(options({ tempo: 4 }), 6000)).length;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("emitted event shapes", () => {
  const all = () => flatten(runStream(options({ people: 12 }), 12_000));

  it("matches the CollectionEvent contract on every event", () => {
    const events = all();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(typeof event.id).toBe("string");
      expect(event.id.length).toBeGreaterThan(0);
      expect(["cursor", "keyboard", "viewport"]).toContain(event.type);
      expect(Number.isFinite(event.ts)).toBe(true);
      expect(event.data).toBeTypeOf("object");

      const meta = event.meta;
      expect(meta.pid).toMatch(/^mock-p\d{2}$/);
      expect(meta.sid.length).toBeGreaterThan(0);
      expect(() => new URL(meta.url)).not.toThrow();
      expect(meta.vw).toBeGreaterThan(0);
      expect(meta.vh).toBeGreaterThan(0);
      expect(meta.tz).toContain("/");
      if (meta.cursor_color !== null && meta.cursor_color !== undefined) {
        expect(meta.cursor_color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("varies participant color and timezone across the population", () => {
    const events = all();
    const colors = new Set(events.map((e) => e.meta.cursor_color ?? "none"));
    const zones = new Set(events.map((e) => e.meta.tz));
    expect(colors.size).toBeGreaterThan(3);
    expect(zones.size).toBeGreaterThan(2);
  });

  it("emits cursor data the trail builder can read", () => {
    const cursorEvents = all().filter((e) => e.type === "cursor");
    expect(cursorEvents.length).toBeGreaterThan(0);
    const kinds = new Set<string>();
    for (const event of cursorEvents) {
      const { x, y, event: kind, cursor, button, duration } = event.data;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      expect(["move", "click", "hold", "cursor_change"]).toContain(kind);
      expect(["default", "pointer", "text"]).toContain(cursor);
      kinds.add(kind ?? "move");
      if (kind === "click") expect(button).toBe(0);
      if (kind === "hold") {
        expect(duration).toBeGreaterThanOrEqual(300);
        expect(duration).toBeLessThanOrEqual(1500);
      }
    }
    expect(kinds.has("move")).toBe(true);
    expect(kinds.has("click")).toBe(true);
  });

  it("produces at least one drawable cursor trail from a backfilled batch", () => {
    const [backfill] = runStream(options({ people: 12 }), 1);
    expect(backfill).toBeDefined();
    expect(latestDrawableCursorEventId(backfill)).not.toBeNull();
  });

  it("gives a person more than one page across their sessions", () => {
    const cursorEvents = all().filter((e) => e.type === "cursor");
    const urlsByPid = new Map<string, Set<string>>();
    for (const event of cursorEvents) {
      const urls = urlsByPid.get(event.meta.pid) ?? new Set<string>();
      urls.add(event.meta.url);
      urlsByPid.set(event.meta.pid, urls);
    }
    expect([...urlsByPid.values()].some((urls) => urls.size > 1)).toBe(true);
  });

  it("groups keyboard events into typing recordings", () => {
    const keyboardEvents = all().filter((e) => e.type === "keyboard");
    expect(keyboardEvents.length).toBeGreaterThan(0);

    for (const event of keyboardEvents) {
      const data = event.data as unknown as KeyboardEventData;
      expect(data.event).toBe("type");
      expect(data.x).toBeGreaterThanOrEqual(0);
      expect(data.x).toBeLessThanOrEqual(1);
      expect(data.y).toBeGreaterThanOrEqual(0);
      expect(data.y).toBeLessThanOrEqual(1);
      expect(typeof data.t).toBe("string");
      expect(data.style?.w).toBeGreaterThan(0);
      expect(data.style?.h).toBeGreaterThan(0);
      expect(data.style?.br).toBeLessThanOrEqual(20);
      expect(data.style?.bs).toBeGreaterThanOrEqual(0);
      expect(data.style?.bs).toBeLessThanOrEqual(4);

      const sequence = data.sequence as TypingAction[];
      expect(sequence.length).toBeGreaterThan(0);
      let previousTimestamp = -1;
      let typed = "";
      for (const action of sequence) {
        expect(["type", "backspace"]).toContain(action.action);
        expect(action.timestamp).toBeGreaterThanOrEqual(previousTimestamp);
        previousTimestamp = action.timestamp;
        if (action.action === "type") {
          expect(action.text).toBeTruthy();
          typed += action.text ?? "";
        } else {
          expect(action.deletedCount).toBeGreaterThan(0);
        }
      }
      expect(typed.length).toBeGreaterThan(0);
      // Redaction-safe filler only.
      expect(typed).toMatch(/^[a-z ]+$/);
    }

    const groups = groupTypingEvents(keyboardEvents);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].events.length).toBeGreaterThanOrEqual(1);
  });

  it("groups viewport events into scroll recordings with visible activity", () => {
    const viewportEvents = all().filter((e) => e.type === "viewport");
    expect(viewportEvents.length).toBeGreaterThan(0);

    for (const event of viewportEvents) {
      const data = event.data as unknown as {
        event: string;
        scrollX?: number;
        scrollY?: number;
        width?: number;
        height?: number;
        zoom?: number;
        quantity?: number;
      };
      expect(["scroll", "resize", "zoom"]).toContain(data.event);
      if (data.event === "scroll") {
        expect(data.scrollX).toBeGreaterThanOrEqual(0);
        expect(data.scrollX).toBeLessThanOrEqual(1);
        expect(data.scrollY).toBeGreaterThanOrEqual(0);
        expect(data.scrollY).toBeLessThanOrEqual(1);
      }
      if (data.event === "resize") {
        expect(data.width).toBeGreaterThan(0);
        expect(data.height).toBeGreaterThan(0);
      }
      if (data.event === "zoom") {
        expect(data.zoom).toBeGreaterThan(0);
      }
    }

    const groups = groupScrollEvents(viewportEvents);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.some(scrollEventGroupHasVisibleActivity)).toBe(true);
  });
});
