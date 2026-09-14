// ABOUTME: Tests partial live footage entering the continuous installation pool immediately.
// ABOUTME: Covers archive supply, in-progress growth, quiet-time retirement, and deduplication.
import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  collectInstallationRecordings,
  LIVE_RECORDING_RETENTION_MS,
  pruneRetainedLive,
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

describe("retained live footage", () => {
  const viewport = (id: string, ts: number) => event(id, ts, "viewport", "run");

  /**
   * Runs the reservoir's own loop — retain arrivals, collect, prune — so the
   * pruning of one pass is what the next pass has to work with.
   */
  function runReservoir(arrivals: CollectionEvent[][]) {
    const retained = new Map<string, CollectionEvent>();
    let last!: ReturnType<typeof collectInstallationRecordings>;
    for (const batch of arrivals) {
      for (const e of batch) retained.set(e.id, e);
      const now = batch.at(-1)!.ts;
      last = collectInstallationRecordings(
        [],
        [...retained.values()],
        "scrolling",
        now,
      );
      pruneRetainedLive(retained, last.liveEventIdsByRecording);
    }
    return { retained, last };
  }

  it("keeps a still-growing recording whole however long the person goes on", () => {
    // Scroll samples land every 500ms but a group only breaks after 15 minutes
    // of silence, so one unbroken run can outlast any fixed age bound. Losing
    // its first event would change the recording's id and restart the window.
    const start = 1_000_000;
    const arrivals: CollectionEvent[][] = [];
    for (let minute = 0; minute < 20; minute++) {
      arrivals.push([viewport(`ev_${minute}`, start + minute * 60_000)]);
    }
    const { retained, last } = runReservoir(arrivals);

    expect(retained.has("ev_0")).toBe(true);
    expect(retained.size).toBe(20);
    expect(last.liveEventIdsByRecording).toHaveLength(1);
    expect(last.liveEventIdsByRecording[0][0]).toBe("ev_0");
  });

  it("frees footage whose recording has retired", () => {
    const retained = new Map<string, CollectionEvent>();
    for (const e of [viewport("old", 0), viewport("new", 500)]) {
      retained.set(e.id, e);
    }
    // No recording claims them any more.
    pruneRetainedLive(retained, []);
    expect(retained.size).toBe(0);
  });

  it("evicts whole recordings, oldest first, rather than truncating one", () => {
    const retained = new Map<string, CollectionEvent>();
    for (const e of [viewport("a1", 0), viewport("a2", 1), viewport("b1", 2)]) {
      retained.set(e.id, e);
    }
    // Two recordings, oldest first, with the cap standing in as already full:
    // the older one goes entirely and the newer survives intact.
    pruneRetainedLive(retained, [["a1", "a2"], ["b1"]], 2);
    expect([...retained.keys()]).toEqual(["b1"]);
  });
});
