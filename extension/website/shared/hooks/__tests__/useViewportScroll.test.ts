// ABOUTME: Tests recorded scroll, resize, and zoom timelines passed to viewport playback.
// ABOUTME: Ensures long sessions retain every keyframe at its natural timestamp.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
