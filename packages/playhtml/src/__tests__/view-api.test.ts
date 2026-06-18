import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { playhtml, html, svg, repeat } from "../index";

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeAll(async () => {
  await playhtml.init({});
  await playhtml.ready;
  await tick();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("rail 2: register + view", () => {
  it("renders a view into the element and re-renders on data change", async () => {
    const el = document.createElement("div");
    el.id = "counter";
    document.body.appendChild(el);

    const handle = playhtml.register<{ count: number }>("counter", {
      defaultData: { count: 0 },
      view: ({ data, setData }) => html`
        <span class="count">${data.count}</span>
        <button @click=${() => setData((d) => { d.count += 1; })}>+</button>
      `,
    });
    await tick();

    expect(el.querySelector(".count")!.textContent).toBe("0");

    // Clicking the rendered button writes data and re-renders.
    el.querySelector("button")!.click();
    await tick();

    expect(el.querySelector(".count")!.textContent).toBe("1");
    expect(handle.getData()).toEqual({ count: 1 });
  });

  it("the handle reads and writes from outside the view", async () => {
    const el = document.createElement("div");
    el.id = "external";
    document.body.appendChild(el);

    const handle = playhtml.register<{ items: string[] }>("external", {
      defaultData: { items: [] },
      view: ({ data }) => html`<ul>
        ${repeat(data.items, (i) => i, (i) => html`<li>${i}</li>`)}
      </ul>`,
    });
    await tick();

    handle.setData((d) => { d.items.push("a"); });
    await tick();

    expect(el.querySelectorAll("li").length).toBe(1);
    expect(el.querySelector("li")!.textContent).toBe("a");
  });

  it("setLocalData re-renders the view (per-user UI state)", async () => {
    const el = document.createElement("div");
    el.id = "toggle-ui";
    document.body.appendChild(el);

    playhtml.register<{}, { open: boolean }>("toggle-ui", {
      defaultData: {},
      defaultLocalData: { open: false },
      view: ({ localData, setLocalData }) => html`
        <button @click=${() => setLocalData((d) => { d.open = !d.open; })}>x</button>
        ${localData.open ? html`<div class="panel">hi</div>` : null}
      `,
    });
    await tick();

    expect(el.querySelector(".panel")).toBeNull();
    el.querySelector("button")!.click();
    await tick();
    expect(el.querySelector(".panel")).not.toBeNull();
  });

  it("renders lit-html svg fragments (spinner case)", async () => {
    const el = document.createElement("div");
    el.id = "svg-view";
    document.body.appendChild(el);

    playhtml.register<{ slices: number[] }>("svg-view", {
      defaultData: { slices: [0, 1, 2] },
      view: ({ data }) => html`
        <svg viewBox="0 0 100 100">
          <g>
            ${data.slices.map(
              (i) => svg`<circle cx=${i * 10} cy="5" r="2" class="slice"></circle>`,
            )}
          </g>
        </svg>
      `,
    });
    await tick();

    expect(el.querySelector("svg")).not.toBeNull();
    expect(el.querySelectorAll("circle.slice").length).toBe(3);
  });

  it("requestUpdate re-renders without a data change (clock-driven views)", async () => {
    const el = document.createElement("div");
    el.id = "clock";
    document.body.appendChild(el);

    let frame = 0;
    const handle = playhtml.register("clock", {
      defaultData: {},
      view: () => html`<span class="frame">${frame}</span>`,
    });
    await tick();
    expect(el.querySelector(".frame")!.textContent).toBe("0");

    frame = 5;
    handle.requestUpdate();
    expect(el.querySelector(".frame")!.textContent).toBe("5");
  });

  it("rejects setData called during render (re-render loop guard)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.createElement("div");
    el.id = "loopy";
    document.body.appendChild(el);

    playhtml.register<{ count: number }>("loopy", {
      defaultData: { count: 0 },
      // Illegal: writing during render.
      view: ({ data, setData }) => {
        setData((d) => { d.count += 1; });
        return html`<span>${data.count}</span>`;
      },
    });
    await tick();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("setData() was called during a view render"),
    );
    // The illegal write was ignored, so data stayed at the default.
    expect(playhtml.getHandle("loopy").getData()).toEqual({ count: 0 });
    errorSpy.mockRestore();
  });
});

describe("rail 2: lifecycle & guards", () => {
  it("runs the onMount cleanup on unregister()", async () => {
    const el = document.createElement("div");
    el.id = "lifecycle";
    document.body.appendChild(el);

    const cleanup = vi.fn();
    const handle = playhtml.register("lifecycle", {
      defaultData: {},
      view: () => html`<span>hi</span>`,
      onMount: () => cleanup,
    });
    await tick();
    expect(cleanup).not.toHaveBeenCalled();

    handle.unregister();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("rejects setLocalData called during render (no infinite recursion)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.createElement("div");
    el.id = "local-loop";
    document.body.appendChild(el);

    playhtml.register<{}, { n: number }>("local-loop", {
      defaultData: {},
      defaultLocalData: { n: 0 },
      view: ({ localData, setLocalData }) => {
        // Illegal: writing localData during render would recurse forever.
        setLocalData((d) => { d.n += 1; });
        return html`<span>${localData.n}</span>`;
      },
    });
    await tick();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("setLocalData() was called during a view render"),
    );
    errorSpy.mockRestore();
  });

  it("requestUpdate is a no-op for non-view (updateElement) handlers", async () => {
    const el = document.createElement("div");
    el.id = "imperative";
    document.body.appendChild(el);

    const updateElement = vi.fn();
    const handle = playhtml.register("imperative", {
      defaultData: { x: 1 },
      updateElement,
    });
    await tick();
    const callsAfterMount = updateElement.mock.calls.length;

    handle.requestUpdate();
    // No view → requestUpdate should not re-run updateElement.
    expect(updateElement.mock.calls.length).toBe(callsAfterMount);
  });

  it("does not wire onClick when a view is present (React/props path)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.createElement("div");
    el.id = "view-plus-click";
    el.setAttribute("can-play", "");
    // Simulate how React / extraCapabilities stamp props on the element,
    // bypassing register()'s validateViewInitializer.
    const onClick = vi.fn();
    (el as any).defaultData = {};
    (el as any).view = () => html`<button>x</button>`;
    (el as any).onClick = onClick;
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");
    await tick();

    el.querySelector("button")!.click();
    expect(onClick).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("rail 2: validation", () => {
  it("throws when view and updateElement are both provided", () => {
    expect(() =>
      playhtml.register("bad-1", {
        defaultData: {},
        view: () => html``,
        updateElement: () => {},
      }),
    ).toThrow(/mutually exclusive/);
  });

  it("throws when view is combined with onClick", () => {
    expect(() =>
      playhtml.register("bad-2", {
        defaultData: {},
        view: () => html``,
        onClick: () => {},
      }),
    ).toThrow(/event handler/);
  });

  it("define throws when redefining a built-in capability", () => {
    expect(() =>
      playhtml.define("can-move", {
        defaultData: {},
        view: () => html``,
      }),
    ).toThrow(/built-in/);
  });
});

describe("rail 2: define + composition", () => {
  it("define binds every element carrying the attribute", async () => {
    const a = document.createElement("div");
    a.id = "note-a";
    a.setAttribute("can-note", "");
    const b = document.createElement("div");
    b.id = "note-b";
    b.setAttribute("can-note", "");
    document.body.append(a, b);

    playhtml.define<{ text: string }>("can-note", {
      defaultData: (el) => ({ text: el.id }),
      view: ({ data }) => html`<span class="t">${data.text}</span>`,
    });
    await tick();

    expect(a.querySelector(".t")!.textContent).toBe("note-a");
    expect(b.querySelector(".t")!.textContent).toBe("note-b");
    // getHandle resolves a define-based element's handler too.
    expect(playhtml.getHandle("note-a").getData()).toEqual({ text: "note-a" });
  });

  it("a view that renders capability mount points binds them", async () => {
    playhtml.define<{ label: string }>("can-chip", {
      defaultData: { label: "chip" },
      view: ({ data }) => html`<span class="chip">${data.label}</span>`,
    });

    const root = document.createElement("div");
    root.id = "chip-list";
    document.body.appendChild(root);

    playhtml.register<{ ids: string[] }>("chip-list", {
      defaultData: { ids: ["chip-1", "chip-2"] },
      view: ({ data }) => html`${repeat(
        data.ids,
        (id) => id,
        (id) => html`<div id=${id} can-chip></div>`,
      )}`,
    });
    await tick();
    await tick();

    expect(document.getElementById("chip-1")).not.toBeNull();
    const chipHandlers = playhtml.elementHandlers.get("can-chip")!;
    expect(chipHandlers.has("chip-1")).toBe(true);
    expect(chipHandlers.has("chip-2")).toBe(true);
    expect(
      document.getElementById("chip-1")!.querySelector(".chip")!.textContent,
    ).toBe("chip");
  });
});
