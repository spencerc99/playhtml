// ABOUTME: Tests logical scroll-window grouping with real viewport event shapes.
// ABOUTME: Covers session identity, inactivity boundaries, ordering, and visible activity.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import { SCROLL_SESSION_THRESHOLD } from "../eventUtils";
import {
  groupScrollEvents,
  scrollEventGroupHasActivity,
  scrollEventGroupHasVisibleActivity,
} from "../scrollEventGroups";

function viewportEvent(
  id: string,
  ts: number,
  options: {
    pid?: string;
    sid?: string;
    url?: string;
    event?: "scroll" | "resize" | "zoom";
    scrollX?: number;
    scrollY?: number;
    width?: number;
    height?: number;
    zoom?: number;
  } = {},
): CollectionEvent {
  return {
    id,
    type: "viewport",
    ts,
    data: {
      event: options.event ?? "scroll",
      scrollX: options.scrollX ?? 0,
      scrollY: options.scrollY ?? 0,
      width: options.width,
      height: options.height,
      zoom: options.zoom,
    },
    meta: {
      pid: options.pid ?? "person",
      sid: options.sid ?? "session",
      url: options.url ?? "https://example.com/page",
      vw: 1280,
      vh: 720,
      tz: "UTC",
    },
  };
}

describe("groupScrollEvents", () => {
  it("groups one participant, browser session, and URL within 15 minutes", () => {
    const groups = groupScrollEvents([
      viewportEvent("later", SCROLL_SESSION_THRESHOLD, { scrollY: 0.8 }),
      viewportEvent("earlier", 0, { scrollY: 0.1 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].events.map(({ id }) => id)).toEqual(["earlier", "later"]);
  });

  it("splits after the renderer inactivity boundary", () => {
    const groups = groupScrollEvents([
      viewportEvent("first", 0),
      viewportEvent("second", SCROLL_SESSION_THRESHOLD + 1),
    ]);

    expect(groups.map((group) => group.events.map(({ id }) => id))).toEqual([
      ["first"],
      ["second"],
    ]);
  });

  it("keeps participant, browser session, and URL identities separate", () => {
    const groups = groupScrollEvents([
      viewportEvent("base", 0),
      viewportEvent("pid", 1, { pid: "other" }),
      viewportEvent("sid", 2, { sid: "other" }),
      viewportEvent("url", 3, { url: "https://example.org" }),
    ]);

    expect(groups).toHaveLength(4);
  });

  it("recognizes visible scroll, resize, and zoom changes", () => {
    const visibleScroll = groupScrollEvents([
      viewportEvent("scroll-a", 0, { scrollY: 0.1 }),
      viewportEvent("scroll-b", 1, { scrollY: 0.2 }),
    ])[0];
    const visibleResize = groupScrollEvents([
      viewportEvent("resize-a", 0, { event: "resize", width: 800 }),
      viewportEvent("resize-b", 1, { event: "resize", width: 1000 }),
    ])[0];
    const visibleZoom = groupScrollEvents([
      viewportEvent("zoom-a", 0, { event: "zoom", zoom: 1 }),
      viewportEvent("zoom-b", 1, { event: "zoom", zoom: 1.25 }),
    ])[0];
    const invisible = groupScrollEvents([
      viewportEvent("small-a", 0, { scrollY: 0.1 }),
      viewportEvent("small-b", 1, { scrollY: 0.11 }),
    ])[0];

    expect(scrollEventGroupHasVisibleActivity(visibleScroll)).toBe(true);
    expect(scrollEventGroupHasVisibleActivity(visibleResize)).toBe(true);
    expect(scrollEventGroupHasVisibleActivity(visibleZoom)).toBe(true);
    expect(scrollEventGroupHasVisibleActivity(invisible)).toBe(false);
  });

  it("matches the renderer's activity fallback without treating horizontal scroll as visible", () => {
    const horizontal = groupScrollEvents([
      viewportEvent("horizontal-a", 0, { scrollX: 0.1 }),
      viewportEvent("horizontal-b", 1, { scrollX: 0.3 }),
    ])[0];
    const oneResize = groupScrollEvents([
      viewportEvent("resize", 0, { event: "resize", width: 800 }),
    ])[0];

    expect(scrollEventGroupHasActivity(horizontal)).toBe(true);
    expect(scrollEventGroupHasVisibleActivity(horizontal)).toBe(false);
    expect(scrollEventGroupHasActivity(oneResize)).toBe(true);
    expect(scrollEventGroupHasVisibleActivity(oneResize)).toBe(false);
  });

  it("evaluates visibility after timeline compression and the 30-second cap", () => {
    const capped = groupScrollEvents([
      viewportEvent("early", 0, { scrollY: 0.1 }),
      viewportEvent("late", 6 * 60_000, { scrollY: 0.4 }),
    ])[0];

    expect(scrollEventGroupHasActivity(capped)).toBe(true);
    expect(scrollEventGroupHasVisibleActivity(capped)).toBe(false);
  });

  it("omits non-viewport and unidentified events", () => {
    const viewport = viewportEvent("visible", 0);
    expect(
      groupScrollEvents([
        { ...viewport, id: "", ts: 1 },
        { ...viewport, id: "cursor", type: "cursor", ts: 2 },
        viewport,
      ]).flatMap((group) => group.events.map(({ id }) => id)),
    ).toEqual(["visible"]);
  });
});
