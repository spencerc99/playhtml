import { describe, it, expect, vi, afterAll } from "vitest";
import * as Y from "yjs";

type TestMode = "syncedstore-mutator" | "syncedstore-value" | "yjs-baseline";

type PerfRecord = {
  scenario: "baseline" | "complex";
  mode: TestMode;
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
  mode: TestMode,
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
  if (mode === "yjs-baseline") {
    // Pure Y.Map baseline: simulate the original "plain" dataMode
    // This should bypass SyncedStore entirely like the old system
    
    // Create a minimal Y.Map-only setup that mimics the old plain mode
    const { ElementHandler } = await import("../elements");
    
    // Simulate the old initialization without SyncedStore
    play.elementHandlers = new Map();
    play.elementHandlers.set("can-play", new Map());
    
    // Create a Y.Doc and setup like the old system (without SyncedStore)
    const yjsDoc = new Y.Doc();
    const globalData = yjsDoc.getMap<Y.Map<any>>("playhtml-global");
    const tagMap = new Y.Map();
    globalData.set("can-play", tagMap);
    
    // Create real ElementHandler instances but with Y.Map data source
    for (let i = 0; i < count; i++) {
      const el = document.getElementById(`${mode}_${complex ? "complex_" : ""}${i}`);
      if (el) {
        const elementId = el.id;
        const defaultData = complex ? {
          profile: { name: `user-${i}`, flags: { a: true, b: false } },
          lists: { todos: [] },
          counters: { clicks: 0, hovers: 0 },
          nested: { a: { b: { c: { values: [i] } } } },
        } : { list: [], meta: { i } };
        
        // Initialize Y.Map with default data
        tagMap.set(elementId, defaultData);
        
        // Create ElementHandler with Y.Map onChange (old system pattern)
        const elementData = {
          element: el,
          defaultData,
          defaultLocalData: {},
          data: defaultData,
          onChange: (newData: any) => {
            // Y.Map onChange: only handle value form (no mutator support)
            if (typeof newData === 'function') {
              // Mutator form not supported in Y.Map mode
              return;
            }
            tagMap.set(elementId, newData);
            // Use the private __data setter instead of the public getter
            (handler as any).__data = newData;
          },
          onAwarenessChange: () => {},
          updateElement: () => {},
          updateElementAwareness: () => {},
        };
        
        const handler = new ElementHandler(elementData as any);
        play.elementHandlers.get("can-play")!.set(elementId, handler);
      }
    }
  } else {
    // Full SyncedStore initialization (unchanged)
    await play.init({ 
      room: `test-${mode}-${Date.now()}`, // Unique room per test
      host: "localhost:1999" // Use localhost for tests
    });
  }
  const t1 = performance.now();

  const handlers = Array.from(
    play.elementHandlers!.get("can-play")?.values() ?? []
  );
  expect(handlers.length).toBe(count);

  const u0 = performance.now();
  for (let k = 0; k < updates; k++) {
    const h = handlers[k % handlers.length];
    
    if (mode === "yjs-baseline") {
      // Y.Map approach: full replacement semantics (old system)
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
        const list = data.list ?? [];
        h.setData({ list: [...list, k], meta: { i: k } });
      }
    } else if (mode === "syncedstore-mutator") {
      // SyncedStore with mutator form (optimal for merging)
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
    } else if (mode === "syncedstore-value") {
      // SyncedStore with value form (replacement semantics)
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
        const list = data.list ?? [];
        h.setData({ list: [...list, k], meta: { i: k } });
      }
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

describe("end-to-end performance (SyncedStore vs Y.Map baseline)", () => {
  it("baseline small - Y.Map vs SyncedStore patterns", async () => {
    await runPerfCase("yjs-baseline", { count: 150, updates: 800 });
    await runPerfCase("syncedstore-mutator", { count: 150, updates: 800 });
    await runPerfCase("syncedstore-value", { count: 150, updates: 800 });
  });

  it("complex nested data - Y.Map vs SyncedStore", async () => {
    await runPerfCase("yjs-baseline", { count: 100, updates: 600, complex: true });
    await runPerfCase("syncedstore-mutator", { count: 100, updates: 600, complex: true });
    await runPerfCase("syncedstore-value", { count: 100, updates: 600, complex: true });
  });

  it("scale-up elements - Y.Map vs SyncedStore overhead", async () => {
    await runPerfCase("yjs-baseline", { count: 400, updates: 1000 });
    await runPerfCase("syncedstore-mutator", { count: 400, updates: 1000 });
    await runPerfCase("syncedstore-value", { count: 400, updates: 1000 });
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
    await play.init(); // SyncedStore-only now
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
      "yjs:init",
      "yjs:update",
      "mutator:init",
      "mutator:update", 
      "value:init",
      "value:update",
      "best-sync",
      "vs-yjs",
    ].join("  ")
  );
  for (const [key, recs] of groups) {
    const [scenario, elems, updates] = key.split("|");
    const yjs = recs.find((r) => r.mode === "yjs-baseline");
    const mutator = recs.find((r) => r.mode === "syncedstore-mutator");
    const value = recs.find((r) => r.mode === "syncedstore-value");
    if (!yjs || !mutator || !value) continue;
    
    // Determine best SyncedStore pattern
    const bestUpdate = mutator.updateMs < value.updateMs ? "mutator" : "value";
    const bestInit = mutator.initMs < value.initMs ? "mutator" : "value";
    const bestSync = bestUpdate === bestInit ? bestUpdate : `${bestInit}/${bestUpdate}`;
    
    // Compare best SyncedStore vs Y.Map
    const bestSyncedStore = bestUpdate === "mutator" ? mutator : value;
    const updateRatio = (bestSyncedStore.updateMs / yjs.updateMs).toFixed(1);
    const initRatio = (bestSyncedStore.initMs / yjs.initMs).toFixed(1);
    const vsYjs = `${initRatio}x/${updateRatio}x`;

    lines.push(
      [
        scenario.padEnd(8),
        String(elems).padStart(5),
        String(updates).padStart(7),
        String(yjs.initMs).padStart(8),
        String(yjs.updateMs).padStart(10),
        String(mutator.initMs).padStart(12),
        String(mutator.updateMs).padStart(14),
        String(value.initMs).padStart(10),
        String(value.updateMs).padStart(12),
        bestSync.padStart(9),
        vsYjs.padStart(6),
      ].join("  ")
    );

    // Visual comparison bars
    const bar = (v: number, max: number) => {
      const n = Math.max(1, Math.round((v / Math.max(1, max)) * 25));
      return "█".repeat(n);
    };
    const maxInit = Math.max(yjs.initMs, mutator.initMs, value.initMs);
    const maxUpd = Math.max(yjs.updateMs, mutator.updateMs, value.updateMs);
    lines.push(
      `  init   🔵 ${bar(yjs.initMs, maxInit)} ${yjs.initMs}ms (Y.Map)\n` +
        `         🟠 ${bar(mutator.initMs, maxInit)} ${mutator.initMs}ms (mutator)\n` +
        `         🟡 ${bar(value.initMs, maxInit)} ${value.initMs}ms (value)`
    );
    lines.push(
      `  update 🔵 ${bar(yjs.updateMs, maxUpd)} ${yjs.updateMs}ms (Y.Map)\n` +
        `         🟠 ${bar(mutator.updateMs, maxUpd)} ${mutator.updateMs}ms (mutator)\n` +
        `         🟡 ${bar(value.updateMs, maxUpd)} ${value.updateMs}ms (value)`
    );
    lines.push("");
  }

  // eslint-disable-next-line no-console
  if (lines.length > 3) console.log(lines.join("\n"));
});
