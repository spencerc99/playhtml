// ABOUTME: Tests that the collage autosave never loses a preview it cannot replace.
// ABOUTME: Drives the hook with controllable bakes and timers, with no browser.

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useCollageAutosave,
  type AutosaveTimers,
  type CollageAutosave,
  type CollageAutosaveOptions,
} from "../entrypoints/scraps/useCollageAutosave";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";

/** Timers the test drives by hand, so a settle never waits on real time. */
function manualTimers(): AutosaveTimers & { runAll: () => void } {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    setTimer: (run) => {
      const handle = next++;
      pending.set(handle, run);
      return handle;
    },
    clearTimer: (handle) => {
      pending.delete(handle);
    },
    runAll: () => {
      const due = [...pending.values()];
      pending.clear();
      for (const run of due) run();
    },
  };
}

/** A bake the test resolves or rejects when it chooses. */
function deferredBlob() {
  let settle!: (blob: Blob) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<Blob>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

function baseRecord(preview: CollageRecord["preview"]): CollageRecord {
  return {
    id: "collage_1",
    title: "a collage",
    createdAt: 1,
    updatedAt: 1,
    frame: { width: 640, height: 426 },
    format: "postcard",
    paper: { color: "#faf7f2", grain: true },
    pieces: [],
    preview,
  };
}

let mounted: Root | null = null;

afterEach(() => {
  if (mounted) {
    const root = mounted;
    mounted = null;
    act(() => root.unmount());
  }
});

/** Mounts the hook and hands back its live value. */
async function mountAutosave(
  options: CollageAutosaveOptions,
): Promise<{ current: () => CollageAutosave }> {
  let latest: CollageAutosave | null = null;
  function Harness() {
    latest = useCollageAutosave(options);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = root;
  await act(async () => {
    root.render(<Harness />);
  });
  return {
    current: () => {
      if (!latest) throw new Error("the autosave hook did not render");
      return latest;
    },
  };
}

describe("reopening a collage that already has a picture", () => {
  it("keeps the loaded preview on the first arrangement write", async () => {
    const loaded = new Blob(["the original picture"], { type: "image/png" });
    const timers = manualTimers();
    const stored: CollageRecord[] = [];
    // The re-bake never settles, so the only thing that can reach the store is
    // the arrangement write — which is exactly the moment the preview was lost.
    const bake = vi.fn(() => deferredBlob().promise);

    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: true, image: loaded }),
        hasContent: true,
      }),
      bake,
      store: async (record) => {
        stored.push(record);
      },
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: true, image: loaded }),
      timers,
    });

    await act(async () => {
      autosave.current().noteChange();
      timers.runAll();
    });
    await act(async () => {});

    expect(stored).toHaveLength(1);
    expect(stored[0].preview).toEqual({ drawn: true, image: loaded });
  });

  it("leaves the loaded preview intact when the re-bake fails", async () => {
    const loaded = new Blob(["the original picture"], { type: "image/png" });
    const timers = manualTimers();
    const stored: CollageRecord[] = [];
    const bake = vi.fn(async () => {
      throw new Error("the image host is unreachable");
    });

    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: true, image: loaded }),
        hasContent: true,
      }),
      bake,
      store: async (record) => {
        stored.push(record);
      },
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: true, image: loaded }),
      timers,
    });

    await act(async () => {
      autosave.current().noteChange();
      timers.runAll();
    });
    await act(async () => {});
    await act(async () => {
      timers.runAll();
    });
    await act(async () => {});

    expect(stored.length).toBeGreaterThan(0);
    for (const record of stored) {
      expect(record.preview).toEqual({ drawn: true, image: loaded });
    }
  });
});

describe("two bakes overlapping", () => {
  it("never lets a superseded bake overwrite a newer picture", async () => {
    // Each picture carries a distinct media type, because that is the field a
    // deep comparison actually tells two Blobs apart by.
    const loaded = new Blob(["the original picture"], { type: "image/gif" });
    const first = deferredBlob();
    const second = deferredBlob();
    const firstImage = new Blob(["revision one"], { type: "image/png" });
    const secondImage = new Blob(["revision two"], { type: "image/webp" });
    const timers = manualTimers();
    const stored: CollageRecord[] = [];
    let bakeCount = 0;
    const bake = vi.fn(() => {
      bakeCount += 1;
      return bakeCount === 1 ? first.promise : second.promise;
    });

    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: true, image: loaded }),
        hasContent: true,
      }),
      bake,
      store: async (record) => {
        stored.push(record);
      },
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: true, image: loaded }),
      timers,
    });

    // Revision one settles and starts its bake, which stays in flight.
    await act(async () => {
      autosave.current().noteChange();
      timers.runAll();
    });
    await act(async () => {});
    await act(async () => {
      timers.runAll();
    });
    await act(async () => {});

    // Revision two arrives, writes, and supersedes revision one's bake.
    await act(async () => {
      autosave.current().noteChange();
      timers.runAll();
    });
    await act(async () => {});
    await act(async () => {
      timers.runAll();
    });
    await act(async () => {});

    // Revision two's picture lands first, then the stale one finally resolves.
    await act(async () => {
      second.settle(secondImage);
    });
    await act(async () => {});
    await act(async () => {
      first.settle(firstImage);
    });
    await act(async () => {});

    const drawn = stored.filter((record) => record.preview.drawn);
    expect(drawn.length).toBeGreaterThan(0);
    const last = drawn[drawn.length - 1];
    expect(last.preview).toEqual({ drawn: true, image: secondImage });
    // The stale bake's picture must never have reached the store at all; the
    // loaded picture may, because arrangement writes legitimately carry it.
    const images = drawn.map((record) =>
      record.preview.drawn ? record.preview.image.type : null,
    );
    expect(images).not.toContain(firstImage.type);
    expect(images[images.length - 1]).toBe(secondImage.type);
  });
});
