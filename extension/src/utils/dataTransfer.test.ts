// ABOUTME: Verifies extension data export compression and JSON reconstruction.
// ABOUTME: Protects large exports from requiring one full-size JSON string.

import { describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import { gunzipToString, gzipEventExport } from "./dataTransfer";

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
