// ABOUTME: Tests which scrap pictures the meaning search remembers as unreadable after a failed fetch.
// ABOUTME: Real fetches to a local server and a real index on in-memory IndexedDB; only the model worker is stood in.

import React, { act } from "react";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type {
  MeaningWorkerRequest,
  MeaningWorkerResponse,
} from "../entrypoints/scraps/meaning/meaningProtocol";

// The picture-reading model cannot run here, so a stand-in answers every
// picture it is handed with the same vector.
vi.mock("../entrypoints/scraps/meaning/meaningModel.worker?worker", () => ({
  default: class {
    onmessage: ((event: { data: MeaningWorkerResponse }) => void) | null =
      null;
    postMessage(request: MeaningWorkerRequest) {
      const answer = (data: MeaningWorkerResponse) =>
        queueMicrotask(() => this.onmessage?.({ data }));
      if (request.type === "load") answer({ type: "ready", device: "wasm" });
      else
        answer({ type: "vector", id: request.id, vector: new Float32Array([1, 0]) });
    }
    terminate() {}
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const STATUSES: Record<string, number> = {
  "/busy.png": 503,
  "/timed-out.png": 408,
  "/slow-down.png": 429,
  "/gone.png": 404,
};

let server: Server;
let base = "";
/** An address nothing listens on, as a picture fetched while offline. */
let offline = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    const status = STATUSES[request.url ?? ""];
    if (status) {
      response.writeHead(status);
      response.end();
      return;
    }
    response.setHeader("content-type", "image/png");
    response.end("a picture");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  offline = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/offline.png`;
  await new Promise<void>((resolve) => closed.close(() => resolve()));

  (globalThis as typeof globalThis & { indexedDB: IDBFactory }).indexedDB =
    fakeIndexedDB;
  Object.defineProperty(globalThis, "IDBKeyRange", {
    value: fakeIDBKeyRange,
    configurable: true,
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let root: Root | null = null;

afterEach(() => {
  if (root) {
    const mounted = root;
    root = null;
    act(() => mounted.unmount());
  }
  localStorage.removeItem("scraps-meaning-search");
});

function picture(src: string, ts: number): ScrapItem {
  return {
    kind: "image",
    src,
    ts,
    naturalWidth: 10,
    naturalHeight: 10,
  } as ScrapItem;
}

describe("reading scrap pictures for meaning search", () => {
  it("tries a picture again after a fetch that may pass, and gives up only on one that is gone", async () => {
    const { useMeaningSearch } = await import(
      "../entrypoints/scraps/meaning/useMeaningSearch"
    );
    const { readMeaningVectors } = await import(
      "../entrypoints/scraps/meaning/meaningIndex"
    );
    const { MEANING_INDEX_VERSION } = await import(
      "../entrypoints/scraps/meaning/meaningModelInfo"
    );

    const items = [
      picture(`${base}/fine.png`, 6),
      picture(`${base}/busy.png`, 5),
      picture(`${base}/timed-out.png`, 4),
      picture(`${base}/slow-down.png`, 3),
      picture(offline, 2),
      picture(`${base}/gone.png`, 1),
    ];
    localStorage.setItem("scraps-meaning-search", "on");
    let phase = "";
    function Harness() {
      phase = useMeaningSearch(items, true).status.phase;
      return null;
    }
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(<Harness />));
    for (let round = 0; round < 50 && phase !== "ready"; round += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(phase).toBe("ready");

    const stored = await readMeaningVectors(MEANING_INDEX_VERSION);
    // The index's copy comes back from another realm, so compare its values.
    expect([...(stored.get(`${base}/fine.png`) ?? [])]).toEqual([1, 0]);
    // A picture that is gone is remembered as one that cannot be read.
    expect(stored.has(`${base}/gone.png`)).toBe(true);
    expect(stored.get(`${base}/gone.png`)).toBeNull();
    // Server trouble, a timeout, a request to slow down, and being offline
    // are left unread, so the next run fetches them again.
    for (const src of [
      `${base}/busy.png`,
      `${base}/timed-out.png`,
      `${base}/slow-down.png`,
      offline,
    ]) {
      expect(stored.has(src), src).toBe(false);
    }
  });
});
