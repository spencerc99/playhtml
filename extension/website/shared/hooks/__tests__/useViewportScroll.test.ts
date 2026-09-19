// ABOUTME: Tests recorded scroll, resize, and zoom timelines passed to viewport playback.
// ABOUTME: Ensures long sessions retain every keyframe at its natural timestamp.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  useViewportScroll,
  type UseViewportScrollResult,
} from "../useViewportScroll";

function recordedEvents(): CollectionEvent[] {
  return [
    { ts: 1000, data: { event: "scroll", scrollY: 0, scrollX: 0 } },
    { ts: 11000, data: { event: "scroll", scrollY: 0.25, scrollX: 0 } },
    { ts: 21000, data: { event: "resize", width: 900, height: 700 } },
    { ts: 31000, data: { event: "zoom", zoom: 1.5 } },
    { ts: 41000, data: { event: "scroll", scrollY: 1, scrollX: 0 } },
  ].map((event, index) => ({
    ...event,
    id: `viewport-${index}`,
    type: "viewport",
    meta: {
      pid: "person",
      sid: "session",
      url: "https://example.com",
      vw: 1200,
      vh: 800,
      tz: "UTC",
    },
  }));
}

describe("useViewportScroll recorded timing", () => {
  it("preserves natural timing and retains activity beyond 30 seconds", () => {
    let result: UseViewportScrollResult | undefined;
    function Harness() {
      result = useViewportScroll(
        recordedEvents(),
        { width: 1200, height: 800 },
        {
          recordedTiming: true,
          filters: [],
          pidFilter: "",
          viewportEventFilter: { scroll: true, resize: true, zoom: true },
        },
      );
      return null;
    }
    renderToStaticMarkup(createElement(Harness));
    expect(result?.animations).toHaveLength(1);
    const animation = result!.animations[0];
    expect(animation.scrollEvents.map((event) => event.timestamp)).toEqual([
      1000, 11000, 41000,
    ]);
    expect(animation.resizeEvents?.[0].timestamp).toBe(21000);
    expect(animation.zoomEvents?.[0].timestamp).toBe(31000);
    expect(animation.endTime - animation.startTime).toBe(40000);
  });
});

function processEvents(events: CollectionEvent[], recordedTiming?: boolean) {
  let result: UseViewportScrollResult | undefined;
  function Harness() {
    result = useViewportScroll(
      events,
      { width: 1200, height: 800 },
      {
        recordedTiming,
        filters: [],
        pidFilter: "",
        viewportEventFilter: { scroll: true, resize: true, zoom: true },
      },
    );
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result!.animations;
}

describe("scroll playback scope", () => {
  it("bounds recorded resize and zoom to each visit", () => {
    const first = recordedEvents();
    const later = first.map((event) => ({
      ...event,
      id: `later-${event.id}`,
      ts: event.ts + 3600000,
    }));
    const animations = processEvents([...first, ...later], true);
    expect(animations).toHaveLength(2);
    expect(
      animations.map(({ startTime, endTime }) => [startTime, endTime]),
    ).toEqual([
      [1000, 41000],
      [3601000, 3641000],
    ]);
    expect(animations[0].resizeEvents?.map((event) => event.timestamp)).toEqual(
      [21000],
    );
    expect(animations[0].zoomEvents?.map((event) => event.timestamp)).toEqual([
      31000,
    ]);
    expect(animations[1].resizeEvents?.map((event) => event.timestamp)).toEqual(
      [3621000],
    );
    expect(animations[1].zoomEvents?.map((event) => event.timestamp)).toEqual([
      3631000,
    ]);
  });

  it("keeps the default 30-second cap", () => {
    const events = recordedEvents();
    events.push({ ...events[4], id: "last", ts: 71000 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const animation = processEvents(events)[0];
      expect(animation.endTime - animation.startTime).toBe(30000);
      expect(animation.scrollEvents.map((event) => event.timestamp)).toEqual([
        1000, 2000, 14000,
      ]);
      expect(log).toHaveBeenCalledWith(
        "[Scroll] Animation 0 truncated: 43.0s → 30.0s",
      );
    } finally {
      log.mockRestore();
    }
  });

  it("preserves compressed timing when recorded playback is not requested", () => {
    const animation = processEvents(recordedEvents())[0];
    expect(animation.scrollEvents.map((event) => event.timestamp)).toEqual([
      1000, 2000, 14000,
    ]);
    expect(animation.resizeEvents?.[0].timestamp).toBe(3000);
    expect(animation.zoomEvents?.[0].timestamp).toBe(4000);
    expect(animation.endTime).toBe(14000);
  });
});
