// ABOUTME: Shared helpers for the per-capability benchmarks in bench/capabilities/.
// ABOUTME: Page reset, simulated frames, sync traffic, a remote peer, and DOM write counts.
import { vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Y from "yjs";
import { syncedStore } from "@syncedstore/core";
import { playhtml, resetPlayHTML } from "../../src/index";

// Fixed Yjs client id so byte counts don't depend on a random id's length.
(globalThis as any).PLAYHTML_TEST_DOC_CLIENT_ID = 123456789;
// jsdom has no layout; the cursor client asks what is under the pointer.
document.elementFromPoint ??= () => document.body;

// playhtml stamps elements with a random animation delay that can-mirror
// syncs as part of the style attribute; a seeded Math.random keeps byte counts
// identical between runs.
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

export type Metrics = Record<string, number>;

// Each capability file writes its own metrics file; bench/run.mjs merges every
// out/metrics*.json into one result.
export function writeCapabilityMetrics(capability: string, metrics: Metrics) {
  const out = path.resolve(__dirname, `../out/metrics.${capability}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(metrics, null, 2));
}

export async function resetPage() {
  vi.useRealTimers();
  seed = 1;
  try {
    await resetPlayHTML();
  } catch {}
  document.body.innerHTML = "";
  localStorage.clear();
  (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
  delete (window as any).playhtml;
  delete document.documentElement.dataset.playhtml;
}

export function provider(): any {
  return ((globalThis as any).PLAYHTML_TEST_PROVIDERS as any[])[0];
}

export function doc(): Y.Doc {
  return provider().doc as Y.Doc;
}

// Starts playhtml on whatever is in document.body, then lets setup writes
// (default data, batched sends) finish so they don't count toward a scenario.
export async function initPage(room: string, options: object = {}) {
  await playhtml.init({
    host: "http://localhost:1999",
    room,
    cursors: { enabled: false },
    ...options,
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

// Sync traffic this client sends while `run` executes: Yjs messages, their
// bytes, and how much the shared document grew (what every late joiner loads).
export async function measureTraffic(run: () => Promise<void>) {
  const p = provider();
  const before = Y.encodeStateAsUpdate(p.doc).byteLength;
  p.ws.send.mockClear();
  await run();
  let bytes = 0;
  for (const [message] of p.ws.send.mock.calls) {
    if (message instanceof Uint8Array) bytes += message.byteLength;
    else if (typeof message === "string") bytes += message.length;
  }
  return {
    messages: p.ws.send.mock.calls.length,
    bytes,
    docGrowth: Y.encodeStateAsUpdate(p.doc).byteLength - before,
  };
}

// Simulated clock: `frames` frames 16 ms apart, as on a 60 Hz display, with
// `step` running at the start of each. Pending sends finish before it returns.
export async function runFrames(frames: number, step: (frame: number) => void) {
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
  try {
    for (let frame = 1; frame <= frames; frame += 1) {
      step(frame);
      await vi.advanceTimersByTimeAsync(16);
    }
    await vi.advanceTimersByTimeAsync(1000);
  } finally {
    vi.useRealTimers();
  }
}

let peerCount = 0;

// Another person on the page. They hold a copy of the document, edit it through
// the same SyncedStore shape playhtml uses, and each `edit` reaches this client
// as one remote update.
export function remotePeer() {
  const local = doc();
  const remote = new Y.Doc();
  // A new id per peer: the document outlives resets, and Yjs reassigns a
  // random id when it sees its own id in incoming history.
  remote.clientID = 900000000 + ++peerCount;
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
  const store = syncedStore<{ play: Record<string, any> }>(
    { play: {} },
    remote,
  );
  return {
    store,
    edit(change: (play: Record<string, any>) => void) {
      const vector = Y.encodeStateVector(remote);
      remote.transact(() => change(store.play));
      // The provider applies server updates as itself, so they aren't sent back.
      Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, vector), provider());
    },
  };
}

// Counts DOM mutation records under `root` while `run` executes: the DOM work
// this client does to show other people's changes.
export async function countDomWrites(
  root: Node,
  run: () => Promise<void>,
): Promise<number> {
  let writes = 0;
  const observer = new MutationObserver((records) => {
    writes += records.length;
  });
  observer.observe(root, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
  });
  await run();
  writes += observer.takeRecords().length;
  observer.disconnect();
  return writes;
}

// Wall-clock time that keeps running while runFrames fakes the clock.
const realPerformance = performance;
export function now(): number {
  return realPerformance.now();
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.floor(sorted.length / 2)].toFixed(1);
}

export function typeInto(
  input: HTMLInputElement | HTMLTextAreaElement,
  char: string,
) {
  input.value += char;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
