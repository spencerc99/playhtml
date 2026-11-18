// ABOUTME: Verifies the installation event store reports the version each write stored.
// ABOUTME: Runs against a real IndexedDB implementation, a fresh one per test.

import { afterEach, beforeEach, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { CollectionEvent } from "../../types";
import { readEvents, writeEvents } from "../installationEventStore";

function event(id: string): CollectionEvent {
  return { id, ts: 1, type: "cursor", data: {}, meta: {} } as CollectionEvent;
}

const originalIndexedDB = globalThis.indexedDB;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  globalThis.indexedDB = originalIndexedDB;
});

it("resolves each write with the version it stored", async () => {
  expect(await readEvents()).toBeNull();

  const first = await writeEvents([event("a")]);
  expect(first).toBe(1);
  expect((await readEvents())?.version).toBe(first);

  const second = await writeEvents([event("b")]);
  expect(second).toBe(2);
  const stored = await readEvents();
  expect(stored?.version).toBe(second);
  expect(stored?.events.map((e) => e.id)).toEqual(["b"]);
});
