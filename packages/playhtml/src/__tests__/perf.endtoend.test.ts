import { describe, it, expect, vi, afterAll } from "vitest";

type DataMode = "plain" | "syncedstore";

type PerfRecord = {
  scenario: "baseline" | "complex";
  mode: DataMode;
  elements: number;
  updates: number;
  initMs: number;
  updateMs: number;
};

const PERF_RESULTS: PerfRecord[] = [];

function makeElements(count: number, idPrefix: string) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.id = `${idPrefix}${i}`;
    el.setAttribute("can-play", "");
    // @ts-ignore
    el.defaultData = { list: [], meta: { i } };
    // @ts-ignore minimal DOM work in update
    el.updateElement = () => {};
    document.body.appendChild(el);
  }
}

function makeComplexElements(count: number, idPrefix: string) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.id = `${idPrefix}${i}`;
    el.setAttribute("can-play", "");
    // deeply nested data with arrays and maps-like objects
    // @ts-ignore
    el.defaultData = {
      profile: { name: `user-${i}`, flags: { a: true, b: false } },
      lists: {
        todos: [] as Array<{ id: number; title: string; done: boolean }>,
      },
      counters: { clicks: 0, hovers: 0 },
      nested: { a: { b: { c: { values: [i] } } } },
    };
    // @ts-ignore
    el.updateElement = () => {};
    document.body.appendChild(el);
  }
}

async function freshPlayhtml() {
  // Ensure a clean module instance and clear global window guard
  vi.resetModules();
  // @ts-ignore
  delete (globalThis as any).playhtml;
  const mod = await import("../main");
  return mod.playhtml;
}

async function runPerfCase(
  mode: DataMode,
  {
    count,
    updates,
    complex = false,
  }: { count: number; updates: number; complex?: boolean }
) {
  // reset DOM
  document.body.innerHTML = "";
  const idPrefix = `${mode}_${complex ? "complex_" : ""}`;
  if (complex) makeComplexElements(count, idPrefix);
  else makeElements(count, idPrefix);

  const play = await freshPlayhtml();
  const t0 = performance.now();
  await play.init({ dataMode: mode });
  const t1 = performance.now();

  const handlers = Array.from(
    play.elementHandlers!.get("can-play")?.values() ?? []
  );
  expect(handlers.length).toBe(count);

  const u0 = performance.now();
  for (let k = 0; k < updates; k++) {
    const h = handlers[k % handlers.length];
    if (mode === "plain") {
      const data = (h.data as any) || {};
      if (complex) {
        const todos = data.lists?.todos ?? [];
        h.setData({
          ...data,
          counters: {
            ...data.counters,
            clicks: (data.counters?.clicks ?? 0) + 1,
          },
          lists: {
            ...data.lists,
            todos: [...todos, { id: k, title: `t-${k}`, done: k % 3 === 0 }],
          },
          nested: {
            ...data.nested,
            a: { ...(data.nested?.a ?? {}), b: { c: { values: [k] } } },
          },
        });
      } else {
        const list = (h.data as any)?.list ?? [];
        h.setData({ list: [...list, k], meta: { i: k } });
      }
    } else {
      // syncedstore supports mutator form
      h.setData((d: any) => {
        if (complex) {
          d.counters ??= { clicks: 0, hovers: 0 };
          d.counters.clicks += 1;
          d.lists ??= { todos: [] };
          if (!Array.isArray(d.lists.todos)) d.lists.todos = [];
          d.lists.todos.push({ id: k, title: `t-${k}`, done: k % 3 === 0 });
          d.nested ??= { a: { b: { c: { values: [] } } } };
          const arr = (((d.nested.a || {}).b || {}).c || {}).values ?? [];
          if (!Array.isArray(arr)) {
            (d.nested.a.b.c as any).values = [];
          }
          d.nested.a.b.c.values.push(k);
        } else {
          if (!Array.isArray(d.list)) d.list = [];
          d.list.push(k);
        }
      });
    }
  }
  const u1 = performance.now();

  const initMs = t1 - t0;
  const updateMs = u1 - u0;

  // Guardrails to catch pathological regressions in CI while still allowing growth
  expect(initMs).toBeLessThan(6000);
  expect(updateMs).toBeLessThan(6000);

  // Structured perf line for easier diffing across modes
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({
      suite: "playhtml-perf",
      scenario: complex ? "complex" : "baseline",
      mode,
      elements: count,
      updates,
      initMs: Number(initMs.toFixed(2)),
      updateMs: Number(updateMs.toFixed(2)),
    })
  );

  // Save for summary view
  PERF_RESULTS.push({
    scenario: complex ? "complex" : "baseline",
    mode,
    elements: count,
    updates,
    initMs: Number(initMs.toFixed(2)),
    updateMs: Number(updateMs.toFixed(2)),
  });
}

describe("end-to-end performance (plain vs syncedstore)", () => {
  it("baseline small", async () => {
    await runPerfCase("plain", { count: 150, updates: 800 });
    await runPerfCase("syncedstore", { count: 150, updates: 800 });
  });

  it("complex nested data", async () => {
    await runPerfCase("plain", { count: 100, updates: 600, complex: true });
    await runPerfCase("syncedstore", {
      count: 100,
      updates: 600,
      complex: true,
    });
  });

  it("scale-up elements", async () => {
    await runPerfCase("plain", { count: 400, updates: 1000 });
    await runPerfCase("syncedstore", { count: 400, updates: 1000 });
  });
});

// Simulate nested conflicts patterns by toggling and overwriting within the same tick
describe("nested conflict-y updates", () => {
  it("toggle and overwrite same keys rapidly", async () => {
    document.body.innerHTML = "";
    const el = document.createElement("div");
    el.id = "conflict_1";
    el.setAttribute("can-play", "");
    // @ts-ignore
    el.defaultData = { obj: { on: false, count: 0 }, list: [] };
    // @ts-ignore
    el.updateElement = () => {};
    document.body.appendChild(el);

    const play = await freshPlayhtml();
    await play.init({ dataMode: "syncedstore" });
    const h = Array.from(play.elementHandlers!.get("can-play")!.values())[0]!;

    for (let i = 0; i < 200; i++) {
      h.setData((d: any) => {
        d.obj.on = !d.obj.on;
        d.obj.count += 1;
        if (!Array.isArray(d.list)) d.list = [];
        d.list.unshift(i);
      });
      h.setData((d: any) => {
        d.obj = { on: i % 2 === 0, count: d.obj.count };
      });
    }

    // basic sanity
    expect((h.data as any).obj).toBeTruthy();
  });
});

afterAll(() => {
  // Group by scenario+size
  type GroupKey = string;
  const groups = new Map<GroupKey, PerfRecord[]>();
  for (const r of PERF_RESULTS) {
    const key = `${r.scenario}|${r.elements}|${r.updates}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("==== playhtml perf summary ====");
  lines.push(
    [
      "scenario",
      "elems",
      "updates",
      "plain:init",
      "plain:update",
      "sync:init",
      "sync:update",
      "Δinit",
      "Δupdate",
      "ratio:init",
      "ratio:update",
    ].join("  ")
  );
  for (const [key, recs] of groups) {
    const [scenario, elems, updates] = key.split("|");
    const plain = recs.find((r) => r.mode === "plain");
    const sync = recs.find((r) => r.mode === "syncedstore");
    if (!plain || !sync) continue;
    const dInit = Number((sync.initMs - plain.initMs).toFixed(2));
    const dUpd = Number((sync.updateMs - plain.updateMs).toFixed(2));
    const rInit = Number((sync.initMs / plain.initMs).toFixed(2));
    const rUpd = Number((sync.updateMs / plain.updateMs).toFixed(2));

    lines.push(
      [
        scenario.padEnd(8),
        String(elems).padStart(5),
        String(updates).padStart(7),
        String(plain.initMs).padStart(9),
        String(plain.updateMs).padStart(12),
        String(sync.initMs).padStart(9),
        String(sync.updateMs).padStart(12),
        String(dInit).padStart(6),
        String(dUpd).padStart(8),
        String(rInit).padStart(9),
        String(rUpd).padStart(12),
      ].join("  ")
    );

    // Simple per-row bars (scaled to 30 chars)
    const bar = (v: number, max: number) => {
      const n = Math.max(1, Math.round((v / Math.max(1, max)) * 30));
      return "█".repeat(n);
    };
    const maxInit = Math.max(plain.initMs, sync.initMs);
    const maxUpd = Math.max(plain.updateMs, sync.updateMs);
    lines.push(
      `  init   ⚪ ${bar(plain.initMs, maxInit)} ${plain.initMs}ms\n` +
        `         🟠 ${bar(sync.initMs, maxInit)} ${sync.initMs}ms`
    );
    lines.push(
      `  update ⚪ ${bar(plain.updateMs, maxUpd)} ${plain.updateMs}ms\n` +
        `         🟠 ${bar(sync.updateMs, maxUpd)} ${sync.updateMs}ms`
    );
    lines.push("");
  }

  // eslint-disable-next-line no-console
  if (lines.length > 3) console.log(lines.join("\n"));
});
