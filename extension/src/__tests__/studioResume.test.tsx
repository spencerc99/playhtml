// ABOUTME: Tests that a collage studio left and opened again comes back on the newest stored copy.
// ABOUTME: Runs the real autosave and the real collage store on in-memory IndexedDB, with no studio UI.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  useCollageAutosave,
  type AutosaveTimers,
  type CollageAutosave,
} from "../entrypoints/scraps/useCollageAutosave";
import {
  listCollages,
  loadCollage,
  saveCollage,
} from "../entrypoints/scraps/collageStore";
import { resumeStudio } from "../entrypoints/scraps/studioResume";
import type {
  CollagePiece,
  CollageRecord,
} from "../entrypoints/scraps/collageRecord";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const DB_NAME = "scrap_collages_db";
const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
  });
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
    fakeIndexedDB;
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: fakeIDBKeyRange,
    configurable: true,
  });
  await deleteDatabase();
});

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  await deleteDatabase();
  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
    originalIndexedDB;
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: originalIDBKeyRange,
    configurable: true,
  });
});

function piece(overrides: Partial<CollagePiece> = {}): CollagePiece {
  return {
    id: "piece_1",
    scrapId: "scrap_1",
    scrap: {
      id: "scrap_1",
      key: "image:one",
      kind: "image",
      src: "https://example.test/one.png",
      naturalWidth: 100,
      naturalHeight: 80,
      pageTitle: "A page",
      domain: "example.test",
      pageUrl: "https://example.test/a",
      ts: 1_000,
    } as ScrapItem,
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

function collage(
  id: string,
  pieces: CollagePiece[],
): Omit<CollageRecord, "preview"> {
  return {
    id,
    title: "a walk",
    createdAt: 1,
    updatedAt: 1,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#fffdf9", grain: false },
    pieces,
  };
}

/** Timers the test runs by hand. */
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

/** Lets IndexedDB work settle and React catch up with it. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

interface Studio {
  autosave: () => CollageAutosave;
  /** The arrangement on screen, which the next write stores. */
  setPieces: (pieces: CollagePiece[]) => void;
  pieces: () => CollagePiece[];
  /** Leaves the studio, handing back what it said it was still storing. */
  leave: () => Promise<{ closing: Promise<void> }>;
}

/**
 * A stand-in for the studio around the autosave: it holds the pieces on
 * screen, opened from `opened` the way the studio is, and stores through the
 * real collage store. Every stored record is kept in `writes`.
 */
async function openStudio(options: {
  id: string;
  opened: CollageRecord | null;
  writes: CollageRecord[];
  onSaved?: (record: CollageRecord) => void;
}): Promise<Studio> {
  let pieces = options.opened?.pieces.map((each) => ({ ...each })) ?? [];
  let latest: CollageAutosave | null = null;
  let closing: Promise<void> | null = null;
  const timers = manualTimers();
  function Harness() {
    latest = useCollageAutosave({
      draft: () => ({
        record: { ...collage(options.id, pieces), updatedAt: Date.now() },
        hasContent: pieces.length > 0,
      }),
      bake: async () => {
        throw new Error("not drawn in a test");
      },
      store: async (record) => {
        options.writes.push(record);
        await saveCollage(record);
      },
      onStored: (record) => options.onSaved?.(record),
      startsStored: options.opened !== null,
      reopening: options.opened,
      timers,
      onClosed: (stored) => {
        closing = stored;
      },
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  return {
    autosave: () => latest!,
    setPieces: (next) => {
      pieces = next;
      act(() => latest!.noteChange());
    },
    pieces: () => pieces,
    leave: async () => {
      await act(async () => root.unmount());
      if (!closing) throw new Error("the studio did not say it was closing");
      return { closing };
    },
  };
}

describe("reopening a collage that was left mid-edit", () => {
  it("comes back on the edited copy, and its next edit keeps that edit", async () => {
    const original = piece({ x: 10 });
    await saveCollage({
      ...collage("collage_a", [original]),
      preview: { drawn: false, reason: "not drawn in a test" },
    });
    const opened = await loadCollage("collage_a");
    const firstWrites: CollageRecord[] = [];
    const first = await openStudio({
      id: "collage_a",
      opened,
      writes: firstWrites,
    });

    // Moved, then left (the browse chip) before the edit settled.
    first.setPieces([{ ...original, x: 600 }]);
    const { closing } = await first.leave();

    // Create again: the studio reopens from what is stored once it lands.
    const resumed = await resumeStudio({
      closing,
      collageId: () => "collage_a",
      load: loadCollage,
    });
    expect(resumed.kind).toBe("stored");
    if (resumed.kind !== "stored") return;
    expect(resumed.record.pieces.map((each) => each.x)).toEqual([600]);

    const secondWrites: CollageRecord[] = [];
    const second = await openStudio({
      id: "collage_a",
      opened: resumed.record,
      writes: secondWrites,
    });
    expect(second.pieces().map((each) => each.x)).toEqual([600]);
    second.setPieces([...second.pieces(), piece({ id: "piece_2", x: 900, z: 1 })]);
    await act(async () => second.autosave().flush());
    await settle();

    expect(secondWrites.length).toBeGreaterThan(0);
    for (const record of secondWrites) {
      expect(record.pieces.map((each) => each.x)).toEqual([600, 900]);
    }
    // Nothing the first studio still had in hand landed over the second's.
    const stored = await loadCollage("collage_a");
    expect(stored?.pieces.map((each) => each.x)).toEqual([600, 900]);
  });
});

describe("reopening a new collage that was saved as it closed", () => {
  it("continues the same collage instead of starting a second one", async () => {
    let savedId: string | null = null;
    const first = await openStudio({
      id: "collage_new",
      opened: null,
      writes: [],
      onSaved: (record) => {
        savedId = record.id;
      },
    });
    first.setPieces([piece()]);
    const { closing } = await first.leave();

    const resumed = await resumeStudio({
      closing,
      // Read only once the closing save has landed, as the page does.
      collageId: () => savedId,
      load: loadCollage,
    });
    expect(resumed.kind).toBe("stored");
    if (resumed.kind !== "stored") return;
    expect(resumed.record.id).toBe("collage_new");

    const second = await openStudio({
      id: resumed.record.id,
      opened: resumed.record,
      writes: [],
    });
    second.setPieces([...second.pieces(), piece({ id: "piece_2", z: 1 })]);
    await act(async () => second.autosave().flush());
    await settle();

    const all = await listCollages();
    expect(all.map((entry) => entry.id)).toEqual(["collage_new"]);
    expect((await loadCollage("collage_new"))?.pieces).toHaveLength(2);
  });

  it("starts a new collage when nothing was ever stored", async () => {
    const first = await openStudio({
      id: "collage_empty",
      opened: null,
      writes: [],
    });
    const { closing } = await first.leave();
    const resumed = await resumeStudio({
      closing,
      collageId: () => null,
      load: loadCollage,
    });
    expect(resumed).toEqual({ kind: "new" });
    expect(await listCollages()).toHaveLength(0);
  });
});

describe("a collage that cannot be read back", () => {
  it("is not reopened from an older copy", async () => {
    const resumed = await resumeStudio({
      closing: Promise.resolve(),
      collageId: () => "collage_a",
      load: async () => {
        throw new Error("the drawer is stuck");
      },
    });
    expect(resumed).toEqual({ kind: "failed", reason: "the drawer is stuck" });
  });
});
