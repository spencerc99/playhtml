// ABOUTME: Measures generic client costs: setData sync traffic, remote update fan-out, init scans.
// ABOUTME: Writes deterministic counts to bench/out/metrics.json for the hillclimb runner.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Y from "yjs";
import { elementHandlers, playhtml, resetPlayHTML } from "../src/index";

const OUT = path.resolve(__dirname, "out/metrics.json");
const metrics: Record<string, number> = {};

function provider(): any {
  const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
  return providers[0];
}

function sentBytes(calls: unknown[][]): number {
  let total = 0;
  for (const [message] of calls) {
    if (message instanceof Uint8Array) total += message.byteLength;
    else if (typeof message === "string") total += message.length;
  }
  return total;
}

async function flush(ms = 400) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  try {
    await resetPlayHTML();
  } catch {}
  document.body.innerHTML = "";
  localStorage.clear();
  (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
  delete (window as any).playhtml;
  delete document.documentElement.dataset.playhtml;
});

async function yieldFrame() {
  // A real page runs pending tasks between frames.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function setupCanPlay(id: string, defaultData: unknown, room: string) {
  const el = document.createElement("div");
  el.id = id;
  el.setAttribute("can-play", "");
  (el as any).defaultData = defaultData;
  (el as any).updateElement = () => {};
  document.body.appendChild(el);
  await playhtml.init({ host: "http://localhost:1999", room } as any);
  await flush(50);
  const handler = elementHandlers.get("can-play")!.get(id)!;
  return { handler, p: provider(), doc: provider().doc as Y.Doc };
}

// Runs `write` once per frame for `frames` frames and reports the sync
// traffic plus the value a second client ends up with.
async function measureWrites(
  id: string,
  defaultData: unknown,
  frames: number,
  write: (handler: any, frame: number) => void,
) {
  const { handler, p, doc } = await setupCanPlay(id, defaultData, `/bench-${id}`);
  const before = Y.encodeStateAsUpdate(doc).byteLength;
  p.ws.send.mockClear();
  // Simulated clock: one frame every 16 ms, as on a 60 Hz display.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  for (let frame = 1; frame <= frames; frame += 1) {
    await vi.advanceTimersByTimeAsync(16);
    write(handler, frame);
  }
  await vi.advanceTimersByTimeAsync(1000);
  vi.useRealTimers();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
  return {
    messages: p.ws.send.mock.calls.length,
    bytes: sentBytes(p.ws.send.mock.calls),
    docGrowth: Y.encodeStateAsUpdate(doc).byteLength - before,
    synced: (remote.getMap("play").toJSON() as any)["can-play"]?.[id],
  };
}

describe("client performance", () => {
  // A custom element streaming its state (a sticker, a slider) at 60 Hz for 10 s.
  it("can-play stream", async () => {
    const result = await measureWrites(
      "sticker",
      { x: 0, y: 0, label: "sticker", color: "#ffcc00" },
      600,
      (handler, frame) =>
        handler.setData({ x: frame, y: frame * 2, label: "sticker", color: "#ffcc00" }),
    );
    expect(result.synced).toEqual({ x: 600, y: 1200, label: "sticker", color: "#ffcc00" });
    metrics.stream_msgs = result.messages;
    metrics.stream_bytes = result.bytes;
    metrics.stream_doc_growth = result.docGrowth;
  });

  // A guestbook-style list gaining 100 entries through setData(newArray).
  it("can-play list append", async () => {
    const seed = Array.from({ length: 200 }, (_, i) => `entry-${i}`);
    const result = await measureWrites("guestbook", { items: seed }, 100, (handler, frame) =>
      handler.setData({ items: [...handler.data.items, `new-${frame}`] }),
    );
    expect(result.synced.items).toHaveLength(300);
    expect(result.synced.items[299]).toBe("new-100");
    metrics.append_bytes = result.bytes;
    metrics.append_doc_growth = result.docGrowth;
  });

  // Editing one field of one object in a 200-object list, 100 times.
  it("can-play list edit", async () => {
    const seed = Array.from({ length: 200 }, (_, i) => ({ id: i, votes: 0 }));
    const result = await measureWrites("poll", { options: seed }, 100, (handler, frame) =>
      handler.setData({
        options: handler.data.options.map((option: any) =>
          option.id === frame % 200 ? { ...option, votes: option.votes + 1 } : option,
        ),
      }),
    );
    expect(result.synced.options[5]).toEqual({ id: 5, votes: 1 });
    metrics.edit_bytes = result.bytes;
    metrics.edit_doc_growth = result.docGrowth;
  });

  // 100 custom elements on a page; other people change each one once.
  it("remote update fan-out", async () => {
    let renders = 0;
    for (let i = 0; i < 100; i += 1) {
      const el = document.createElement("div");
      el.id = `widget-${i}`;
      el.setAttribute("can-play", "");
      (el as any).defaultData = { count: 0 };
      (el as any).updateElement = () => {
        renders += 1;
      };
      document.body.appendChild(el);
    }
    await playhtml.init({ host: "http://localhost:1999", room: "/bench-fanout" } as any);
    await flush(50);
    const doc: Y.Doc = provider().doc;
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    renders = 0;
    for (let i = 0; i < 100; i += 1) {
      const vector = Y.encodeStateVector(remote);
      const entry = (remote.getMap("play").get("can-play") as Y.Map<any>).get(`widget-${i}`);
      remote.transact(() => {
        if (entry instanceof Y.Map) entry.set("count", 1);
        else (remote.getMap("play").get("can-play") as Y.Map<any>).set(`widget-${i}`, { count: 1 });
      });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, vector), "remote");
      await yieldFrame();
    }
    await flush();
    expect((playhtml.syncedStore as any)["can-play"]["widget-99"]).toEqual({ count: 1 });
    metrics.fanout_renders = renders;
  });

  it("init DOM scans", async () => {
    const tags = ["can-move", "can-toggle", "can-spin", "can-grow"];
    document.body.innerHTML = Array.from(
      { length: 200 },
      (_, i) => `<div id="el-${i}" ${tags[i % tags.length]}>x</div>`,
    ).join("");
    let scans = 0;
    const docQsa = Document.prototype.querySelectorAll;
    const elQsa = Element.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (...args: any[]) {
      scans += 1;
      return docQsa.apply(this, args as any);
    } as any;
    Element.prototype.querySelectorAll = function (...args: any[]) {
      scans += 1;
      return elQsa.apply(this, args as any);
    } as any;
    try {
      await playhtml.init({ host: "http://localhost:1999", room: "/bench-init" } as any);
      await flush(50);
    } finally {
      Document.prototype.querySelectorAll = docQsa;
      Element.prototype.querySelectorAll = elQsa;
    }
    expect(document.querySelectorAll("[can-move]").length).toBe(50);
    metrics.init_qsa_calls = scans;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(metrics, null, 2));
  });
});
