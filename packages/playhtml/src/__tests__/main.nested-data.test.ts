import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { playhtml } from "../main";

describe("playhtml SyncedStore CRDT behavior", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  beforeAll(async () => {
    // Initialize with SyncedStore as primary storage
    await playhtml.init({});
    await new Promise((r) => setTimeout(r, 0));
  });

  function setupSimpleElement(
    tag: string,
    id: string,
    attributes: Record<string, string> = {}
  ) {
    const el = document.createElement("div");
    el.id = id;
    el.setAttribute(tag, "");

    // Add any additional attributes
    Object.entries(attributes).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });

    document.body.appendChild(el);
    // @ts-ignore
    playhtml.setupPlayElementForTag(el, tag);
    return el;
  }

  async function waitForSync() {
    // Wait for sync layer observer to update handler.__data
    await new Promise((resolve) => queueMicrotask(resolve));
  }

  it("stores data in SyncedStore and supports both value and mutator forms", async () => {
    const el = setupSimpleElement("can-toggle", "el1");

    const handler = playhtml.elementHandlers!.get("can-toggle")!.get("el1")!;
    expect(handler.data).toEqual({ on: false });

    // Test value form - replaces entire object
    handler.setData({ on: true });
    await waitForSync();

    expect(handler.data).toEqual({ on: true });
    expect(playhtml.syncedStore["can-toggle"]["el1"]).toEqual({ on: true });

    // Test mutator form - modifies the CRDT proxy directly
    handler.setData((draft: any) => {
      draft.on = false;
    });
    await waitForSync();

    expect(handler.data).toEqual({ on: false });
    expect(playhtml.syncedStore["can-toggle"]["el1"]).toEqual({ on: false });
  });

  it("supports CRDT array operations with mutator form", async () => {
    const tag = "can-duplicate";
    const el = setupSimpleElement(tag, "e2", { "can-duplicate": "target" });
    const target = document.createElement("div");
    target.id = "target";
    document.body.appendChild(target);

    // Re-setup element now that attributes changed
    // @ts-ignore
    await playhtml.setupPlayElementForTag(el, tag);

    const handler = playhtml.elementHandlers!.get(tag)!.get("e2")!;
    expect(Array.isArray(handler.data)).toBe(true);

    // Test CRDT array push operations
    handler.setData((draft: any) => {
      draft.push("x");
    });
    await waitForSync();

    expect(handler.data).toEqual(["x"]);
    expect(playhtml.syncedStore[tag]["e2"]).toEqual(["x"]);

    handler.setData((draft: any) => {
      draft.push("y");
    });
    await waitForSync();

    expect(handler.data).toEqual(["x", "y"]);
    expect(playhtml.syncedStore[tag]["e2"]).toEqual(["x", "y"]);
  });

  it("supports CRDT array splice operations", async () => {
    const tag = "can-duplicate";
    const el = setupSimpleElement(tag, "e3", { "can-duplicate": "target3" });
    const target = document.createElement("div");
    target.id = "target3";
    document.body.appendChild(target);

    // @ts-ignore
    await playhtml.setupPlayElementForTag(el, tag);

    const handler = playhtml.elementHandlers!.get(tag)!.get("e3")!;

    // Start with some data
    handler.setData((draft: any) => {
      draft.push("a", "b", "c");
    });
    await waitForSync();

    expect(handler.data).toEqual(["a", "b", "c"]);

    // Test splice for removal/insertion
    handler.setData((draft: any) => {
      draft.splice(1, 1, "x"); // Remove "b", insert "x"
    });
    await waitForSync();

    expect(handler.data).toEqual(["a", "x", "c"]);
    expect(playhtml.syncedStore[tag]["e3"]).toEqual(["a", "x", "c"]);

    // Test splice for removal from beginning (like shift)
    handler.setData((draft: any) => {
      draft.splice(0, 1); // Remove first element
    });
    await waitForSync();

    expect(handler.data).toEqual(["x", "c"]);
  });

  it("handles concurrent-like operations through CRDT merging", async () => {
    const tag = "can-duplicate";
    const el = setupSimpleElement(tag, "e4", { "can-duplicate": "target4" });
    const target = document.createElement("div");
    target.id = "target4";
    document.body.appendChild(target);

    // @ts-ignore
    await playhtml.setupPlayElementForTag(el, tag);

    const handler = playhtml.elementHandlers!.get(tag)!.get("e4")!;

    // Simulate multiple rapid mutations - SyncedStore CRDT handles the merging
    handler.setData((draft: any) => {
      draft.push("first");
    });
    handler.setData((draft: any) => {
      draft.push("second");
    });
    handler.setData((draft: any) => {
      draft.push("third");
    });
    await waitForSync();

    expect(handler.data).toEqual(["first", "second", "third"]);
    expect(playhtml.syncedStore[tag]["e4"]).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("supports nested object mutations with CRDT semantics", async () => {
    const tag = "can-mirror";
    const el = setupSimpleElement(tag, "e5");

    const handler = playhtml.elementHandlers!.get(tag)!.get("e5")!;

    // Test nested object mutations - update existing attributes
    handler.setData((draft: any) => {
      draft.attributes.id = "new-id";
      draft.attributes["data-test"] = "test-value";
    });
    await waitForSync();

    expect(handler.data).toMatchObject({
      attributes: {
        id: "new-id",
        "data-test": "test-value",
      },
    });

    // Verify the data is properly stored in SyncedStore
    const storedData = playhtml.syncedStore[tag]["e5"];
    expect(storedData).toMatchObject({
      attributes: {
        id: "new-id",
        "data-test": "test-value",
      },
    });

    // Verify the original element ID was preserved and new attribute was added
    expect(handler.data.attributes.id).toBe("new-id");
    expect(handler.data.attributes["data-test"]).toBe("test-value");
    // Should still have the playhtml class
    expect(handler.data.attributes.class).toContain("__playhtml-element");
  });

  it("throws helpful errors for unsupported CRDT array operations", async () => {
    const tag = "can-duplicate";
    const el = setupSimpleElement(tag, "e6", { "can-duplicate": "target6" });
    const target = document.createElement("div");
    target.id = "target6";
    document.body.appendChild(target);

    // @ts-ignore
    await playhtml.setupPlayElementForTag(el, tag);

    const handler = playhtml.elementHandlers!.get(tag)!.get("e6")!;

    // Add some initial data
    handler.setData((draft: any) => {
      draft.push("a", "b", "c");
    });
    await waitForSync();

    // Test that unsupported operations throw errors
    expect(() => {
      handler.setData((draft: any) => {
        draft.shift(); // Not supported by SyncedStore CRDTs
      });
    }).toThrow();

    expect(() => {
      handler.setData((draft: any) => {
        draft.pop(); // Not supported by SyncedStore CRDTs
      });
    }).toThrow();

    expect(() => {
      handler.setData((draft: any) => {
        draft[0] = "new-value"; // Direct index assignment not supported
      });
    }).toThrow();
  });
});
