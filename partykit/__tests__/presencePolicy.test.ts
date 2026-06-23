// ABOUTME: Verifies generic realtime presence room state and batching policy.
// ABOUTME: Keeps cursor coalescing testable without a Durable Object runtime.
import { describe, expect, it } from "bun:test";
import {
  applyPresenceClientMessage,
  createPresenceSyncMessage,
  createPresenceRoomState,
  recordPresenceClear,
  recordPresenceRemoval,
  recordPresenceUpdate,
  takePresenceChanges,
  getPresenceSyncSnapshot,
} from "../presencePolicy";

const firstCursor = {
  cursor: { x: 1, y: 2, pointer: "mouse" },
  page: "/week/1",
  at: 100,
};

const latestCursor = {
  cursor: { x: 10, y: 20, pointer: "mouse" },
  page: "/week/1",
  at: 116,
};

describe("presence room policy", () => {
  it("coalesces repeated cursor updates from a connection to the latest value", () => {
    const state = createPresenceRoomState();

    recordPresenceUpdate(state, "conn-1", "cursor", firstCursor);
    recordPresenceUpdate(state, "conn-1", "cursor", latestCursor);

    expect(takePresenceChanges(state)).toEqual({
      type: "presence-changes",
      updates: {
        "conn-1": {
          cursor: latestCursor,
        },
      },
      removes: {},
    });
    expect(takePresenceChanges(state)).toBe(null);
  });

  it("batches non-cursor channels through the same generic path", () => {
    const state = createPresenceRoomState();

    recordPresenceUpdate(state, "conn-1", "status", { text: "here" });

    expect(takePresenceChanges(state)).toEqual({
      type: "presence-changes",
      updates: {
        "conn-1": {
          status: { text: "here" },
        },
      },
      removes: {},
    });
  });

  it("clears a single channel without removing the connection", () => {
    const state = createPresenceRoomState();

    recordPresenceUpdate(state, "conn-1", "cursor", latestCursor);
    takePresenceChanges(state);
    recordPresenceClear(state, "conn-1", "cursor");

    expect(getPresenceSyncSnapshot(state)).toEqual({});
    expect(takePresenceChanges(state)).toEqual({
      type: "presence-changes",
      updates: {},
      removes: {
        "conn-1": ["cursor"],
      },
    });
  });

  it("removes every channel for a closed connection", () => {
    const state = createPresenceRoomState();

    recordPresenceUpdate(state, "conn-1", "cursor", latestCursor);
    recordPresenceUpdate(state, "conn-1", "status", { text: "here" });
    takePresenceChanges(state);
    recordPresenceRemoval(state, "conn-1");

    expect(getPresenceSyncSnapshot(state)).toEqual({});
    expect(takePresenceChanges(state)).toEqual({
      type: "presence-changes",
      updates: {},
      removes: {
        "conn-1": ["cursor", "status"],
      },
    });
  });

  it("builds a full sync snapshot from current connection state", () => {
    const state = createPresenceRoomState();

    recordPresenceUpdate(state, "conn-1", "cursor", latestCursor);
    recordPresenceUpdate(state, "conn-2", "status", { text: "reading" });

    expect(getPresenceSyncSnapshot(state)).toEqual({
      "conn-1": {
        cursor: latestCursor,
      },
      "conn-2": {
        status: { text: "reading" },
      },
    });
  });

  it("applies join identity and page as generic presence channels", () => {
    const state = createPresenceRoomState();
    const identity = {
      publicKey: "pk_1",
      playerStyle: { colorPalette: ["red"] },
    };

    applyPresenceClientMessage(state, "conn-1", {
      type: "presence-join",
      identity,
      page: "/week/1",
    });

    expect(takePresenceChanges(state)).toEqual({
      type: "presence-changes",
      updates: {
        "conn-1": {
          identity,
          page: "/week/1",
        },
      },
      removes: {},
    });
  });

  it("creates the server sync message from the current snapshot", () => {
    const state = createPresenceRoomState();
    recordPresenceUpdate(state, "conn-1", "cursor", latestCursor);

    expect(createPresenceSyncMessage(state)).toEqual({
      type: "presence-sync",
      peers: {
        "conn-1": {
          cursor: latestCursor,
        },
      },
    });
  });
});
