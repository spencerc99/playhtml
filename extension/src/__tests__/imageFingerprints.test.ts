// ABOUTME: Exercises fingerprint downloads against a real local HTTP server.
// ABOUTME: Verifies exact byte matching, response validation, and bounded body reads.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { webcrypto } from "node:crypto";
import { transferableAbortController } from "node:util";
import {
  ImageFingerprints,
  fetchImageFingerprint,
  MAX_FINGERPRINT_BYTES,
} from "../storage/imageFingerprints";

import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { LocalEventStore } from "../storage/LocalEventStore";
import type { CollectionEvent } from "../collectors/types";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="orange"/></svg>';
const requests: string[] = [];
let active = 0;
let peak = 0;
let changingImage = svg;
const server = createServer((request, response) => {
  requests.push(request.url!);
  active++;
  peak = Math.max(peak, active);
  response.on("close", () => active--);
  if (request.url === "/redirect") {
    response.writeHead(302, { location: "/a" });
    response.end();
    return;
  }
  if (request.url === "/missing") {
    response.writeHead(404);
    response.end();
    return;
  }
  if (request.url === "/html") {
    response.setHeader("content-type", "text/html");
    response.end(svg);
    return;
  }
  response.setHeader("content-type", "image/svg+xml");
  if (request.url === "/oversized") {
    response.setHeader("content-length", MAX_FINGERPRINT_BYTES + 1);
    response.end();
    return;
  }
  if (request.url === "/streamed") {
    response.write(Buffer.alloc(MAX_FINGERPRINT_BYTES + 1));
    response.end();
    return;
  }
  if (request.url === "/empty") {
    response.end();
    return;
  }
  if (request.url?.startsWith("/timeout")) {
    response.flushHeaders();
    return;
  }
  setTimeout(
    () =>
      response.end(
        request.url === "/changing"
          ? changingImage
          : request.url === "/different"
            ? svg.replace("orange", "blue")
            : svg,
      ),
    10,
  );
});
let origin: string;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  globalThis.indexedDB = indexedDB;
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.stubGlobal(
    "AbortController",
    class {
      constructor() {
        return transferableAbortController();
      }
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server address");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("image fingerprints", () => {
  it("matches identical bytes across URLs and distinguishes different images", async () => {
    const first = await fetchImageFingerprint(`${origin}/a`);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await fetchImageFingerprint(`${origin}/b`)).toBe(first);
    expect(await fetchImageFingerprint(`${origin}/different`)).not.toBe(first);
  });
  it("keeps failed, empty, and oversized downloads unchecked", async () => {
    for (const path of ["missing", "html", "oversized", "streamed", "empty"]) {
      expect(await fetchImageFingerprint(`${origin}/${path}`)).toBeUndefined();
    }
  });
  it("does not follow redirects or request non-HTTP sources", async () => {
    requests.length = 0;
    expect(await fetchImageFingerprint(`${origin}/redirect`)).toBeUndefined();
    expect(requests).toEqual(["/redirect"]);
    expect(
      await fetchImageFingerprint("data:image/png;base64,AAAA"),
    ).toBeUndefined();
    expect(
      await fetchImageFingerprint("file:///tmp/image.png"),
    ).toBeUndefined();
    expect(
      await fetchImageFingerprint("https://user:password@example.com/image"),
    ).toBeUndefined();
    expect(requests).toEqual(["/redirect"]);
  });
  it("bounds queued work and downloads later encounters again", async () => {
    const store = new LocalEventStore();
    try {
      const events: CollectionEvent[] = Array.from({ length: 36 }, (_, i) => ({
        id: `queue-${i}`,
        type: "element",
        ts: 1,
        domain: "example.com",
        meta: {
          pid: "test",
          sid: "test",
          url: `https://example.com/${i}`,
          vw: 100,
          vh: 100,
          tz: "UTC",
        },
        data: {
          kind: "image",
          src: `${origin}/queue-${i}`,
          naturalWidth: 100,
          naturalHeight: 100,
          pageTitle: "Test",
        },
      }));
      const accepted = await store.addEvents(events);
      const fingerprints = new ImageFingerprints(store);
      peak = 0;
      expect(await fingerprints.process(accepted)).toEqual({
        checked: 32,
        skipped: 4,
      });
      expect(peak).toBeLessThanOrEqual(2);
      expect(await store.queryByType("element")).toHaveLength(36);
      const requestCount = requests.length;
      const repeated = {
        ...events[0],
        id: "another-place",
        meta: { ...events[0].meta, url: "https://another.example/page" },
      };
      expect(
        await fingerprints.process(await store.addEvents([repeated])),
      ).toEqual({ checked: 1, skipped: 0 });
      expect(requests).toHaveLength(requestCount + 1);
    } finally {
      (store as unknown as { db: IDBDatabase }).db?.close();
    }
  });

  it("shares concurrent requests but fingerprints changed bytes on later visits", async () => {
    const store = new LocalEventStore();
    const fingerprints = new ImageFingerprints(store);
    const event = (id: string): CollectionEvent => ({
      id,
      type: "element",
      ts: 1,
      domain: "example.com",
      meta: {
        pid: "test",
        sid: "test",
        url: `https://example.com/${id}`,
        vw: 100,
        vh: 100,
        tz: "UTC",
      },
      data: {
        kind: "image",
        src: `${origin}/changing`,
        naturalWidth: 100,
        naturalHeight: 100,
        pageTitle: id,
      },
    });
    try {
      changingImage = svg;
      const count = requests.filter((url) => url === "/changing").length;
      const accepted = await store.addEvents([
        event("changing-a"),
        event("changing-b"),
      ]);
      await Promise.all(accepted.map((item) => fingerprints.process([item])));
      expect(requests.filter((url) => url === "/changing")).toHaveLength(
        count + 1,
      );
      changingImage = svg.replace("orange", "blue");
      await fingerprints.process(await store.addEvents([event("changing-c")]));
      expect(requests.filter((url) => url === "/changing")).toHaveLength(
        count + 2,
      );
      const saved = await store.queryByType("element");
      const hash = (id: string) =>
        (saved.find((item) => item.id === id)!.data as { contentHash: string })
          .contentHash;
      expect(hash("changing-a")).toMatch(/^[a-f0-9]{64}$/);
      expect(hash("changing-b")).toBe(hash("changing-a"));
      expect(hash("changing-c")).not.toBe(hash("changing-a"));
    } finally {
      (store as unknown as { db: IDBDatabase }).db?.close();
    }
  });

  it("aborts a response that never finishes", async () => {
    const openRequests = active;
    expect(await fetchImageFingerprint(`${origin}/timeout`)).toBeUndefined();
    await vi.waitFor(() => expect(active).toBe(openRequests));
  }, 15000);

  it("bounds active response readers and closes timed-out requests", async () => {
    const nativeFetch = globalThis.fetch;
    let activeReaders = 0;
    let peakReaders = 0;
    let totalReaders = 0;
    // Observe native readers: server close events can arrive after the next
    // request even though the cancelled client reader has already settled.
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      const response = await nativeFetch(...args);
      const body = response.body;
      if (body) {
        const getReader = body.getReader.bind(body);
        body.getReader = ((...readerArgs: Parameters<typeof body.getReader>) => {
          const reader = getReader(...readerArgs);
          totalReaders++;
          activeReaders++;
          peakReaders = Math.max(peakReaders, activeReaders);
          const closed = () => { activeReaders--; };
          void reader.closed.then(closed, closed);
          return reader;
        }) as typeof body.getReader;
      }
      return response;
    });
    const store = new LocalEventStore();
    const events: CollectionEvent[] = Array.from({ length: 4 }, (_, index) => ({
      id: `timeout-${index}`,
      type: "element",
      ts: 1,
      domain: "example.com",
      meta: {
        pid: "test",
        sid: "test",
        url: `https://example.com/${index}`,
        vw: 100,
        vh: 100,
        tz: "UTC",
      },
      data: {
        kind: "image",
        src: `${origin}/timeout?request=${index}`,
        naturalWidth: 100,
        naturalHeight: 100,
        pageTitle: "Test",
      },
    }));
    try {
      const accepted = await store.addEvents(events);
      expect(await new ImageFingerprints(store).process(accepted)).toEqual({
        checked: 0,
        skipped: 4,
      });
      expect(totalReaders).toBe(4);
      expect(peakReaders).toBeLessThanOrEqual(2);
      expect(activeReaders).toBe(0);
      await vi.waitFor(() => expect(active).toBe(0));
    } finally {
      vi.stubGlobal("fetch", nativeFetch);
      (store as unknown as { db: IDBDatabase }).db?.close();
    }
  }, 25000);
});
