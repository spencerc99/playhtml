// ABOUTME: Tests the collage history cards: the card opens its collage, glyphs act without opening.
// ABOUTME: Runs the real collage store on an in-memory IndexedDB, rendered through React.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import { CollageHistory } from "../entrypoints/scraps/CollageHistory";
import { listCollages, saveCollage } from "../entrypoints/scraps/collageStore";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const DB_NAME = "scrap_collages_db";
const DAY = 86_400_000;
const originalIndexedDB = globalThis.indexedDB;
const originalIDBKeyRange = globalThis.IDBKeyRange;

function record(overrides: Partial<CollageRecord> = {}): CollageRecord {
  return {
    id: "collage_1",
    title: "a walk",
    createdAt: Date.UTC(2026, 2, 3, 12),
    updatedAt: Date.UTC(2026, 2, 3, 15),
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#fffdf9", grain: false },
    pieces: [],
    // An undrawn preview keeps the test clear of blob URLs.
    preview: { drawn: false, reason: "not drawn in a test" },
    ...overrides,
  };
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
    fakeIndexedDB;
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: fakeIDBKeyRange,
    configurable: true,
  });
  await deleteDatabase();
});

afterEach(async () => {
  if (root) {
    const mounted = root;
    root = null;
    act(() => mounted.unmount());
  }
  container?.remove();
  container = null;
  await deleteDatabase();
  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
    originalIndexedDB;
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: originalIDBKeyRange,
    configurable: true,
  });
});

/** Lets the store's IndexedDB work settle and React catch up with it. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount(onEdit = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <CollageHistory revision={0} onEdit={onEdit} onStartNew={() => {}} />,
    );
  });
  await settle();
  return { onEdit, view: container };
}

function buttonNamed(view: HTMLElement, name: string): HTMLButtonElement {
  const found = [...view.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("aria-label") === name ||
      button.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

describe("a collage card", () => {
  it("opens its collage from anywhere on the card, as one button", async () => {
    await saveCollage(record());
    const { onEdit, view } = await mount();
    const open = buttonNamed(view, "Open a walk");
    expect(open.tagName).toBe("BUTTON");
    expect(open.querySelector(".collage-card__thumb")).not.toBeNull();
    expect(open.querySelector(".collage-card__title")?.textContent).toBe(
      "a walk",
    );
    await act(async () => open.click());
    await settle();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].id).toBe("collage_1");
  });

  it("carries no sources and no separate way to keep editing", async () => {
    await saveCollage(record());
    const { view } = await mount();
    const names = [...view.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );
    expect(names.some((name) => /sources/i.test(name ?? ""))).toBe(false);
    expect(names.some((name) => /keep editing/i.test(name ?? ""))).toBe(false);
    expect(view.querySelector(".collage-provenance")).toBeNull();
  });

  it("says when it was made and how many pieces, and a change only after a day", async () => {
    await saveCollage(record());
    await saveCollage(
      record({
        id: "collage_2",
        title: "a later one",
        createdAt: Date.UTC(2026, 2, 3, 12),
        updatedAt: Date.UTC(2026, 2, 3, 12) + DAY * 3,
      }),
    );
    const { view } = await mount();
    const metas = [...view.querySelectorAll(".collage-card__meta")].map(
      (meta) => meta.textContent ?? "",
    );
    const sameDay = metas.find((meta) => !meta.includes("changed"));
    const later = metas.find((meta) => meta.includes("changed"));
    expect(sameDay).toMatch(/^made .+0 pieces$/);
    expect(later).toMatch(/^made .+changed .+0 pieces$/);
  });

  it("duplicates from its glyph without opening anything", async () => {
    await saveCollage(record());
    const { onEdit, view } = await mount();
    const duplicate = buttonNamed(view, "Duplicate a walk");
    expect(duplicate.getAttribute("title")).toBe("duplicate");
    await act(async () => duplicate.click());
    await settle();
    expect(onEdit).not.toHaveBeenCalled();
    expect(
      [...view.querySelectorAll(".collage-card__title")].map(
        (title) => title.textContent,
      ),
    ).toEqual(["a walk copy", "a walk"]);
    expect(await listCollages()).toHaveLength(2);
  });

  it("asks before deleting, and keeps the collage when told to", async () => {
    await saveCollage(record());
    const { onEdit, view } = await mount();
    await act(async () => buttonNamed(view, "Delete a walk").click());
    expect(buttonNamed(view, "delete for good")).toBeTruthy();
    expect(view.querySelector('[aria-label="Duplicate a walk"]')).toBeNull();

    await act(async () => buttonNamed(view, "keep").click());
    expect(view.querySelector('[aria-label="Delete a walk"]')).not.toBeNull();

    await act(async () => buttonNamed(view, "Delete a walk").click());
    await act(async () => buttonNamed(view, "delete for good").click());
    await settle();
    expect(onEdit).not.toHaveBeenCalled();
    expect(view.querySelectorAll(".collage-card")).toHaveLength(0);
    expect(await listCollages()).toHaveLength(0);
  });

  it("shows a quiet face for a collage that has not been drawn", async () => {
    await saveCollage(record());
    const { view } = await mount();
    expect(
      view.querySelector(".collage-card__thumb--undrawn")?.textContent,
    ).toBe("no preview yet");
  });
});
