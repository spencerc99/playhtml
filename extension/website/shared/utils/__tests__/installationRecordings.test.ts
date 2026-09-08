// ABOUTME: Tests completed live footage entering the continuous installation pool.
// ABOUTME: Covers archive supply, quiet-time readiness, and whole-recording deduplication.
import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import { collectInstallationRecordings } from "../../hooks/useInstallationRecordings";

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
    it("keeps archive available while live footage is incomplete, then adds live beside it", () => {
      const archive = [event("archive", 0, type)];
      const live = [event("live", 50_000, type)];
      expect(
        collectInstallationRecordings(archive, live, kind, 84_999).events.map(
          (e) => e.id,
        ),
      ).toEqual(["archive"]);
      const ready = collectInstallationRecordings(archive, live, kind, 85_000);
      expect(ready.events.map((e) => e.id)).toEqual(["archive", "live"]);
      expect(ready.liveEventIds.has("live")).toBe(true);
    });
    it("deduplicates archive/live overlap and waits for the entire input or visit to settle", () => {
      const first = event("first", 40_000, type, "same");
      const last = event("last", 50_000, type, "same");
      expect(
        collectInstallationRecordings([first], [first, last], kind, 80_000)
          .events,
      ).toEqual([]);
      expect(
        collectInstallationRecordings(
          [first],
          [first, last],
          kind,
          85_000,
        ).events.map((e) => e.id),
      ).toEqual(["first", "last"]);
    });
  });
}
