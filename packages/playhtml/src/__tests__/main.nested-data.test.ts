import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { playhtml } from "../main";
import * as Y from "yjs";

describe("playhtml nested data behavior (pre-SyncedStore)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  beforeAll(async () => {
    // Pre-create maps for tags we use to avoid triggering 'add' observer path
    if (!playhtml.globalData!.get("can-toggle")) {
      playhtml.globalData!.set("can-toggle", new Y.Map());
    }
    if (!playhtml.globalData!.get("can-duplicate")) {
      playhtml.globalData!.set("can-duplicate", new Y.Map());
    }
    if (!playhtml.globalData!.get("can-mirror")) {
      playhtml.globalData!.set("can-mirror", new Y.Map());
    }
    await playhtml.init({});
    await new Promise((r) => setTimeout(r, 0));
  });

  function setupSimpleElement(tag: string, id: string) {
    const el = document.createElement("div");
    el.id = id;
    el.setAttribute(tag, "");
    document.body.appendChild(el);
    // Tag-specific setup to avoid selector hashing complexity
    // @ts-ignore
    playhtml.setupPlayElementForTag(el, tag);
    return el;
  }

  it("stores plain objects and replaces entire value on setData", async () => {
    const el = setupSimpleElement("can-toggle", "el1");

    // Toggle handler uses setData({ on: !on })
    // We simulate by calling the element handler's setData
    const handler = playhtml.elementHandlers!.get("can-toggle")!.get("el1")!;
    expect(handler.data).toEqual({ on: false });
    handler.setData({ on: true });
    // Our onChange updates Y.Map, which triggers observe(update) and sets __data; so the data should now be updated
    expect(handler.data).toEqual({ on: true });
  });

  it("does not support merging nested arrays (current behavior)", async () => {
    const tag = "can-duplicate";
    const el = setupSimpleElement(tag, "e2");
    el.setAttribute("can-duplicate", "target");
    const target = document.createElement("div");
    target.id = "target";
    document.body.appendChild(target);
    // must re-setup element now that attributes changed
    // @ts-ignore
    await playhtml.setupPlayElementForTag(el, tag);

    const handler = playhtml.elementHandlers!.get(tag)!.get("e2")!;
    expect(Array.isArray(handler.data)).toBe(true);

    // Two concurrent appends simulated by two setData calls
    const a1 = ["x"];
    const a2 = ["y"];
    handler.setData(a1 as any);
    handler.setData(a2 as any);

    // With plain replace semantics, last-write-wins would be expected at CRDT level; our local handler doesn't merge
    // Current behavior replaces rather than merging; after two sets, last write wins locally
    // Since both setData calls run synchronously and Y observers apply, final state equals the second array
    expect(handler.data).toEqual(["y"]);
  });

  it("concurrent array appends should merge (post-migration)", async () => {
    const tag = "can-duplicate";
    const el = setupSimpleElement(tag, "e4");
    el.setAttribute("can-duplicate", "target2");
    const target = document.createElement("div");
    target.id = "target2";
    document.body.appendChild(target);
    // @ts-ignore
    await playhtml.setupPlayElementForTag(el, tag);

    const handler = playhtml.elementHandlers!.get(tag)!.get("e4")!;
    expect(Array.isArray(handler.data)).toBe(true);

    // Simulate two independent appends that would be concurrent in a real multi-client scenario
    // Current behavior is last-write-wins replacement; post-migration we expect merge semantics
    const append1 = ["a"];
    const append2 = ["b"];
    handler.setData(append1 as any);
    handler.setData(append2 as any);

    // Expected post-migration behavior (SyncedStore/Yjs-backed nested arrays): merged appends
    // We expect both entries to be present without losing either append
    expect(handler.data).toEqual(["a", "b"]);
  });

  it("deep nested objects are replaced as a whole (current behavior)", async () => {
    const tag = "can-mirror"; // uses object state
    const el = setupSimpleElement(tag, "e3");

    const handler = playhtml.elementHandlers!.get(tag)!.get("e3")!;
    const orig = handler.data;
    handler.setData({
      ...(orig as any),
      attributes: { ...((orig as any).attributes || {}), id: "new" },
    } as any);
    // With current semantics, handler.data updates to the new object
    expect(handler.data).not.toBe(orig);
  });
});
