// ABOUTME: Tests finite scrolling chapter selection from live and archive reservoirs.
// ABOUTME: Verifies quiet completion, whole-window rotation, deduplication, and exhaustion.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  DEFAULT_SCROLL_INSTALLATION_CHAPTER_GROUPS,
  SCROLL_INSTALLATION_QUIET_MS,
  addScrollReservoirEvents,
  createScrollReservoir,
  takeScrollReservoirChapter,
} from "../scrollInstallationReservoir";

function scrollWindow(
  id: string,
  ts: number,
  options: { pid?: string; sid?: string; startY?: number } = {},
): CollectionEvent[] {
  const event = (suffix: string, offset: number, scrollY: number) => ({
    id: `${id}-${suffix}`,
    type: "viewport" as const,
    ts: ts + offset,
    data: { event: "scroll", scrollX: 0, scrollY },
    meta: {
      pid: options.pid ?? "person",
      sid: options.sid ?? id,
      url: "https://example.com/page",
      vw: 1280,
      vh: 720,
      tz: "UTC",
    },
  });
  const startY = options.startY ?? 0;
  return [event("a", 0, startY), event("b", 1_000, startY + 0.2)];
}

describe("scroll installation reservoir", () => {
  it("uses a named 1000-window chapter default", () => {
    expect(DEFAULT_SCROLL_INSTALLATION_CHAPTER_GROUPS).toBe(1000);
  });

  it("prioritizes completed live windows and fills from archive", () => {
    let state = createScrollReservoir();
    state = addScrollReservoirEvents(
      state,
      scrollWindow("archive", 0),
      "archive",
      100_000,
    );
    state = addScrollReservoirEvents(
      state,
      scrollWindow("live", 10_000),
      "live",
      100_000,
    );

    const chapter = takeScrollReservoirChapter(state, 2);
    expect(chapter.events.map(({ id }) => id)).toEqual([
      "live-a",
      "live-b",
      "archive-a",
      "archive-b",
    ]);
    expect(chapter.hasLive).toBe(true);
  });

  it("keeps live activity pending until its quiet period closes", () => {
    let state = addScrollReservoirEvents(
      createScrollReservoir(),
      scrollWindow("live", 10_000),
      "live",
      11_000 + SCROLL_INSTALLATION_QUIET_MS - 1,
    );

    expect(takeScrollReservoirChapter(state).events).toEqual([]);

    state = addScrollReservoirEvents(
      state,
      [],
      "live",
      11_000 + SCROLL_INSTALLATION_QUIET_MS,
    );
    expect(
      takeScrollReservoirChapter(state).events.map(({ id }) => id),
    ).toEqual(["live-a", "live-b"]);
  });

  it("shows later unseen activity from a previously displayed session", () => {
    let state = addScrollReservoirEvents(
      createScrollReservoir(),
      scrollWindow("first", 0, { sid: "shared" }),
      "archive",
      100_000,
    );
    const first = takeScrollReservoirChapter(state, 1);

    state = addScrollReservoirEvents(
      first.state,
      scrollWindow("later", 60_000, { sid: "shared", startY: 0.3 }),
      "live",
      100_000,
    );
    const later = takeScrollReservoirChapter(state, 1);

    expect(later.events.map(({ id }) => id)).toEqual(["later-a", "later-b"]);
    expect(later.repeated).toBe(false);
  });

  it("rotates whole windows without repeating events until exhaustion", () => {
    let state = addScrollReservoirEvents(
      createScrollReservoir(),
      [
        ...scrollWindow("a", 0),
        ...scrollWindow("b", 60_000),
        ...scrollWindow("c", 120_000),
      ],
      "archive",
      200_000,
    );

    const first = takeScrollReservoirChapter(state, 2);
    const second = takeScrollReservoirChapter(first.state, 2);
    const third = takeScrollReservoirChapter(second.state, 2);

    expect(first.events.map(({ id }) => id)).toEqual([
      "c-a",
      "c-b",
      "b-a",
      "b-b",
    ]);
    expect(second.events.map(({ id }) => id)).toEqual(["a-a", "a-b"]);
    expect(second.repeated).toBe(false);
    expect(third.events.map(({ id }) => id)).toEqual(
      first.events.map(({ id }) => id),
    );
    expect(third.repeated).toBe(true);
    expect(third.rotation).toBe(1);
  });

  it("deduplicates raw event IDs", () => {
    const events = scrollWindow("shared", 0);
    let state = addScrollReservoirEvents(
      createScrollReservoir(),
      [...events, ...events],
      "archive",
      100_000,
    );
    state = addScrollReservoirEvents(state, events, "live", 100_000);

    const chapter = takeScrollReservoirChapter(state);
    expect(chapter.events.map(({ id }) => id)).toEqual([
      "shared-a",
      "shared-b",
    ]);
  });

  it("uses renderer fallback activity only when no visible windows remain", () => {
    const resize: CollectionEvent = {
      id: "resize",
      type: "viewport",
      ts: 0,
      data: { event: "resize", width: 800, height: 600 },
      meta: {
        pid: "person",
        sid: "resize",
        url: "https://example.com/resize",
        vw: 800,
        vh: 600,
        tz: "UTC",
      },
    };
    let state = addScrollReservoirEvents(
      createScrollReservoir(),
      [resize, ...scrollWindow("visible", 10_000)],
      "archive",
      100_000,
    );

    const visible = takeScrollReservoirChapter(state, 1);
    expect(visible.events.map(({ id }) => id)).toEqual([
      "visible-a",
      "visible-b",
    ]);

    state = visible.state;
    const fallback = takeScrollReservoirChapter(state, 1);
    expect(fallback.events.map(({ id }) => id)).toEqual(["resize"]);
    expect(fallback.repeated).toBe(false);
  });
});
