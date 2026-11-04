// ABOUTME: Tests the collage history cards: the card opens its collage, glyphs act without opening,
// ABOUTME: and a collage goes out to a file and comes back in from one. Real store on in-memory IndexedDB.

import React, { act } from "react";
import { File as NodeFile } from "node:buffer";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import { CollageHistory } from "../entrypoints/scraps/CollageHistory";
import { listCollages, saveCollage } from "../entrypoints/scraps/collageStore";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";
import { readCollageFile } from "../entrypoints/scraps/collageFile";

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

describe("the history heading", () => {
  it("names the drawer, sums it up and offers a new collage", async () => {
    await saveCollage(record());
    const { view } = await mount();
    expect(view.querySelector(".collage-history__heading")?.textContent).toBe(
      "scrap collages",
    );
    expect(view.querySelector(".collage-history__summary")?.textContent).toMatch(
      /^1 collage · 0 pieces from 0 pages · last one /,
    );
    expect(buttonNamed(view, "new collage")).toBeTruthy();
  });

  it("says nothing has been made yet in an empty drawer", async () => {
    const { view } = await mount();
    expect(view.querySelector(".collage-history__summary")?.textContent).toBe(
      "nothing made yet",
    );
    // Without a collage the scrap is bare kraft, with no picture in it.
    expect(view.querySelector(".collage-history__scrap img")).toBeNull();
  });
});

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

  it("saves to a file from the glyph between duplicate and delete, without opening", async () => {
    await saveCollage(record());
    const { onEdit, view } = await mount();
    const glyphs = [
      ...view.querySelectorAll(".collage-card__actions > button"),
    ].map((button) => button.getAttribute("title"));
    expect(glyphs).toEqual(["duplicate", "save file", "delete"]);
    const save = buttonNamed(view, "Save a walk as a file");
    expect(save.querySelector("svg")).not.toBeNull();

    // jsdom has no object URLs and cannot follow a download link, so the
    // test holds on to the blob and the link the page hands the browser.
    const blobs = new Map<string, Blob>();
    Object.defineProperty(URL, "createObjectURL", {
      value: (blob: Blob) => {
        const url = `blob:test/${blobs.size}`;
        blobs.set(url, blob);
        return url;
      },
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: () => {},
      configurable: true,
    });
    const followed: HTMLAnchorElement[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        followed.push(this);
      });
    try {
      await act(async () => save.click());
      await settle();
    } finally {
      click.mockRestore();
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }

    expect(onEdit).not.toHaveBeenCalled();
    expect(followed).toHaveLength(1);
    expect(followed[0].download).toBe("a walk.collage.json");
    const blob = blobs.get(followed[0].getAttribute("href") ?? "");
    if (!blob) throw new Error("the download link names no saved blob");
    // jsdom's Blob has no text(), so the saved file is read the older way.
    const savedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const saved = readCollageFile(savedText);
    expect(saved.id).toBe("collage_1");
    expect(saved.title).toBe("a walk");
  });
});

describe("the history heading", () => {
  it("imports a collage file as a new collage at the top of the list", async () => {
    await saveCollage(record({ id: "collage_home", title: "already here" }));
    const { view } = await mount();
    const importButton = buttonNamed(view, "import a collage file");
    expect(importButton.textContent?.trim()).toBe("import collage");
    expect(importButton.className).toBe("collage-history__import");
    // The quiet import comes after the main call to start a new collage.
    const headButtons = [
      ...view.querySelectorAll(".collage-history__start button"),
    ].map((button) => button.textContent?.trim());
    expect(headButtons).toEqual(["new collage", "import collage"]);

    const filePicker = view.querySelector<HTMLInputElement>(
      'input[type="file"][aria-label="collage file to open"]',
    );
    if (!filePicker) throw new Error("no collage file input");
    const carried = record({ id: "collage_away", title: "from elsewhere" });
    const text = JSON.stringify({
      format: "wwo-collage",
      version: 1,
      exportedAt: Date.UTC(2026, 2, 4),
      collage: carried,
    });
    Object.defineProperty(filePicker, "files", {
      // Node's File, because jsdom's has no text() for the page to read.
      value: [new NodeFile([text], "from elsewhere.collage.json")],
      configurable: true,
    });
    await act(async () => {
      filePicker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    expect(
      [...view.querySelectorAll(".collage-card__title")].map(
        (title) => title.textContent,
      ),
    ).toEqual(["from elsewhere", "already here"]);
    const stored = await listCollages();
    expect(stored).toHaveLength(2);
    expect(stored.some((row) => row.id === "collage_away")).toBe(false);
  });
});
