// ABOUTME: Tests how the virtual client records write propagation and timeouts.
// ABOUTME: Drives a real client offline by applying remote Yjs updates directly.

import { afterEach, expect, setSystemTime, test } from "bun:test";
import * as Y from "yjs";
import { VirtualClient, WRITE_TIMEOUT_MS } from "./client.js";
import { MetricsCollector } from "./metrics.js";

const START = 1_000_000;
const clients: VirtualClient[] = [];

function createClient(): VirtualClient {
  // The client never connects, so nothing touches the network.
  const client = new VirtualClient({
    roomId: "client-test",
    host: "localhost:1",
    clientId: `client-${clients.length}`,
  });
  clients.push(client);
  return client;
}

// Applies an update from another document as if the server had relayed it.
function receiveRemoteUpdate(client: VirtualClient, value: string) {
  const internals = client as unknown as { doc: Y.Doc; provider: unknown };
  const remote = new Y.Doc();
  remote.getMap("play").set("remote", value);
  Y.applyUpdate(
    internals.doc,
    Y.encodeStateAsUpdate(remote),
    internals.provider,
  );
  remote.destroy();
}

function receipts(client: VirtualClient) {
  return client
    .getEvents()
    .filter((event) => event.type === "write-received")
    .map((event) => event.data);
}

afterEach(() => {
  setSystemTime();
  for (const client of clients.splice(0)) client.disconnect();
});

test("a remote update counts every pending write as propagated", () => {
  setSystemTime(START);
  const client = createClient();
  client.write(["can-move", "a"], { x: 1 });
  setSystemTime(START + 100);
  client.write(["can-move", "a"], { x: 2 });
  setSystemTime(START + 250);

  receiveRemoteUpdate(client, "one");

  expect(receipts(client)).toEqual([{ rttMs: 150, propagatedWrites: 2 }]);
});

test("the client's own writes are not mistaken for remote updates", () => {
  setSystemTime(START);
  const client = createClient();
  client.write(["can-move", "a"], { x: 1 });
  client.appendToArray(["chat", "messages"], "hi");

  expect(receipts(client)).toEqual([]);
});

test("a write with no remote update within the timeout is recorded once as timed out", () => {
  setSystemTime(START);
  const client = createClient();
  client.write(["can-move", "a"], { x: 1 });

  setSystemTime(START + WRITE_TIMEOUT_MS - 1);
  expect(receipts(client)).toEqual([]);

  setSystemTime(START + WRITE_TIMEOUT_MS);
  expect(receipts(client)).toEqual([{ rttMs: -1 }]);

  setSystemTime(START + WRITE_TIMEOUT_MS + 100);
  receiveRemoteUpdate(client, "late");

  expect(receipts(client)).toEqual([
    { rttMs: -1 },
    { rttMs: WRITE_TIMEOUT_MS + 100, propagatedWrites: 0 },
  ]);
});

test("a timed-out write and a propagated one give a propagation rate of one half", () => {
  setSystemTime(START);
  const client = createClient();
  client.write(["can-move", "a"], { x: 1 });
  setSystemTime(START + WRITE_TIMEOUT_MS + 500);
  client.write(["can-move", "a"], { x: 2 });
  setSystemTime(START + WRITE_TIMEOUT_MS + 600);
  receiveRemoteUpdate(client, "one");

  const events = client.getEvents();
  expect(
    events
      .filter((event) => event.type === "write-received")
      .map((event) => event.data),
  ).toEqual([{ rttMs: -1 }, { rttMs: 100, propagatedWrites: 1 }]);

  const snap = new MetricsCollector().snapshot(
    1,
    events,
    START,
    START + WRITE_TIMEOUT_MS + 1_000,
  );
  expect(snap.propagationRate).toBe(0.5);
  expect(snap.p50).toBe(100);
});
