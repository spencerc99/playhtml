import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { playhtml } from "../index";

beforeAll(async () => {
  // Initialize playhtml with SyncedStore as primary storage
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

describe("playhtml basic setup with SyncedStore", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("initializes and sets up elements by attribute", async () => {
    const el = document.createElement("div");
    el.id = "foo";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml.elementHandlers!.get("can-toggle")!.get("foo");
    expect(handler).toBeTruthy();
    expect(handler!.data).toEqual({ on: false });

    // Verify element has the generic playhtml class for easy selection
    expect(el.classList.contains("__playhtml-element")).toBe(true);
    // Verify element has the attribute for CSS targeting
    expect(el.hasAttribute("can-toggle")).toBe(true);

    // Verify data is stored in SyncedStore
    expect(playhtml.syncedStore["can-toggle"]).toBeDefined();
    expect(playhtml.syncedStore["can-toggle"]["foo"]).toEqual({ on: false });
  });

  it("handles awareness changes per element (no updateElementAwareness)", async () => {
    const el = document.createElement("div");
    el.id = "bar";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml.elementHandlers!.get("can-toggle")!.get("bar")!;
    // Trigger local awareness update; for can-toggle, updateElementAwareness is undefined, but this should not throw
    expect(() => handler.setMyAwareness({ active: true } as any)).not.toThrow();

    // Verify element can be found using the generic class
    const playhtmlElements = document.querySelectorAll(".__playhtml-element");
    expect(playhtmlElements.length).toBe(1);
    expect(playhtmlElements[0]).toBe(el);
  });

  it("supports both mutator and value forms for setData", async () => {
    const el = document.createElement("div");
    el.id = "toggle-test";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml
      .elementHandlers!.get("can-toggle")!
      .get("toggle-test")!;

    // Test value form
    handler.setData({ on: true });
    // Wait for sync layer to update handler.data
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(handler.data).toEqual({ on: true });
    expect(playhtml.syncedStore["can-toggle"]["toggle-test"]).toEqual({
      on: true,
    });

    // Test mutator form
    handler.setData((draft: any) => {
      draft.on = false;
    });
    // Wait for sync layer to update handler.data
    await new Promise((resolve) => queueMicrotask(resolve));

    expect(handler.data).toEqual({ on: false });
    expect(playhtml.syncedStore["can-toggle"]["toggle-test"]).toEqual({
      on: false,
    });
  });

  it("removeElementData cleans up all data and handlers", async () => {
    const el = document.createElement("div");
    el.id = "cleanup-test";
    el.setAttribute("can-move", "");
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-move");

    // Verify element is set up
    const handler = playhtml.elementHandlers!.get("can-move")!.get("cleanup-test");
    expect(handler).toBeTruthy();
    expect(playhtml.syncedStore["can-move"]["cleanup-test"]).toEqual({
      x: 0,
      y: 0,
    });

    // Move the element to create some data
    handler!.setData({ x: 100, y: 200 });
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(playhtml.syncedStore["can-move"]["cleanup-test"]).toEqual({
      x: 100,
      y: 200,
    });

    // Remove the element data
    playhtml.removeElementData("can-move", "cleanup-test");

    // Verify handler is removed
    expect(playhtml.elementHandlers!.get("can-move")!.has("cleanup-test")).toBe(
      false
    );

    // Verify data is removed from SyncedStore
    expect(playhtml.syncedStore["can-move"]["cleanup-test"]).toBeUndefined();
  });
});
