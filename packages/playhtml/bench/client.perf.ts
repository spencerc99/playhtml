// ABOUTME: Measures client costs on common paths: sync traffic, renders, drags, presence, init.
// ABOUTME: Writes deterministic counts (and info-only *_ms timings) to bench/out/metrics.json.
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Y from "yjs";
import { elementHandlers, playhtml, resetPlayHTML } from "../src/index";
import { getPresenceSocketForRoom } from "../src/__tests__/presence-test-utils";

const OUT = path.resolve(__dirname, "out/metrics.json");

// Fixed Yjs client id so byte counts don't depend on a random id's length.
(globalThis as any).PLAYHTML_TEST_DOC_CLIENT_ID = 123456789;

// jsdom has no layout; the cursor client asks what is under the pointer.
document.elementFromPoint ??= () => document.body;
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

afterAll(() => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(metrics, null, 2));
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.floor(sorted.length / 2)].toFixed(1);
}

async function resetPage() {
  try {
    await resetPlayHTML();
  } catch {}
  document.body.innerHTML = "";
  (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
  delete (window as any).playhtml;
  delete document.documentElement.dataset.playhtml;
}

function peerIdentity(i: number) {
  return { publicKey: `peer-${i}`, playerStyle: { colorPalette: ["#4a9a8a"] } };
}

function peerCursor(i: number, step: number) {
  return {
    cursor: { x: 10 + step, y: 10 + i * 5, pointer: "mouse" },
    page: "/",
    zone: null,
    at: Date.now(),
  };
}

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
  const { handler, p, doc } = await setupCanPlay(
    id,
    defaultData,
    `/bench-${id}`,
  );
  const before = Y.encodeStateAsUpdate(doc).byteLength;
  p.ws.send.mockClear();
  // Simulated clock: one frame every 16 ms, as on a 60 Hz display.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
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
        handler.setData({
          x: frame,
          y: frame * 2,
          label: "sticker",
          color: "#ffcc00",
        }),
    );
    expect(result.synced).toEqual({
      x: 600,
      y: 1200,
      label: "sticker",
      color: "#ffcc00",
    });
    metrics.stream_msgs = result.messages;
    metrics.stream_bytes = result.bytes;
    metrics.stream_doc_growth = result.docGrowth;
  });

  // A guestbook-style list gaining 100 entries through setData(newArray).
  it("can-play list append", async () => {
    const seed = Array.from({ length: 200 }, (_, i) => `entry-${i}`);
    const result = await measureWrites(
      "guestbook",
      { items: seed },
      100,
      (handler, frame) =>
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
    const result = await measureWrites(
      "poll",
      { options: seed },
      100,
      (handler, frame) =>
        handler.setData({
          options: handler.data.options.map((option: any) =>
            option.id === frame % 200
              ? { ...option, votes: option.votes + 1 }
              : option,
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
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/bench-fanout",
    } as any);
    await flush(50);
    const doc: Y.Doc = provider().doc;
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    renders = 0;
    for (let i = 0; i < 100; i += 1) {
      const vector = Y.encodeStateVector(remote);
      const entry = (remote.getMap("play").get("can-play") as Y.Map<any>).get(
        `widget-${i}`,
      );
      remote.transact(() => {
        if (entry instanceof Y.Map) entry.set("count", 1);
        else
          (remote.getMap("play").get("can-play") as Y.Map<any>).set(
            `widget-${i}`,
            { count: 1 },
          );
      });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote, vector), "remote");
      await yieldFrame();
    }
    await flush();
    expect((playhtml.syncedStore as any)["can-play"]["widget-99"]).toEqual({
      count: 1,
    });
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
      await playhtml.init({
        host: "http://localhost:1999",
        room: "/bench-init",
      } as any);
      await flush(50);
    } finally {
      Document.prototype.querySelectorAll = docQsa;
      Element.prototype.querySelectorAll = elQsa;
    }
    expect(document.querySelectorAll("[can-move]").length).toBe(50);
    metrics.init_qsa_calls = scans;
  });

  // Your own element, 50 setData calls one frame apart: each should render once.
  it("local write renders", async () => {
    let renders = 0;
    const el = document.createElement("div");
    el.id = "counter";
    el.setAttribute("can-play", "");
    (el as any).defaultData = { count: 0 };
    (el as any).updateElement = () => {
      renders += 1;
    };
    document.body.appendChild(el);
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/bench-local",
    } as any);
    await flush(50);
    const handler = elementHandlers.get("can-play")!.get("counter")!;
    renders = 0;
    for (let i = 1; i <= 50; i += 1) {
      handler.setData({ count: i });
      await yieldFrame();
    }
    await flush();
    expect(handler.data).toEqual({ count: 50 });
    metrics.local_write_renders = renders;
  });

  // Dragging a can-move element for 2 s at 60 Hz.
  it("can-move drag", async () => {
    document.body.innerHTML = `<div id="sticker" can-move>drag me</div>`;
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/bench-drag",
    } as any);
    await flush(50);
    const el = document.getElementById("sticker")!;
    const p = provider();
    p.ws.send.mockClear();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
    });
    el.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 0, clientY: 0, bubbles: true }),
    );
    for (let frame = 1; frame <= 120; frame += 1) {
      await vi.advanceTimersByTimeAsync(16);
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: frame * 2,
          clientY: frame,
          bubbles: true,
        }),
      );
    }
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    const synced = (p.doc.getMap("play").toJSON() as any)["can-move"]?.sticker;
    expect(synced).toEqual({ x: 240, y: 120 });
    metrics.drag_msgs = p.ws.send.mock.calls.length;
    metrics.drag_bytes = sentBytes(p.ws.send.mock.calls);
  });

  // 20 people on the page moving their cursors for 5 s, while the page listens
  // to an unrelated presence channel and your own cursor moves too.
  it("presence churn", async () => {
    await playhtml.init({
      host: "http://localhost:1999",
      room: "/bench-presence",
      cursors: { enabled: true },
    } as any);
    await flush(50);
    const socket = getPresenceSocketForRoom(playhtml.roomId);
    const peers: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 20; i += 1) {
      peers[`conn-${i}`] = {
        identity: peerIdentity(i),
        cursor: peerCursor(i, 0),
      };
    }
    socket.receive({ type: "presence-sync", peers });
    await flush(50);

    let unrelatedCalls = 0;
    const unsubscribe = playhtml.presence.onPresenceChange("status", () => {
      unrelatedCalls += 1;
    });
    unrelatedCalls = 0;
    let cursorDomWrites = 0;
    const observer = new MutationObserver((records) => {
      cursorDomWrites += records.length;
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
    });
    const sentBefore = socket.sent.length;
    const bytesBefore = socket.sent.reduce(
      (total, message) => total + message.length,
      0,
    );

    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    for (let frame = 1; frame <= 300; frame += 1) {
      await vi.advanceTimersByTimeAsync(16);
      const updates: Record<string, Record<string, unknown>> = {};
      for (let i = 0; i < 20; i += 1)
        updates[`conn-${i}`] = { cursor: peerCursor(i, frame) };
      socket.receive({ type: "presence-changes", updates, removes: {} });
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: frame,
          clientY: frame,
          bubbles: true,
        }),
      );
    }
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    unsubscribe();
    cursorDomWrites += observer.takeRecords().length;
    observer.disconnect();

    expect(document.querySelectorAll(".playhtml-cursor-other").length).toBe(20);
    metrics.presence_unrelated_listener_calls = unrelatedCalls;
    metrics.presence_dom_writes = cursorDomWrites;
    metrics.presence_msgs_sent = socket.sent.length - sentBefore;
    metrics.presence_bytes_sent =
      socket.sent.reduce((total, message) => total + message.length, 0) -
      bytesBefore;
  });

  // A big page: 1,000 elements across capabilities. Counts event listeners
  // attached and DOM scans; init time is info-only.
  it("init 1000 elements", async () => {
    const tags = ["can-move", "can-toggle", "can-spin", "can-grow"];
    const markup = Array.from(
      { length: 1000 },
      (_, i) => `<div id="big-${i}" ${tags[i % tags.length]}>x</div>`,
    ).join("");
    const originalAdd = EventTarget.prototype.addEventListener;
    const docQsa = Document.prototype.querySelectorAll;
    const elQsa = Element.prototype.querySelectorAll;
    let listeners = 0;
    let scans = 0;
    const timings: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      await resetPage();
      document.body.innerHTML = markup;
      const counting = run === 0;
      if (counting) {
        EventTarget.prototype.addEventListener = function (...args: any[]) {
          listeners += 1;
          return originalAdd.apply(this, args as any);
        } as any;
        Document.prototype.querySelectorAll = function (...args: any[]) {
          scans += 1;
          return docQsa.apply(this, args as any);
        } as any;
        Element.prototype.querySelectorAll = function (...args: any[]) {
          scans += 1;
          return elQsa.apply(this, args as any);
        } as any;
      }
      const start = performance.now();
      try {
        await playhtml.init({
          host: "http://localhost:1999",
          room: `/bench-big-${run}`,
        } as any);
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        EventTarget.prototype.addEventListener = originalAdd;
        Document.prototype.querySelectorAll = docQsa;
        Element.prototype.querySelectorAll = elQsa;
      }
      timings.push(performance.now() - start);
      await flush(50);
      expect(elementHandlers.get("can-move")?.size).toBe(250);
    }
    metrics.init_1000_listeners = listeners;
    metrics.init_1000_qsa_calls = scans;
    metrics.init_1000_ms = median(timings);
  });
});
