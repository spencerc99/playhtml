// ABOUTME: Tests finite typing chapter selection from live and archive reservoirs.
// ABOUTME: Verifies completion, whole-group rotation, deduplication, and exhaustion.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  DEFAULT_TYPING_INSTALLATION_CHAPTER_GROUPS,
  addTypingReservoirEvents,
  createTypingReservoir,
  takeTypingReservoirChapter,
} from "../typingInstallationReservoir";

function keyboardEvent(
  id: string,
  ts: number,
  options: {
    pid?: string;
    sid?: string;
    selector?: string;
    text?: string;
  } = {},
): CollectionEvent {
  return {
    id,
    type: "keyboard",
    ts,
    data: {
      event: "type",
      x: 0.4,
      y: 0.6,
      t: options.selector ?? `#${id}`,
      sequence: [{ action: "type", text: options.text ?? id, timestamp: 0 }],
    },
    meta: {
      pid: options.pid ?? "person",
      sid: options.sid ?? "session",
      url: "https://example.com/write",
      vw: 1440,
      vh: 900,
      tz: "UTC",
    },
  };
}

describe("typing installation reservoir", () => {
  it("uses a named 1000-group chapter default", () => {
    expect(DEFAULT_TYPING_INSTALLATION_CHAPTER_GROUPS).toBe(1000);
  });

  it("prioritizes completed live groups and fills the chapter from archive", () => {
    let state = createTypingReservoir();
    state = addTypingReservoirEvents(
      state,
      [keyboardEvent("archive", 10_000)],
      "archive",
      40_000,
    );
    state = addTypingReservoirEvents(
      state,
      [keyboardEvent("live", 20_000)],
      "live",
      55_000,
    );

    const chapter = takeTypingReservoirChapter(state, 2);

    expect(chapter.events.map(({ id }) => id)).toEqual(["live", "archive"]);
    expect(chapter.hasLive).toBe(true);
    expect(chapter.repeated).toBe(false);
    expect(chapter.rotation).toBe(0);
  });

  it("keeps an incomplete live group pending until its inactivity window closes", () => {
    let state = createTypingReservoir();
    state = addTypingReservoirEvents(
      state,
      [keyboardEvent("archive", 0)],
      "archive",
      20_000,
    );
    state = addTypingReservoirEvents(
      state,
      [keyboardEvent("live", 10_000)],
      "live",
      20_000,
    );

    const pending = takeTypingReservoirChapter(state, 2);
    expect(pending.events.map(({ id }) => id)).toEqual(["archive"]);
    expect(pending.hasLive).toBe(false);

    state = addTypingReservoirEvents(pending.state, [], "live", 45_000);
    const completed = takeTypingReservoirChapter(state, 2);
    expect(completed.events.map(({ id }) => id)).toEqual(["live"]);
    expect(completed.hasLive).toBe(true);
  });

  it("merges archive and live fragments for one input and waits for live completion", () => {
    const archiveFragment = keyboardEvent("archive-fragment", 0, {
      selector: "#shared",
    });
    const liveFragment = keyboardEvent("live-fragment", 10_000, {
      selector: "#shared",
    });
    let state = createTypingReservoir();
    state = addTypingReservoirEvents(
      state,
      [archiveFragment],
      "archive",
      20_000,
    );
    state = addTypingReservoirEvents(state, [liveFragment], "live", 20_000);

    const pending = takeTypingReservoirChapter(state, 1);
    expect(pending.events).toEqual([]);

    state = addTypingReservoirEvents(state, [], "live", 45_000);
    const completed = takeTypingReservoirChapter(state, 1);
    expect(completed.events.map(({ id }) => id)).toEqual([
      "archive-fragment",
      "live-fragment",
    ]);
    expect(completed.hasLive).toBe(true);
  });

  it("rotates whole groups without repeating until every available group is seen", () => {
    let state = createTypingReservoir();
    state = addTypingReservoirEvents(
      state,
      [
        keyboardEvent("a-1", 0, { selector: "#a" }),
        keyboardEvent("a-2", 1_000, { selector: "#a" }),
        keyboardEvent("b", 50_000, { selector: "#b" }),
        keyboardEvent("c", 100_000, { selector: "#c" }),
      ],
      "archive",
      200_000,
    );

    const first = takeTypingReservoirChapter(state, 2);
    expect(first.events.map(({ id }) => id)).toEqual(["c", "b"]);
    expect(first.repeated).toBe(false);
    expect(first.rotation).toBe(0);

    const second = takeTypingReservoirChapter(first.state, 2);
    expect(second.events.map(({ id }) => id)).toEqual(["a-1", "a-2"]);
    expect(second.repeated).toBe(false);
    expect(second.rotation).toBe(0);

    const third = takeTypingReservoirChapter(second.state, 2);
    expect(third.events.map(({ id }) => id)).toEqual(["c", "b"]);
    expect(third.repeated).toBe(true);
    expect(third.rotation).toBe(1);
  });

  it("deduplicates event IDs while keeping an overlapping group whole", () => {
    const shared = keyboardEvent("shared", 0, { selector: "#shared" });
    const archiveCompanion = keyboardEvent("archive-companion", 1_000, {
      selector: "#shared",
    });
    let state = createTypingReservoir();
    state = addTypingReservoirEvents(
      state,
      [shared, shared, archiveCompanion],
      "archive",
      40_000,
    );
    state = addTypingReservoirEvents(state, [shared], "live", 40_000);

    const chapter = takeTypingReservoirChapter(state, 2);

    expect(chapter.events.map(({ id }) => id)).toEqual([
      "shared",
      "archive-companion",
    ]);
    expect(new Set(chapter.events.map(({ id }) => id)).size).toBe(
      chapter.events.length,
    );
    expect(chapter.hasLive).toBe(true);
  });

  it("does not mutate the state passed to add or take", () => {
    const initial = createTypingReservoir();
    const populated = addTypingReservoirEvents(
      initial,
      [keyboardEvent("archive", 0)],
      "archive",
      40_000,
    );
    const chapter = takeTypingReservoirChapter(populated, 1);

    expect(initial.archiveEvents).toEqual([]);
    expect(populated.seenEventIds.size).toBe(0);
    expect(chapter.state.seenEventIds).not.toBe(populated.seenEventIds);
  });
});
