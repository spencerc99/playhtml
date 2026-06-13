import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { playhtml, html, repeat } from "../index";

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
