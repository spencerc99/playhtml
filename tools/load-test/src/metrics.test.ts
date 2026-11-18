// ABOUTME: Tests snapshot math in the load-test metrics collector.
// ABOUTME: Covers write propagation rates, including timed-out writes.

import { expect, test } from "bun:test";
import type { ClientEvent } from "./client.js";
import { MetricsCollector } from "./metrics.js";

test("propagation rate counts timed-out writes against propagated ones", () => {
  const events: ClientEvent[] = [
    { type: "write", ts: 50 },
    { type: "write", ts: 100 },
    { type: "write", ts: 200 },
    { type: "write", ts: 300 },
    {
      type: "write-received",
      ts: 400,
      data: { rttMs: 100, propagatedWrites: 3 },
    },
    { type: "write-received", ts: 500, data: { rttMs: -1 } },
  ];

  const snap = new MetricsCollector().snapshot(1, events, 0, 1_000);

  expect(snap.propagationRate).toBe(0.75);
  expect(snap.p50).toBe(100);
});

test("propagation rate is 1 when every write was followed by a remote update", () => {
  const events: ClientEvent[] = [
    { type: "write", ts: 100 },
    {
      type: "write-received",
      ts: 150,
      data: { rttMs: 50, propagatedWrites: 1 },
    },
  ];

  const snap = new MetricsCollector().snapshot(1, events, 0, 1_000);

  expect(snap.propagationRate).toBe(1);
});
