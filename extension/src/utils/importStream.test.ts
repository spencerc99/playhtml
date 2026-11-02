// ABOUTME: Verifies streaming import reads exports of any size in batches with progress.
// ABOUTME: Covers events split across chunk boundaries, strings with brackets, and bad files.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import { gzipEventExport, gzipString } from "./dataTransfer";
import {
  ExportEventScanner,
  IMPORT_BATCH_SIZE,
  estimateRemainingMs,
  readExportFiles,
} from "./importStream";

function cursorEvent(index: number): CollectionEvent {
  return {
    id: `event-${index}`,
    type: "cursor",
    ts: 1_700_000_000_000 + index,
    data: { x: 0.5, y: 0.25, event: "move" },
    meta: {
      pid: "pk_test",
      sid: "sid_test",
      url: `https://example.com/page?q={"a":[1,2]}&n=${index}`,
      vw: 1440,
      vh: 900,
      tz: "UTC",
    },
  } as CollectionEvent;
}

/** A file stand-in: jsdom's Blob cannot read its bytes back. */
function gzFile(bytes: Uint8Array) {
  return {
    size: bytes.byteLength,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer as ArrayBuffer,
    }),
  };
}

async function exportText(events: CollectionEvent[]): Promise<string> {
  const bytes = await gzipEventExport(events, null, 1);
  return new Response(
    new Response(bytes as BodyInit).body!.pipeThrough(
      new DecompressionStream("gzip"),
    ),
  ).text();
}

describe("ExportEventScanner", () => {
  it("returns every event when the text arrives one character at a time", async () => {
    const events = [cursorEvent(1), cursorEvent(2), cursorEvent(3)];
    events[1].meta.url = 'https://example.com/"quoted"\\path}]';
    const text = await exportText(events);

    const scanner = new ExportEventScanner();
    const read: CollectionEvent[] = [];
    for (const char of text) read.push(...scanner.push(char));
    scanner.finish();

    expect(read).toEqual(events);
  });

  it("rejects an export version it cannot read", () => {
    const scanner = new ExportEventScanner();
    expect(() => scanner.push('{"version":2,"events":[')).toThrow(
      "version we can't read",
    );
  });

  it("rejects a file that is not an export", () => {
    const scanner = new ExportEventScanner();
    expect(() => scanner.push('{"something":"else","events":[')).toThrow();
    const other = new ExportEventScanner();
    other.push('{"version":1,"exportedAt":1}');
    expect(() => other.finish()).toThrow("ended before all of its events");
  });

  it("stops at the end of the events array and ignores what follows", () => {
    const scanner = new ExportEventScanner();
    const read = scanner.push(
      '{"version":1,"events":[{"id":"a"}],"identity":{"events":[{"id":"b"}]}}',
    );
    scanner.finish();
    expect(read).toEqual([{ id: "a" }]);
  });
});

describe("readExportFiles", () => {
  it("reads several gzipped files in batches and reports progress to the end", async () => {
    const first = Array.from({ length: IMPORT_BATCH_SIZE + 5 }, (_, i) =>
      cursorEvent(i),
    );
    const second = [cursorEvent(10_000)];
    const files = [
      gzFile(await gzipEventExport(first, null, 1)),
      gzFile(await gzipEventExport(second, null, 1)),
    ];
    const totalBytes = files[0].size + files[1].size;

    const batches: number[] = [];
    const ids: string[] = [];
    let lastProgress = { bytesRead: 0, totalBytes: 0, eventsRead: 0 };
    await readExportFiles(files, async (events, progress) => {
      batches.push(events.length);
      ids.push(...events.map((event) => event.id));
      expect(progress.bytesRead).toBeGreaterThanOrEqual(lastProgress.bytesRead);
      lastProgress = progress;
    });

    expect(Math.max(...batches)).toBeLessThanOrEqual(IMPORT_BATCH_SIZE);
    expect(ids).toEqual([...first, ...second].map((event) => event.id));
    expect(lastProgress).toEqual({
      bytesRead: totalBytes,
      totalBytes,
      eventsRead: first.length + second.length,
    });
  });

  it("fails on a truncated file", async () => {
    const bytes = await gzipString('{"version":1,"events":[{"id":"a"},');
    await expect(
      readExportFiles([gzFile(bytes)], async () => {}),
    ).rejects.toThrow("ended before all of its events");
  });
});

describe("estimateRemainingMs", () => {
  it("waits for enough progress before estimating", () => {
    expect(estimateRemainingMs(1000, 50, 100)).toBeNull();
    expect(estimateRemainingMs(10_000, 1, 100)).toBeNull();
  });

  it("projects the remaining time from the rate so far", () => {
    expect(estimateRemainingMs(10_000, 25, 100)).toBe(30_000);
  });
});
