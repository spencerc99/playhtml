// ABOUTME: Verifies generic realtime presence room state and batching policy.
// ABOUTME: Keeps cursor coalescing testable without a Durable Object runtime.
import { describe, expect, it } from "bun:test";
import {
  applyPresenceClientMessage,
  consumePresenceMessageBudget,
  createPresenceMessageBudgetState,
  createPresenceSyncMessage,
  createPresenceRoomState,
  recordPresenceClear,
  recordPresenceRemoval,
  recordPresenceUpdate,
  restorePresenceConnectionChannels,
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

  it("caps channel count per connection", () => {
    const state = createPresenceRoomState();

    for (let i = 0; i < 32; i++) {
      recordPresenceUpdate(state, "conn-1", `channel-${i}`, i);
    }

    expect(() =>
      recordPresenceUpdate(state, "conn-1", "channel-32", "extra"),
    ).toThrow("Presence channel limit exceeded");
  });

  it("restores persisted connection channels without rebroadcasting them", () => {
    const state = createPresenceRoomState();

    restorePresenceConnectionChannels(state, "conn-1", {
      identity: {
        publicKey: "pk_1",
        playerStyle: { colorPalette: ["red"] },
      },
      cursor: latestCursor,
    });
    recordPresenceClear(state, "conn-1", "cursor");

    expect(takePresenceChanges(state)).toEqual({
      type: "presence-changes",
      updates: {},
      removes: {
        "conn-1": ["cursor"],
      },
    });
  });

  it("accepts cursor messages at the frame budget", () => {
    const state = createPresenceMessageBudgetState();
    for (let i = 0; i < 90; i++) {
      expect(
        consumePresenceMessageBudget(
          state,
          "conn-1",
          {
            type: "presence-update",
            channel: "cursor",
            value: { cursor: { x: i, y: i, pointer: "mouse" } },
          },
          1000,
        ),
      ).toEqual({ accepted: true });
    }

    expect(
      consumePresenceMessageBudget(
        state,
        "conn-1",
        {
          type: "presence-update",
          channel: "cursor",
          value: { cursor: { x: 91, y: 91, pointer: "mouse" } },
        },
        1000,
      ),
    ).toEqual({ accepted: false, channel: "cursor", hz: 90 });
  });

  it("keeps event-channel budgets separate from cursor frame traffic", () => {
    const state = createPresenceMessageBudgetState();
    for (let i = 0; i < 90; i++) {
      consumePresenceMessageBudget(
        state,
        "conn-1",
        {
          type: "presence-update",
          channel: "cursor",
          value: { cursor: { x: i, y: i, pointer: "mouse" } },
        },
        1000,
      );
    }

    expect(
      consumePresenceMessageBudget(
        state,
        "conn-1",
        {
          type: "presence-update",
          channel: "message",
          value: "still accepted",
        },
        1000,
      ),
    ).toEqual({ accepted: true });
  });

  it("resets message budgets after the window elapses", () => {
    const state = createPresenceMessageBudgetState();
    for (let i = 0; i < 10; i++) {
      consumePresenceMessageBudget(
        state,
        "conn-1",
        { type: "presence-ping" },
        1000,
      );
    }

    expect(
      consumePresenceMessageBudget(
        state,
        "conn-1",
        { type: "presence-ping" },
        1000,
      ),
    ).toEqual({ accepted: false, channel: "control", hz: 10 });

    expect(
      consumePresenceMessageBudget(
        state,
        "conn-1",
        { type: "presence-ping" },
        2000,
      ),
    ).toEqual({ accepted: true });
  });
});
