// ABOUTME: Verifies extension data export compression and JSON reconstruction.
// ABOUTME: Protects large exports from requiring one full-size JSON string.

import { describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import {
  gunzipToString,
  gzipEventExport,
  gzipEventExportPages,
} from "./dataTransfer";
import { readExportFiles } from "./importStream";

describe("gzipEventExport", () => {
  it("serializes each event separately while preserving the export format", async () => {
    const events = [
      { id: "event-1", type: "cursor", ts: 1, data: { x: 10, y: 20 } },
      { id: "event-2", type: "click", ts: 2, data: { x: 30, y: 40 } },
    ] as CollectionEvent[];
    const identity = {
      publicKey: "pk_test",
      playerStyle: { colorPalette: ["#4a9a8a"] },
    };
    const stringify = vi.spyOn(JSON, "stringify");

    const compressed = await gzipEventExport(events, identity, 123);
    const parsed = JSON.parse(await gunzipToString(compressed));

    expect(parsed).toEqual({ version: 1, exportedAt: 123, events, identity });
    expect(stringify).not.toHaveBeenCalledWith(
      expect.objectContaining({ events }),
    );
    expect(stringify).toHaveBeenCalledWith(events[0]);
    expect(stringify).toHaveBeenCalledWith(events[1]);
  });
});

describe("gzipEventExportPages", () => {
  it("builds an importable export from pages without holding every event", async () => {
    const pages = [
      [
        { id: "a", type: "cursor", ts: 1, data: {} },
        { id: "b", type: "cursor", ts: 2, data: {} },
      ],
      [],
      [{ id: "c", type: "click", ts: 3, data: {} }],
    ] as CollectionEvent[][];
    let next = 0;
    const progress: number[] = [];

    const blob = await gzipEventExportPages(
      async () => (next < pages.length ? pages[next++] : null),
      null,
      9,
      (written) => progress.push(written),
    );

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parsed = JSON.parse(await gunzipToString(bytes));
    expect(parsed.events.map((e: CollectionEvent) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(progress).toEqual([2, 3]);

    const imported: string[] = [];
    await readExportFiles(
      [new File([bytes], "export.json.gz")],
      async (events) => {
        imported.push(...events.map(({ id }) => id));
      },
    );
    expect(imported).toEqual(["a", "b", "c"]);
  });
});
