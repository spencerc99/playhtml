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

// Tells React this suite drives its updates through act(), so it checks them.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

/**
 * Puts a picture onto the newest record in `stored`, the way the real store
 * does: only while that record is still the arrangement it was drawn from.
 */
function previewOnto(stored: CollageRecord[]) {
  return async (id: string, arrangedAt: number, image: Blob) => {
    const newest = [...stored].reverse().find((record) => record.id === id);
    if (!newest || newest.updatedAt !== arrangedAt) return false;
    stored.push({ ...newest, preview: { drawn: true, image } });
    return true;
  };
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
      storePreview: previewOnto(stored),
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
      storePreview: previewOnto(stored),
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
      storePreview: previewOnto(stored),
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

describe("the picture the back shows through", () => {
  it("hands out the loaded picture, then each newer one that draws", async () => {
    const loaded = new Blob(["the original picture"], { type: "image/gif" });
    const rebaked = new Blob(["the new picture"], { type: "image/png" });
    const bake = deferredBlob();
    const timers = manualTimers();

    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: true, image: loaded }),
        hasContent: true,
      }),
      bake: () => bake.promise,
      store: async () => {},
      storePreview: async () => true,
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: true, image: loaded }),
      timers,
    });
    expect(autosave.current().preview).toBe(loaded);

    await act(async () => {
      autosave.current().noteChange();
      timers.runAll();
    });
    await act(async () => {});
    // Written but not yet re-drawn: the old picture is still the last good one.
    expect(autosave.current().preview).toBe(loaded);
    expect(autosave.current().standing.kind).toBe("saving");

    await act(async () => {
      bake.settle(rebaked);
    });
    await act(async () => {});
    expect(autosave.current().preview).toBe(rebaked);
    expect(autosave.current().standing.kind).toBe("saved");
  });
});

describe("leaving the studio", () => {
  it("writes an edit that had not settled yet when the studio goes", async () => {
    const timers = manualTimers();
    const stored: CollageRecord[] = [];
    const loaded = new Blob(["the original picture"], { type: "image/png" });
    let title = "a collage";
    const autosave = await mountAutosave({
      draft: () => ({
        record: { ...baseRecord({ drawn: true, image: loaded }), title },
        hasContent: true,
      }),
      bake: () => deferredBlob().promise,
      store: async (record) => {
        stored.push(record);
      },
      storePreview: previewOnto(stored),
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: true, image: loaded }),
      timers,
    });

    title = "renamed just before leaving";
    await act(async () => {
      autosave.current().noteChange();
    });
    expect(stored).toHaveLength(0);

    const root = mounted!;
    mounted = null;
    await act(async () => root.unmount());
    await act(async () => {});

    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe("renamed just before leaving");
  });

  it("writes nothing on leaving when nothing changed", async () => {
    const stored: CollageRecord[] = [];
    await mountAutosave({
      draft: () => ({ record: baseRecord({ drawn: false, reason: "x" }), hasContent: true }),
      bake: () => deferredBlob().promise,
      store: async (record) => {
        stored.push(record);
      },
      storePreview: previewOnto(stored),
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: false, reason: "x" }),
      timers: manualTimers(),
    });
    const root = mounted!;
    mounted = null;
    await act(async () => root.unmount());
    await act(async () => {});
    expect(stored).toHaveLength(0);
  });
});

/** Whether a promise has settled within a short real-time wait. */
async function settlesSoon(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");
  const outcome = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled",
    ),
    new Promise((resolve) => setTimeout(() => resolve(pending), 50)),
  ]);
  return outcome !== pending;
}

describe("leaving the studio while the drawer fails", () => {
  // Reopening the collage waits on this promise, so one that never settled
  // would leave "opening collage tools..." on screen for good.
  it("lets go of the reopen once the last write has failed", async () => {
    const timers = manualTimers();
    const loaded = new Blob(["the original picture"], { type: "image/png" });
    const attempts: CollageRecord[] = [];
    const closings: Promise<void>[] = [];
    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: true, image: loaded }),
        hasContent: true,
      }),
      bake: () => deferredBlob().promise,
      store: async (record) => {
        attempts.push(record);
        throw new Error("the collage drawer would not open");
      },
      storePreview: previewOnto(attempts),
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: true, image: loaded }),
      timers,
      onClosed: (stored) => closings.push(stored),
    });

    // One write has already failed and is waiting on its retry.
    await act(async () => {
      autosave.current().noteChange();
      timers.runAll();
    });
    await act(async () => {});
    expect(autosave.current().standing.kind).toBe("failed");
    expect(attempts).toHaveLength(1);

    const root = mounted!;
    mounted = null;
    await act(async () => root.unmount());
    await act(async () => {});

    expect(closings).toHaveLength(1);
    // Leaving writes once more, and that write fails too.
    expect(attempts).toHaveLength(2);
    expect(await settlesSoon(closings[0])).toBe(true);
    // A closed studio no longer retries on its own.
    await act(async () => timers.runAll());
    await act(async () => {});
    expect(attempts).toHaveLength(2);
  });
});

describe("leaving right after an edit, when that write fails", () => {
  it("says the last change was not stored, once", async () => {
    const timers = manualTimers();
    const loaded = new Blob(["the original picture"], { type: "image/png" });
    const attempts: CollageRecord[] = [];
    const lost: Array<{ title: string; reason: string }> = [];
    let title = "a collage";
    const autosave = await mountAutosave({
      draft: () => ({
        record: { ...baseRecord({ drawn: true, image: loaded }), title },
        hasContent: true,
      }),
      bake: () => deferredBlob().promise,
      store: async (record) => {
        attempts.push(record);
        throw new Error("the collage drawer would not open");
      },
      storePreview: previewOnto(attempts),
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: true, image: loaded }),
      timers,
      onUnsaved: (each) => lost.push(each),
    });

    title = "renamed just before leaving";
    await act(async () => autosave.current().noteChange());
    expect(lost).toEqual([]);

    const root = mounted!;
    mounted = null;
    await act(async () => root.unmount());
    await act(async () => {});
    await act(async () => timers.runAll());
    await act(async () => {});

    expect(attempts).toHaveLength(1);
    expect(lost).toEqual([
      {
        title: "renamed just before leaving",
        reason: "the collage drawer would not open",
      },
    ]);
  });

  it("says nothing when the write lands", async () => {
    const lost: unknown[] = [];
    const stored: CollageRecord[] = [];
    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: false, reason: "x" }),
        hasContent: true,
      }),
      bake: () => deferredBlob().promise,
      store: async (record) => {
        stored.push(record);
      },
      storePreview: previewOnto(stored),
      onStored: () => {},
      startsStored: true,
      reopening: baseRecord({ drawn: false, reason: "x" }),
      timers: manualTimers(),
      onUnsaved: (each) => lost.push(each),
    });
    await act(async () => autosave.current().noteChange());
    const root = mounted!;
    mounted = null;
    await act(async () => root.unmount());
    await act(async () => {});

    expect(stored).toHaveLength(1);
    expect(lost).toEqual([]);
  });
});

describe("a write that fails", () => {
  it("is tried again on its own until it lands", async () => {
    const timers = manualTimers();
    const stored: CollageRecord[] = [];
    let failures = 2;
    const loaded = new Blob(["the original picture"], { type: "image/png" });
    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: true, image: loaded }),
        hasContent: true,
      }),
      bake: () => deferredBlob().promise,
      store: async (record) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("the collage drawer would not open");
        }
        stored.push(record);
      },
      storePreview: previewOnto(stored),
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
    expect(autosave.current().standing.kind).toBe("failed");
    expect(autosave.current().unwritten).toBe(true);

    // The first retry fails too; the second lands.
    await act(async () => timers.runAll());
    await act(async () => {});
    expect(autosave.current().standing.kind).toBe("failed");
    await act(async () => timers.runAll());
    await act(async () => {});

    expect(stored).toHaveLength(1);
    expect(autosave.current().unwritten).toBe(false);
  });
});

describe("the first save of a new collage", () => {
  it("draws the picture once", async () => {
    const timers = manualTimers();
    const stored: CollageRecord[] = [];
    const picture = new Blob(["the first picture"], { type: "image/png" });
    const bake = vi.fn(async () => picture);
    const autosave = await mountAutosave({
      draft: () => ({
        record: baseRecord({ drawn: false, reason: "not drawn yet" }),
        hasContent: true,
      }),
      bake,
      store: async (record) => {
        stored.push(record);
      },
      storePreview: previewOnto(stored),
      onStored: () => {},
      startsStored: false,
      timers,
    });

    await act(async () => {
      autosave.current().noteChange();
      timers.runAll();
    });
    await act(async () => {});
    await act(async () => {});

    expect(bake).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(1);
    expect(stored[0].preview).toEqual({ drawn: true, image: picture });
    expect(autosave.current().standing.kind).toBe("saved");
  });
});
