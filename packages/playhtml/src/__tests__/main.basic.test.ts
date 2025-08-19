import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { playhtml } from "../main";
import * as Y from "yjs";
beforeAll(async () => {
  // Pre-populate tags before init to avoid triggering globalData 'add' observer during tests
  if (!playhtml.globalData!.get("can-toggle")) {
    playhtml.globalData!.set("can-toggle", new Y.Map());
  }
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

describe("playhtml basic setup", () => {
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
    // Ensure CSS classes are added
    expect(el.classList.contains("__playhtml-element")).toBe(true);
    expect(el.classList.contains("__playhtml-can-toggle")).toBe(true);
  });

  it("handles awareness changes per element (no updateElementAwareness)", async () => {
    const el = document.createElement("div");
    el.id = "bar";
    el.setAttribute("can-toggle", "");
    document.body.appendChild(el);
    if (!playhtml.globalData!.get("can-toggle")) {
      playhtml.globalData!.set("can-toggle", new Y.Map());
    }
    await playhtml.setupPlayElementForTag(el, "can-toggle");

    const handler = playhtml.elementHandlers!.get("can-toggle")!.get("bar")!;
    // Trigger local awareness update; for can-toggle, updateElementAwareness is undefined, but this should not throw
    expect(() => handler.setMyAwareness({ active: true } as any)).not.toThrow();
  });
});
