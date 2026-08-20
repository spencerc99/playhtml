// ABOUTME: Tests finite archive batch pagination and prefetch queue behavior.
// ABOUTME: Covers older-page cursors, wrap markers, and stale request rejection.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "../../types";
import {
  advanceArchiveBatchQueue,
  createArchiveEventBatch,
  selectArchiveAnchorType,
  storePrefetchedArchiveBatch,
  type ArchiveBatchQueue,
  type ArchiveEventBatch,
} from "../archiveEventBatches";

function event(id: string, ts: number, type = "cursor"): CollectionEvent {
  return {
    id,
    type,
    ts,
    data: { x: 10, y: 20, event: type === "cursor" ? "move" : "click" },
    meta: {
      pid: "person",
      sid: "session",
      url: "https://example.com",
      vw: 100,
      vh: 100,
      tz: "UTC",
    },
  };
}

function batch(key: string): ArchiveEventBatch {
  return { key, events: [event(key, 100)], nextBeforeMs: 99 };
}

describe("selectArchiveAnchorType", () => {
  it("uses cursor events to define coherent multi-type playback windows", () => {
    expect(selectArchiveAnchorType(new Set(["click", "cursor"]))).toBe("cursor");
    expect(selectArchiveAnchorType(new Set(["keyboard"]))).toBe("keyboard");
  });
});

describe("createArchiveEventBatch", () => {
  it("sorts a full batch with companion events and points to the next older page", () => {
    const result = createArchiveEventBatch(
      [event("new", 300), event("old", 200)],
      [event("click", 250, "click")],
      2,
      null,
    );

    expect(result.events.map(({ id }) => id)).toEqual(["new", "click", "old"]);
    expect(result.nextBeforeMs).toBe(199);
    expect(result.key).toBe("300:200:3");
  });

  it("marks a partial final page for a wrap to the newest batch", () => {
    expect(
      createArchiveEventBatch([event("last", 100)], [], 2, null).nextBeforeMs,
    ).toBeNull();
  });

  it("marks the batch final when it reaches the selected lower bound", () => {
    expect(
      createArchiveEventBatch(
        [event("new", 200), event("boundary", 100)],
        [],
        2,
        100,
      ).nextBeforeMs,
    ).toBeNull();
  });
});

describe("archive batch queue", () => {
  it("advances only after a prefetched batch is ready", () => {
    const current = batch("current");
    const emptyQueue: ArchiveBatchQueue = {
      generation: 1,
      current,
      prefetched: null,
    };
    expect(advanceArchiveBatchQueue(emptyQueue)).toBe(emptyQueue);

    const next = batch("next");
    expect(
      advanceArchiveBatchQueue({ ...emptyQueue, prefetched: next }),
    ).toEqual({ generation: 1, current: next, prefetched: null });
  });

  it("ignores a prefetch result from a superseded filter generation", () => {
    const queue: ArchiveBatchQueue = {
      generation: 2,
      current: batch("current"),
      prefetched: null,
    };
    expect(storePrefetchedArchiveBatch(queue, 1, batch("stale"))).toBe(queue);
    expect(storePrefetchedArchiveBatch(queue, 2, batch("next")).prefetched?.key).toBe(
      "next",
    );
  });
});
