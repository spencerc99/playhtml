// ABOUTME: Verifies elements with no id get one stable hashed id shared by all their capabilities.
// ABOUTME: Data saved under the ids such elements used to get is carried over to that id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

// Capture the store playhtml creates so tests can save records the way an
// earlier visit would have left them.
const playhtmlStores: any[] = [];
vi.mock("@syncedstore/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@syncedstore/core")>();
  return {
    ...actual,
    syncedStore: (...args: Parameters<typeof actual.syncedStore>) => {
      const created = actual.syncedStore(...args);
      playhtmlStores.push(created);
      return created;
    },
  };
});

const { playhtml, resetPlayHTML, elementHandlers } = await import("../index");
const { getYjsDoc } = await import("@syncedstore/core");
const { hashHtml } = await import("../utils");

// How a built-in capability element reads while the page is loading, and once
// it is ready. These strings pin the ids already saved in existing rooms.
const LOADING_ATTRS = `class="playhtml-loading" aria-busy="true" aria-live="polite"`;
const loadingHtml = (attrs: string, text: string) =>
  `<div ${attrs} ${LOADING_ATTRS}>${text}</div>`;
const readyHtml = (attrs: string, text: string) =>
  `<div ${attrs}>${text}</div>`;

function saveRecord(tag: string, id: string, data: Record<string, unknown>) {
  const doc = getYjsDoc(playhtmlStores[playhtmlStores.length - 1]);
  doc.transact(() => {
    const play = doc.getMap("play");
    if (!play.has(tag)) play.set(tag, new Y.Map());
    const record = new Y.Map();
    for (const [key, value] of Object.entries(data)) record.set(key, value);
    (play.get(tag) as Y.Map<unknown>).set(id, record);
  });
}

function savedIds(tag: string): string[] {
  const tagRecords = (playhtml.syncedStore as any)[tag];
  return tagRecords ? Object.keys(tagRecords) : [];
}

function addElement(attrs: string[], text: string): HTMLElement {
  const element = document.createElement("div");
  for (const attr of attrs) element.setAttribute(attr, "");
  element.textContent = text;
  document.body.append(element);
  return element;
}

async function setUp(element: HTMLElement, tags: string[]): Promise<void> {
  await Promise.all(
    tags.map((tag) => playhtml.setupPlayElementForTag(element, tag)),
  );
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

// Saved records outlive resetPlayHTML, so each test uses its own markup.
describe("hashed element ids", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("keeps the id an element on the page at load already had", async () => {
    document.body.innerHTML = `<div can-toggle="">lamp 1</div>`;
    const element = document.body.firstElementChild as HTMLElement;
    await playhtml.init({});
    await settle();

    expect(element.id).toBe(
      await hashHtml("can-toggle", loadingHtml(`can-toggle=""`, "lamp 1")),
    );
  });

  it("gives an element added after load the same id as one present at load", async () => {
    document.body.innerHTML = `<div can-toggle="">lamp 2</div>`;
    const presentAtLoad = document.body.firstElementChild as HTMLElement;
    await playhtml.init({});
    await settle();
    const idAtLoad = presentAtLoad.id;
    playhtml.removePlayElement(presentAtLoad);
    presentAtLoad.remove();

    const addedLater = addElement(["can-toggle"], "lamp 2");
    await setUp(addedLater, ["can-toggle"]);

    expect(addedLater.id).toBe(idAtLoad);
  });

  it("stores every capability of one element under the same id", async () => {
    document.body.innerHTML = `<div can-toggle="" can-move="">both 3</div>`;
    const element = document.body.firstElementChild as HTMLElement;
    const before = {
      move: savedIds("can-move"),
      toggle: savedIds("can-toggle"),
    };
    const added = (tag: string, earlier: string[]) =>
      savedIds(tag).filter((id) => !earlier.includes(id));
    await playhtml.init({});
    await settle();

    expect(added("can-move", before.move)).toEqual([element.id]);
    expect(added("can-toggle", before.toggle)).toEqual([element.id]);
    expect(elementHandlers.get("can-move")?.has(element.id)).toBe(true);
    expect(elementHandlers.get("can-toggle")?.has(element.id)).toBe(true);

    // Setting the element up again reuses the same records.
    playhtml.setupPlayElement(element);
    await settle();
    expect(added("can-move", before.move)).toEqual([element.id]);
    expect(added("can-toggle", before.toggle)).toEqual([element.id]);
  });

  it("carries over data an added-later element saved under its earlier id", async () => {
    await playhtml.init({});
    await settle();
    const earlierId = await hashHtml(
      "can-toggle",
      readyHtml(`can-toggle=""`, "lamp 4"),
    );
    saveRecord("can-toggle", earlierId, { on: true });

    const element = addElement(["can-toggle"], "lamp 4");
    await setUp(element, ["can-toggle"]);

    expect(element.id).not.toBe(earlierId);
    expect((playhtml.syncedStore as any)["can-toggle"][element.id]).toEqual({
      on: true,
    });
    // The earlier record stays for visitors still on an older version.
    expect(savedIds("can-toggle")).toContain(earlierId);
  });

  it("carries over each capability's data to the shared id", async () => {
    await playhtml.init({});
    await settle();
    const attrs = `can-toggle="" can-move=""`;
    // After a normal page load each capability saved under its own hash.
    const toggleId = await hashHtml("can-toggle", loadingHtml(attrs, "both 5"));
    const moveId = await hashHtml("can-move", loadingHtml(attrs, "both 5"));
    saveRecord("can-toggle", toggleId, { on: true });
    saveRecord("can-move", moveId, { x: 40, y: 12 });

    const element = addElement(["can-toggle", "can-move"], "both 5");
    await setUp(element, ["can-toggle", "can-move"]);

    const store = playhtml.syncedStore as any;
    expect(store["can-toggle"][element.id]).toEqual({ on: true });
    expect(store["can-move"][element.id]).toEqual({ x: 40, y: 12 });
  });

  it("prefers a capability's own earlier record over one saved under another capability's hash", async () => {
    await playhtml.init({});
    await settle();
    const attrs = `can-toggle="" can-move=""`;
    const ownId = await hashHtml("can-toggle", loadingHtml(attrs, "both 6"));
    const otherId = await hashHtml("can-move", readyHtml(attrs, "both 6"));
    saveRecord("can-toggle", ownId, { on: true });
    saveRecord("can-toggle", otherId, { on: false });

    const element = addElement(["can-toggle", "can-move"], "both 6");
    await setUp(element, ["can-toggle", "can-move"]);

    expect((playhtml.syncedStore as any)["can-toggle"][element.id]).toEqual({
      on: true,
    });
  });

  it("leaves a record that already exists under the current id alone", async () => {
    await playhtml.init({});
    await settle();
    const currentId = await hashHtml(
      "can-toggle",
      loadingHtml(`can-toggle=""`, "lamp 7"),
    );
    const earlierId = await hashHtml(
      "can-toggle",
      readyHtml(`can-toggle=""`, "lamp 7"),
    );
    saveRecord("can-toggle", currentId, { on: false });
    saveRecord("can-toggle", earlierId, { on: true });

    const element = addElement(["can-toggle"], "lamp 7");
    await setUp(element, ["can-toggle"]);

    expect(element.id).toBe(currentId);
    expect((playhtml.syncedStore as any)["can-toggle"][currentId]).toEqual({
      on: false,
    });
  });
});
