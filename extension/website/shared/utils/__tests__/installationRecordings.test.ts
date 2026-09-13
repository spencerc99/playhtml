// ABOUTME: Tests partial live footage entering the continuous installation pool immediately.
// ABOUTME: Covers archive supply, in-progress growth, quiet-time retirement, and deduplication.
import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  collectInstallationRecordings,
  LIVE_RECORDING_RETENTION_MS,
} from "../../hooks/useInstallationRecordings";

function event(
  id: string,
  ts: number,
  type: "viewport" | "keyboard",
  sid = id,
): CollectionEvent {
  return {
    id,
    ts,
    type,
    meta: {
      pid: "person",
      sid,
      url: "https://example.com",
      vw: 1280,
      vh: 720,
      tz: "UTC",
    },
    data:
      type === "viewport"
        ? { event: "scroll", scrollX: 0, scrollY: 0.5 }
        : {
            x: 0.5,
            y: 0.5,
            t: "#input",
            sequence: [{ action: "type", text: "hello", timestamp: 0 }],
          },
  };
}

for (const [kind, type] of [
  ["scrolling", "viewport"],
  ["typing", "keyboard"],
] as const) {
  describe(`${kind} installation recordings`, () => {
    it("admits live footage immediately, beside the archive", () => {
      const archive = [event("archive", 0, type)];
      const live = [event("live", 50_000, type)];
      const admitted = collectInstallationRecordings(
        archive,
        live,
        kind,
        50_100,
      );
      expect(admitted.events.map((e) => e.id)).toEqual(["archive", "live"]);
      expect(admitted.liveEventIds.has("live")).toBe(true);
    });

    it("grows a recording in place while it is still being written", () => {
      const first = event("first", 40_000, type, "same");
      const last = event("last", 50_000, type, "same");
      const partial = collectInstallationRecordings([], [first], kind, 40_100);
      const grown = collectInstallationRecordings(
        [],
        [first, last],
        kind,
        50_100,
      );
      expect(partial.events.map((e) => e.id)).toEqual(["first"]);
      expect(grown.events.map((e) => e.id)).toEqual(["first", "last"]);
      // Same recording, more footage — the signature is what tells players to
      // extend what is already on screen rather than start something new.
      expect(grown.signature).not.toEqual(partial.signature);
    });

    it("retires a live-only recording once it has been quiet for the retention window", () => {
      const live = [event("live", 50_000, type)];
      const quiet = 50_000 + LIVE_RECORDING_RETENTION_MS;
      expect(
        collectInstallationRecordings([], live, kind, quiet).events.map(
          (e) => e.id,
        ),
      ).toEqual(["live"]);
      expect(
        collectInstallationRecordings([], live, kind, quiet + 1).events,
      ).toEqual([]);
    });

    it("keeps archive-backed footage past the retention window", () => {
      const first = event("first", 40_000, type, "same");
      const last = event("last", 50_000, type, "same");
      // `first` also came back from the archive fetch, so this recording has a
      // lasting source and stays in the rotation however old it gets.
      const recordings = collectInstallationRecordings(
        [first],
        [first, last],
        kind,
        50_000 + LIVE_RECORDING_RETENTION_MS * 10,
      );
      expect(recordings.events.map((e) => e.id)).toEqual(["first", "last"]);
    });

    it("keeps reporting work while a recording is still waiting to retire", () => {
      const live = [event("live", 50_000, type)];
      // Retirement is driven by the clock, not by arrivals, so the reservoir
      // has to know it must keep re-evaluating even when nothing new comes in.
      expect(
        collectInstallationRecordings([], live, kind, 50_100)
          .hasRetirableRecordings,
      ).toBe(true);
      expect(
        collectInstallationRecordings(
          [],
          live,
          kind,
          50_000 + LIVE_RECORDING_RETENTION_MS + 1,
        ).hasRetirableRecordings,
      ).toBe(false);
      // Archive-backed footage never retires, so it never keeps the clock running.
      expect(
        collectInstallationRecordings(live, live, kind, 50_100)
          .hasRetirableRecordings,
      ).toBe(false);
    });

    it("deduplicates archive and live copies of the same event", () => {
      const shared = event("shared", 40_000, type, "same");
      const recordings = collectInstallationRecordings(
        [shared],
        [shared],
        kind,
        40_100,
      );
      expect(recordings.events.map((e) => e.id)).toEqual(["shared"]);
    });
  });
}
