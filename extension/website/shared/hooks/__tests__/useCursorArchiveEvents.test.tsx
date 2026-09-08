// ABOUTME: Verifies cursor archive batches remain intact throughout live updates.
// ABOUTME: Covers field and follower footage with overlapping stream events.
// @vitest-environment jsdom

import React, { act, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useCursorArchiveEvents } from "../useCursorArchiveEvents";
import {
  eventsForInstallationScreen,
  participantInstallationSlot,
} from "../../utils/liveInstallation";
import { LIVE_INSTALLATION_PROFILES } from "../../utils/liveInstallationProfiles";
import type { CollectionEvent } from "../../types";

it.each([
  "cursors",
  "follower-a",
  "follower-b",
  "follower-c",
  "follower-d",
] as const)(
  "preserves %s footage until the archive batch changes",
  async (profileName) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const root = createRoot(document.createElement("div"));
    const screen = LIVE_INSTALLATION_PROFILES[profileName].screen!;
    let participant = 0;
    while (
      participantInstallationSlot(`p${participant}`, screen.slots) !==
      screen.slot
    )
      participant++;
    const pid = `p${participant}`;
    const event = (id: string): CollectionEvent => ({
      id,
      ts: 100,
      type: "cursor",
      data: { event: "move", x: 0, y: 0 },
      meta: { pid, sid: "s", url: "u", vw: 1000, vh: 800, tz: "UTC" },
    });
    const archive = [event("a"), event("b"), event("c")];
    let rendered: CollectionEvent[] = [];
    function Probe({
      footage,
      live,
    }: {
      footage: CollectionEvent[];
      live: CollectionEvent[];
    }) {
      const filtered = useMemo(
        () => eventsForInstallationScreen(footage, screen),
        [footage],
      );
      rendered = useCursorArchiveEvents(filtered, live);
      return null;
    }
    try {
      await act(async () =>
        root.render(React.createElement(Probe, { footage: archive, live: [archive[0]] })),
      );
      expect(rendered.map((event) => event.id)).toEqual(["b", "c"]);
      const initial = rendered;
      await act(async () =>
        root.render(React.createElement(Probe, { footage: archive, live: [...archive] })),
      );
      expect(rendered).toBe(initial);
      await act(async () => root.render(React.createElement(Probe, { footage: archive, live: [] })));
      expect(rendered).toBe(initial);
      const next = [...archive, event("d")];
      await act(async () =>
        root.render(React.createElement(Probe, { footage: next, live: archive })),
      );
      expect(rendered.map((event) => event.id)).toEqual(["d"]);
    } finally {
      await act(async () => root.unmount());
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  },
);
