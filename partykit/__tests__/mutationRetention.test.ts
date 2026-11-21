// ABOUTME: Tests which clients a version 2 room forgets and which it keeps.
// ABOUTME: Covers the retention window, connected clients, and rooms saved without times.

import { describe, expect, test } from "bun:test";
import { pruneForgottenClients } from "../mutationRetention";

const RETENTION_MS = 1000;

describe("pruneForgottenClients", () => {
  test("removes a client last seen before the retention window", () => {
    const lastMutationIds = { old: 4, recent: 2 };
    const clientLastSeen = { old: 0, recent: 9500 };

    const removed = pruneForgottenClients({
      lastMutationIds,
      clientLastSeen,
      connectedClientIds: new Set(),
      now: 10_000,
      retentionMs: RETENTION_MS,
    });

    expect(removed).toBe(1);
    expect(lastMutationIds).toEqual({ recent: 2 } as never);
    expect(clientLastSeen).toEqual({ recent: 9500 } as never);
  });

  test("keeps a client seen exactly at the edge of the window", () => {
    const lastMutationIds = { edge: 1 };
    const clientLastSeen = { edge: 9000 };

    pruneForgottenClients({
      lastMutationIds,
      clientLastSeen,
      connectedClientIds: new Set(),
      now: 10_000,
      retentionMs: RETENTION_MS,
    });

    expect(lastMutationIds).toEqual({ edge: 1 });
  });

  test("keeps a connected client however long ago it wrote and refreshes its time", () => {
    const lastMutationIds = { connected: 7 };
    const clientLastSeen = { connected: 0 };

    const removed = pruneForgottenClients({
      lastMutationIds,
      clientLastSeen,
      connectedClientIds: new Set(["connected"]),
      now: 10_000,
      retentionMs: RETENTION_MS,
    });

    expect(removed).toBe(0);
    expect(lastMutationIds).toEqual({ connected: 7 });
    expect(clientLastSeen).toEqual({ connected: 10_000 });
  });

  test("starts the window now for a client with no recorded time", () => {
    const lastMutationIds = { untracked: 3 };
    const clientLastSeen: Record<string, number> = {};

    const removed = pruneForgottenClients({
      lastMutationIds,
      clientLastSeen,
      connectedClientIds: new Set(),
      now: 10_000,
      retentionMs: RETENTION_MS,
    });

    expect(removed).toBe(0);
    expect(lastMutationIds).toEqual({ untracked: 3 });
    expect(clientLastSeen).toEqual({ untracked: 10_000 });
  });

  test("drops a recorded time that has no mutation number", () => {
    const lastMutationIds = {};
    const clientLastSeen = { orphan: 9999 };

    pruneForgottenClients({
      lastMutationIds,
      clientLastSeen,
      connectedClientIds: new Set(),
      now: 10_000,
      retentionMs: RETENTION_MS,
    });

    expect(clientLastSeen).toEqual({} as never);
  });
});
