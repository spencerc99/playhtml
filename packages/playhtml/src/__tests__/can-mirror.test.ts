// ABOUTME: Reproduction tests for the can-mirror capability, focused on
// ABOUTME: child add/remove sync between an observing client and a receiving client.

import { describe, it, expect } from "vitest";
import {
  canMirrorInitializer,
  type ElementState,
} from "../../../common/src/canMirror";

// Drive the initializer's onMount with a minimal fake context that records the
// produced ElementState, the same way ElementHandler would persist it.
function mountObserver(element: HTMLElement) {
  let data: ElementState = canMirrorInitializer.defaultData!(element) as any;
  canMirrorInitializer.onMount!({
    getElement: () => element,
    setData: (updater: any) => {
      if (typeof updater === "function") {
        updater(data);
      } else {
        data = updater;
      }
    },
    setMyAwareness: () => {},
  } as any);
  return {
    getData: () => data,
  };
}

// Apply a captured ElementState to a receiving element via updateElement.
function applyState(element: HTMLElement, data: ElementState) {
  canMirrorInitializer.updateElement!({ element, data } as any);
}

// MutationObserver callbacks are async (microtask). Flush them.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("can-mirror child sync with identical children", () => {
  it("removing the last of several identical children removes only one", async () => {
    const source = document.createElement("div");
    source.id = "container";
    for (let i = 0; i < 3; i++) {
      const img = document.createElement("img");
      img.src = "./images/cat.jpg";
      source.appendChild(img);
    }
    document.body.appendChild(source);

    const { getData } = mountObserver(source);

    // Remove the last child, mirroring the bug report's removeCat handler.
    source.removeChild(source.lastChild!);
    await flush();

    const data = getData() as any;
    expect(data.children.length).toBe(2);

    // Now mirror that state onto a fresh receiving element that still has 3.
    const receiver = document.createElement("div");
    receiver.id = "container";
    for (let i = 0; i < 3; i++) {
      const img = document.createElement("img");
      img.src = "./images/cat.jpg";
      receiver.appendChild(img);
    }
    document.body.appendChild(receiver);

    applyState(receiver, data);
    expect(receiver.children.length).toBe(2);
  });

  it("removing the last child updates the same client's DOM correctly via updateElement", async () => {
    const el = document.createElement("div");
    el.id = "container";
    for (let i = 0; i < 3; i++) {
      const img = document.createElement("img");
      img.src = "./images/cat.jpg";
      el.appendChild(img);
    }
    document.body.appendChild(el);

    const { getData } = mountObserver(el);

    el.removeChild(el.lastChild!);
    await flush();

    // Simulate Yjs echoing the write back to the same client.
    applyState(el, getData());
    expect(el.children.length).toBe(2);
  });

  it("removing children one at a time stays consistent", async () => {
    const el = document.createElement("div");
    el.id = "container";
    for (let i = 0; i < 3; i++) {
      const img = document.createElement("img");
      img.src = "./images/cat.jpg";
      el.appendChild(img);
    }
    document.body.appendChild(el);

    const { getData } = mountObserver(el);

    el.removeChild(el.lastChild!);
    await flush();
    expect((getData() as any).children.length).toBe(2);

    el.removeChild(el.lastChild!);
    await flush();
    expect((getData() as any).children.length).toBe(1);
  });

  it("adds then removes the last child", async () => {
    const el = document.createElement("div");
    el.id = "container";
    document.body.appendChild(el);

    const { getData } = mountObserver(el);

    // add three identical children, one at a time
    for (let i = 0; i < 3; i++) {
      const img = document.createElement("img");
      img.src = "./images/cat.jpg";
      el.appendChild(img);
      await flush();
    }
    expect((getData() as any).children.length).toBe(3);

    el.removeChild(el.lastChild!);
    await flush();
    expect((getData() as any).children.length).toBe(2);
  });

  it("removing one identical child syncs to a remote client without dropping the rest", async () => {
    const el = document.createElement("div");
    el.id = "container";
    document.body.appendChild(el);

    const { getData } = mountObserver(el);

    for (let i = 0; i < 3; i++) {
      const img = document.createElement("img");
      img.src = "./images/cat.jpg";
      el.appendChild(img);
      await flush();
    }

    el.removeChild(el.lastChild!);
    await flush();

    // Apply the synced state back to the DOM, as a remote client would.
    applyState(el, getData());
    expect(el.children.length).toBe(2);
  });

  it("preserves order and count with mixed text and element children", async () => {
    const el = document.createElement("div");
    el.id = "container";
    el.appendChild(document.createTextNode("intro "));
    const a = document.createElement("span");
    a.textContent = "first";
    el.appendChild(a);
    el.appendChild(document.createTextNode(" middle "));
    const b = document.createElement("span");
    b.textContent = "second";
    el.appendChild(b);
    document.body.appendChild(el);

    const { getData } = mountObserver(el);

    // Remove the first element child; text nodes and the other element stay.
    el.removeChild(a);
    await flush();

    const data = getData() as any;
    expect(data.children.map((c: any) => c.textContent ?? c.tagName)).toEqual([
      "intro ",
      " middle ",
      "span",
    ]);

    // Mirror onto a fresh receiver built from the original markup.
    const receiver = document.createElement("div");
    receiver.appendChild(document.createTextNode("intro "));
    const ra = document.createElement("span");
    ra.textContent = "first";
    receiver.appendChild(ra);
    receiver.appendChild(document.createTextNode(" middle "));
    const rb = document.createElement("span");
    rb.textContent = "second";
    receiver.appendChild(rb);
    document.body.appendChild(receiver);

    applyState(receiver, data);
    expect(Array.from(receiver.childNodes).map((n) => n.textContent)).toEqual([
      "intro ",
      " middle ",
      "second",
    ]);
  });
});
