// ABOUTME: Behavioral test suite for the can-mirror capability, modeling two
// ABOUTME: clients sharing DOM state (observe -> shared state -> apply on peer).

import { describe, it, expect, beforeEach } from "vitest";
import * as Y from "yjs";
import { syncedStore, getYjsDoc } from "@syncedstore/core";
import {
  canMirrorInitializer,
  type ElementState,
} from "../../../common/src/canMirror";

// Most tests model two clients sharing one plain state object: a source
// observes its DOM into shared state, the state crosses the wire, and a sink
// applies it. This exercises the full observe -> serialize -> apply path with a
// real MutationObserver and real DOM. The plain object is faster and keeps the
// broad behavioral coverage readable.
//
// The "CRDT-backed" section at the bottom instead runs each client over a real
// @syncedstore/core store + Y.Doc, with writes going through
// doc.transact(() => mutator(proxy)) exactly as the runtime does, and updates
// merged between docs with Y.applyUpdate. That section exercises the actual
// CRDT proxy semantics canMirror writes against (only push/splice sync) and
// true concurrent-edit convergence, which a plain object can't model.

// MutationObserver callbacks are async (microtask). Flush them.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// Deep clone, the way state crosses the wire between clients (it is serialized,
// never shared by reference).
const wire = (state: ElementState): ElementState =>
  JSON.parse(JSON.stringify(state));

// A single client: an element with can-mirror mounted. It observes its own DOM
// (writing to `state`) and can apply incoming remote state to its DOM.
interface Client {
  element: HTMLElement;
  state: ElementState;
  applyRemote: (incoming: ElementState) => void;
  setAwareness: (awareness: { hover: boolean; focus: boolean }[]) => void;
}

function mountClient(element: HTMLElement): Client {
  document.body.appendChild(element);
  const client: Client = {
    element,
    state: canMirrorInitializer.defaultData!(element) as ElementState,
    applyRemote(incoming) {
      canMirrorInitializer.updateElement!({
        element,
        data: incoming,
      } as any);
    },
    setAwareness(awareness) {
      canMirrorInitializer.updateElementAwareness!({
        element,
        awareness,
      } as any);
    },
  };
  canMirrorInitializer.onMount!({
    getElement: () => element,
    setData: (updater: any) => {
      if (typeof updater === "function") updater(client.state);
      else client.state = updater;
    },
    setMyAwareness: () => {},
  } as any);
  return client;
}

// Build a fresh element from an HTML string for a peer to receive state onto.
function elementFromHTML(html: string): HTMLElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
}

// Source observes its mutations into shared state; sink applies that state.
// Returns the cloned state that crossed the wire.
async function sync(source: Client, sink: Client): Promise<ElementState> {
  await flush();
  const onWire = wire(source.state);
  sink.applyRemote(onWire);
  return onWire;
}

// Compare two DOM trees by serialized HTML, the user-visible source of truth.
function expectMirrored(a: HTMLElement, b: HTMLElement) {
  expect(b.outerHTML).toBe(a.outerHTML);
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("can-mirror: attributes", () => {
  it("mirrors an added attribute", async () => {
    const source = mountClient(elementFromHTML(`<div id="a"></div>`));
    const sink = mountClient(elementFromHTML(`<div id="a"></div>`));

    source.element.setAttribute("data-state", "active");
    await sync(source, sink);

    expect(sink.element.getAttribute("data-state")).toBe("active");
    expectMirrored(source.element, sink.element);
  });

  it("mirrors a changed attribute value", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="a" class="off"></div>`)
    );
    const sink = mountClient(elementFromHTML(`<div id="a" class="off"></div>`));

    source.element.setAttribute("class", "on");
    await sync(source, sink);

    expect(sink.element.getAttribute("class")).toBe("on");
  });

  it("mirrors a removed attribute", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="a" data-temp="x"></div>`)
    );
    const sink = mountClient(
      elementFromHTML(`<div id="a" data-temp="x"></div>`)
    );

    source.element.removeAttribute("data-temp");
    await sync(source, sink);

    expect(sink.element.hasAttribute("data-temp")).toBe(false);
  });

  it("mirrors the native open attribute on <details>", async () => {
    const source = mountClient(
      elementFromHTML(`<details id="d"><summary>x</summary></details>`)
    );
    const sink = mountClient(
      elementFromHTML(`<details id="d"><summary>x</summary></details>`)
    );

    (source.element as HTMLDetailsElement).open = true;
    await sync(source, sink);

    expect((sink.element as HTMLDetailsElement).open).toBe(true);
  });

  it("does not persist ephemeral hover/focus attributes into shared state", async () => {
    const source = mountClient(elementFromHTML(`<div id="a"></div>`));

    source.element.setAttribute("data-playhtml-hover", "");
    source.element.setAttribute("data-playhtml-focus", "");
    await flush();

    const attrs = (source.state as any).attributes;
    expect(attrs["data-playhtml-hover"]).toBeUndefined();
    expect(attrs["data-playhtml-focus"]).toBeUndefined();
  });

  it("still persists a real attribute changed alongside an ephemeral one", async () => {
    const source = mountClient(elementFromHTML(`<div id="a"></div>`));
    const sink = mountClient(elementFromHTML(`<div id="a"></div>`));

    source.element.setAttribute("data-playhtml-hover", "");
    source.element.setAttribute("data-real", "1");
    await sync(source, sink);

    expect(sink.element.getAttribute("data-real")).toBe("1");
    expect(sink.element.hasAttribute("data-playhtml-hover")).toBe(false);
  });
});

describe("can-mirror: child add/remove", () => {
  it("mirrors an added child", async () => {
    const source = mountClient(elementFromHTML(`<ul id="l"></ul>`));
    const sink = mountClient(elementFromHTML(`<ul id="l"></ul>`));

    const li = document.createElement("li");
    li.textContent = "one";
    source.element.appendChild(li);
    await sync(source, sink);

    expectMirrored(source.element, sink.element);
    expect(sink.element.children.length).toBe(1);
  });

  it("mirrors a removed child", async () => {
    const source = mountClient(
      elementFromHTML(`<ul id="l"><li>a</li><li>b</li></ul>`)
    );
    const sink = mountClient(
      elementFromHTML(`<ul id="l"><li>a</li><li>b</li></ul>`)
    );

    source.element.removeChild(source.element.lastElementChild!);
    await sync(source, sink);

    expectMirrored(source.element, sink.element);
    expect(sink.element.children.length).toBe(1);
    expect(sink.element.textContent).toBe("a");
  });

  it("keeps count correct removing the last of identical children", async () => {
    const html = `<div id="g"><img src="cat.jpg"><img src="cat.jpg"><img src="cat.jpg"></div>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    source.element.removeChild(source.element.lastChild!);
    await sync(source, sink);

    expect(sink.element.children.length).toBe(2);
    expectMirrored(source.element, sink.element);
  });

  it("adds identical children without deduping them", async () => {
    const source = mountClient(elementFromHTML(`<div id="g"></div>`));
    const sink = mountClient(elementFromHTML(`<div id="g"></div>`));

    for (let i = 0; i < 4; i++) {
      const img = document.createElement("img");
      img.src = "cat.jpg";
      source.element.appendChild(img);
      await flush();
    }

    expect((source.state as any).children.length).toBe(4);
    await sync(source, sink);
    expect(sink.element.children.length).toBe(4);
  });

  it("clearing all children mirrors to an empty element", async () => {
    const html = `<ul id="l"><li>a</li><li>b</li></ul>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    source.element.innerHTML = "";
    await sync(source, sink);

    expect(sink.element.children.length).toBe(0);
    expectMirrored(source.element, sink.element);
  });

  it("mirrors a reordered child list", async () => {
    const html = `<ul id="l"><li>a</li><li>b</li><li>c</li></ul>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    // Move the first item to the end: a,b,c -> b,c,a
    source.element.appendChild(source.element.firstElementChild!);
    await sync(source, sink);

    expect(
      Array.from(sink.element.children).map((c) => c.textContent)
    ).toEqual(["b", "c", "a"]);
    expectMirrored(source.element, sink.element);
  });
});

describe("can-mirror: mixed text and element children", () => {
  it("preserves order removing a middle element among text nodes", async () => {
    const html = `<div id="m">intro <span>first</span> middle <span>second</span></div>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    const firstSpan = source.element.querySelector("span")!;
    source.element.removeChild(firstSpan);
    await sync(source, sink);

    expect(
      Array.from(sink.element.childNodes).map((n) => n.textContent)
    ).toEqual(["intro ", " middle ", "second"]);
    expectMirrored(source.element, sink.element);
  });

  it("replaces a node whose kind changes at a position", async () => {
    // Sink starts where DOM/state diverge by node kind at the same index,
    // forcing the apply path to replace rather than update in place.
    const source = mountClient(
      elementFromHTML(`<div id="m"><span>only</span></div>`)
    );
    const sink = mountClient(elementFromHTML(`<div id="m">plain text</div>`));

    // Source unchanged; apply its element-child state onto a text-child sink.
    await sync(source, sink);

    expect(sink.element.children.length).toBe(1);
    expect(sink.element.firstElementChild!.tagName).toBe("SPAN");
    expectMirrored(source.element, sink.element);
  });

  it("replaces an element whose tag changes at a position", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="m"><b>bold</b></div>`)
    );
    const sink = mountClient(elementFromHTML(`<div id="m"><i>italic</i></div>`));

    await sync(source, sink);

    expect(sink.element.firstElementChild!.tagName).toBe("B");
    expectMirrored(source.element, sink.element);
  });
});

describe("can-mirror: character data", () => {
  it("mirrors a text change that surfaces via an input event", async () => {
    // The observer runs with subtree: false, so a characterData mutation on a
    // child text node (target = the text node) is not observed directly. It
    // syncs when the element fires input (e.g. contenteditable), which
    // re-snapshots the whole subtree.
    const source = mountClient(
      elementFromHTML(`<p id="p" contenteditable="true">hello</p>`)
    );
    const sink = mountClient(
      elementFromHTML(`<p id="p" contenteditable="true">hello</p>`)
    );

    source.element.firstChild!.textContent = "goodbye";
    source.element.dispatchEvent(new Event("input", { bubbles: true }));
    await sync(source, sink);

    expect(sink.element.textContent).toBe("goodbye");
  });

  it("does NOT observe a direct text-child mutation without an input event", async () => {
    // Documents the subtree: false boundary. A bare text edit on a child node,
    // with no input event, is invisible to the observer.
    const source = mountClient(elementFromHTML(`<p id="p">hello</p>`));

    source.element.firstChild!.textContent = "goodbye";
    await flush();

    expect((source.state as any).children[0].textContent).toBe("hello");
  });
});

describe("can-mirror: form state", () => {
  it("mirrors a checkbox checked toggle", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="c"><input type="checkbox"></div>`)
    );
    const sink = mountClient(
      elementFromHTML(`<div id="c"><input type="checkbox"></div>`)
    );

    const box = source.element.querySelector("input")!;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await sync(source, sink);

    expect(sink.element.querySelector("input")!.checked).toBe(true);
  });

  it("mirrors a text input value", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="t"><input type="text"></div>`)
    );
    const sink = mountClient(
      elementFromHTML(`<div id="t"><input type="text"></div>`)
    );

    const input = source.element.querySelector("input")!;
    input.value = "typed";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sync(source, sink);

    expect(sink.element.querySelector("input")!.value).toBe("typed");
  });

  it("mirrors a textarea value", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="t"><textarea></textarea></div>`)
    );
    const sink = mountClient(
      elementFromHTML(`<div id="t"><textarea></textarea></div>`)
    );

    const ta = source.element.querySelector("textarea")!;
    ta.value = "multi\nline";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    await sync(source, sink);

    expect(sink.element.querySelector("textarea")!.value).toBe("multi\nline");
  });

  it("mirrors a select selectedIndex", async () => {
    const html = `<div id="s"><select><option>a</option><option>b</option><option>c</option></select></div>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    const select = source.element.querySelector("select")!;
    select.selectedIndex = 2;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await sync(source, sink);

    expect(sink.element.querySelector("select")!.selectedIndex).toBe(2);
  });

  it("mirrors a radio selection within a group", async () => {
    const html = `<div id="r"><input type="radio" name="g" value="x"><input type="radio" name="g" value="y"></div>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    const radios = source.element.querySelectorAll("input");
    radios[1].checked = true;
    radios[1].dispatchEvent(new Event("change", { bubbles: true }));
    await sync(source, sink);

    const sinkRadios = sink.element.querySelectorAll("input");
    expect(sinkRadios[0].checked).toBe(false);
    expect(sinkRadios[1].checked).toBe(true);
  });
});

describe("can-mirror: contenteditable", () => {
  it("mirrors text typed into a contenteditable div", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="e" contenteditable="true">start</div>`)
    );
    const sink = mountClient(
      elementFromHTML(`<div id="e" contenteditable="true">start</div>`)
    );

    source.element.firstChild!.textContent = "start edited";
    source.element.dispatchEvent(new Event("input", { bubbles: true }));
    await sync(source, sink);

    expect(sink.element.textContent).toBe("start edited");
  });

  it("mirrors a new list item added in a contenteditable list", async () => {
    const html = `<ul id="e" contenteditable="true"><li>one</li></ul>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    const li = document.createElement("li");
    li.textContent = "two";
    source.element.appendChild(li);
    // contenteditable mutations fire input, not just childList.
    source.element.dispatchEvent(new Event("input", { bubbles: true }));
    await sync(source, sink);

    expect(
      Array.from(sink.element.querySelectorAll("li")).map((l) => l.textContent)
    ).toEqual(["one", "two"]);
  });
});

describe("can-mirror: awareness (hover/focus)", () => {
  it("shows the hover attribute when any peer is hovering", () => {
    const client = mountClient(elementFromHTML(`<div id="a"></div>`));

    client.setAwareness([{ hover: true, focus: false }]);
    expect(client.element.hasAttribute("data-playhtml-hover")).toBe(true);

    client.setAwareness([{ hover: false, focus: false }]);
    expect(client.element.hasAttribute("data-playhtml-hover")).toBe(false);
  });

  it("shows the focus attribute when any peer is focused", () => {
    const client = mountClient(elementFromHTML(`<div id="a"></div>`));

    client.setAwareness([
      { hover: false, focus: false },
      { hover: false, focus: true },
    ]);
    expect(client.element.hasAttribute("data-playhtml-focus")).toBe(true);

    client.setAwareness([{ hover: false, focus: false }]);
    expect(client.element.hasAttribute("data-playhtml-focus")).toBe(false);
  });
});

describe("can-mirror: apply-side robustness", () => {
  it("is a no-op when incoming state already matches the DOM", async () => {
    const source = mountClient(
      elementFromHTML(`<div id="a" class="x">text</div>`)
    );
    const sink = mountClient(
      elementFromHTML(`<div id="a" class="x">text</div>`)
    );

    const before = sink.element.outerHTML;
    sink.applyRemote(wire(source.state));
    expect(sink.element.outerHTML).toBe(before);
  });

  it("removes an attribute the sink had but the incoming state lacks", async () => {
    const source = mountClient(elementFromHTML(`<div id="a"></div>`));
    const sink = mountClient(
      elementFromHTML(`<div id="a" data-stale="1"></div>`)
    );

    sink.applyRemote(wire(source.state));
    expect(sink.element.hasAttribute("data-stale")).toBe(false);
  });

  it("applies a deeply nested subtree", async () => {
    const html = `<div id="d"><section><h2>title</h2><p>body</p></section></div>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(`<div id="d"></div>`));

    sink.applyRemote(wire(source.state));
    expectMirrored(source.element, sink.element);
  });
});

describe("can-mirror: feedback-loop safety", () => {
  it("applying its own echoed state does not re-trigger the observer", async () => {
    const source = mountClient(elementFromHTML(`<ul id="l"></ul>`));

    const li = document.createElement("li");
    li.textContent = "one";
    source.element.appendChild(li);
    await flush();

    const stateAfterFirst = wire(source.state);

    // Echo our own write back through updateElement (as the runtime does).
    source.applyRemote(stateAfterFirst);
    await flush();

    // The observer must not have appended a duplicate or otherwise mutated
    // the shared state in response to its own applied update.
    expect((source.state as any).children.length).toBe(1);
    expect(source.element.children.length).toBe(1);
  });
});

describe("can-mirror: sequential operations stay convergent", () => {
  it("converges across a series of mixed edits", async () => {
    const html = `<div id="root" class="card"><h3>Title</h3><ul><li>a</li></ul></div>`;
    const source = mountClient(elementFromHTML(html));
    const sink = mountClient(elementFromHTML(html));

    // 1. attribute change
    source.element.setAttribute("data-open", "true");
    await sync(source, sink);

    // 2. add a child to the root
    const p = document.createElement("p");
    p.textContent = "note";
    source.element.appendChild(p);
    await sync(source, sink);

    // 3. change a nested child's text, then mutate the root. The root-level
    // mutation re-snapshots the whole subtree, carrying the nested edit along
    // even though subtree: false means the nested change wasn't observed alone.
    source.element.querySelector("h3")!.firstChild!.textContent = "New Title";
    source.element.setAttribute("data-rev", "2");
    await sync(source, sink);

    // 4. remove the root-level <ul>
    source.element.removeChild(source.element.querySelector("ul")!);
    await sync(source, sink);

    expect(sink.element.getAttribute("data-open")).toBe("true");
    expect(sink.element.getAttribute("data-rev")).toBe("2");
    expect(sink.element.querySelector("h3")!.textContent).toBe("New Title");
    expect(sink.element.querySelector("ul")).toBeNull();
    expect(sink.element.querySelector("p")!.textContent).toBe("note");
    expectMirrored(source.element, sink.element);
  });
});

// --- CRDT-backed harness ---
//
// Each client owns a real @syncedstore/core store and Y.Doc. canMirror writes
// through doc.transact(() => mutator(proxy)) — the production path — and we move
// state between clients with Y.applyUpdate, the real merge. This validates that
// canMirror's array writes (splice/push only) survive the CRDT and that
// concurrent edits converge.
//
// Critically, the two clients share doc history: one client seeds the data and
// the other inherits it via an initial sync BEFORE either edits. This mirrors
// the runtime, where one client creates an element's data and peers receive it
// before mutating. (Seeding both docs independently would create two distinct
// CRDT arrays at the same key, and a merge would union them instead of
// reconciling — a split-brain that never happens in production.)

type StoreShape = { play: Record<string, Record<string, unknown>> };
const TAG = "can-mirror";

interface CrdtClient {
  element: HTMLElement;
  doc: Y.Doc;
  proxy: () => any;
  applyState: () => void;
}

function makeClientDoc() {
  const store = syncedStore<StoreShape>({ play: {} });
  const doc = getYjsDoc(store);
  return { store, doc };
}

function mountObserver(
  element: HTMLElement,
  doc: Y.Doc,
  proxy: () => any
): CrdtClient {
  document.body.appendChild(element);
  canMirrorInitializer.onMount!({
    getElement: () => element,
    setData: (updater: any) => {
      // canMirror's observer only ever uses the mutator form.
      doc.transact(() => updater(proxy()));
    },
    setMyAwareness: () => {},
  } as any);
  return {
    element,
    doc,
    proxy,
    applyState() {
      canMirrorInitializer.updateElement!({
        element,
        data: wire(proxy()),
      } as any);
    },
  };
}

// A two-client "room" sharing doc history. Client A seeds the data; client B
// inherits A's doc state before mounting its own observer, so both edit the
// same underlying CRDT structures.
function makeRoom(id: string, elementA: HTMLElement, elementB: HTMLElement) {
  const a = makeClientDoc();
  a.store.play[TAG] = {};
  (a.store.play[TAG] as any)[id] = wire(
    canMirrorInitializer.defaultData!(elementA) as ElementState
  );
  const aProxy = () => (a.store.play[TAG] as any)[id];

  // B inherits A's history (including the play/TAG structure and seed data)
  // entirely from A's update, so both edit the same underlying CRDT arrays.
  const b = makeClientDoc();
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  const bProxy = () => (b.store.play[TAG] as any)[id];

  return {
    a: mountObserver(elementA, a.doc, aProxy),
    b: mountObserver(elementB, b.doc, bProxy),
  };
}

// Merge both docs (bidirectional), the steady state after a real sync.
function mergeDocs(a: CrdtClient, b: CrdtClient) {
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
}

describe("can-mirror: CRDT-backed two-client sync", () => {
  it("propagates a child removal through a real Yjs merge", async () => {
    const html = `<div id="g"><img src="cat.jpg"><img src="cat.jpg"><img src="cat.jpg"></div>`;
    const { a, b } = makeRoom("g", elementFromHTML(html), elementFromHTML(html));

    a.element.removeChild(a.element.lastChild!);
    await flush();

    mergeDocs(a, b);
    b.applyState();

    expect(b.element.children.length).toBe(2);
    expect(b.proxy().children.length).toBe(2);
  });

  it("survives many sequential child mutations without array corruption", async () => {
    const { a, b } = makeRoom(
      "g",
      elementFromHTML(`<ul id="g"></ul>`),
      elementFromHTML(`<ul id="g"></ul>`)
    );

    // Add five, remove the middle three one at a time, add two more.
    for (let i = 0; i < 5; i++) {
      const li = document.createElement("li");
      li.textContent = `item ${i}`;
      a.element.appendChild(li);
      await flush();
    }
    a.element.removeChild(a.element.children[1]);
    await flush();
    a.element.removeChild(a.element.children[1]);
    await flush();
    a.element.removeChild(a.element.children[1]);
    await flush();
    for (let i = 5; i < 7; i++) {
      const li = document.createElement("li");
      li.textContent = `item ${i}`;
      a.element.appendChild(li);
      await flush();
    }

    mergeDocs(a, b);
    b.applyState();

    const labels = (txt: HTMLElement) =>
      Array.from(txt.querySelectorAll("li")).map((l) => l.textContent);
    // a started 0..4, removed indices 1,2,3 (items 1,2,3), then added 5,6.
    expect(labels(a.element)).toEqual(["item 0", "item 4", "item 5", "item 6"]);
    expect(labels(b.element)).toEqual(labels(a.element));
    // The CRDT array length must match the DOM — no orphaned/duplicated ops.
    expect(a.proxy().children.length).toBe(4);
  });

  it("converges when two clients edit different attributes concurrently", async () => {
    const html = `<div id="d"></div>`;
    const { a, b } = makeRoom("d", elementFromHTML(html), elementFromHTML(html));

    // Concurrent, non-conflicting attribute writes on each client.
    a.element.setAttribute("data-from-a", "1");
    b.element.setAttribute("data-from-b", "2");
    await flush();

    mergeDocs(a, b);
    a.applyState();
    b.applyState();

    // Both attributes survive the merge on both clients. Compare attribute
    // sets, not outerHTML: concurrent writes can serialize attributes in
    // different orders per client, which is semantically identical in HTML.
    const attrMap = (el: HTMLElement) =>
      Object.fromEntries(
        Array.from(el.attributes).map((at) => [at.name, at.value])
      );
    for (const c of [a, b]) {
      expect(c.element.getAttribute("data-from-a")).toBe("1");
      expect(c.element.getAttribute("data-from-b")).toBe("2");
    }
    expect(attrMap(a.element)).toEqual(attrMap(b.element));
  });
});
