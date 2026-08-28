// ABOUTME: Verifies optimistic version 2 client synchronization and reconciliation.
// ABOUTME: Drives client stores and reconnect transport against the shared apply engine.

import { describe, expect, it, vi } from "vitest";
import type {
  ClientOperationMessage,
  ClientToServerMessage,
  Operation,
  RoomSnapshot,
  ServerOperationMessage,
  ServerOperationRejectedMessage,
  ServerSnapshotMessage,
  ServerToClientMessage,
} from "@playhtml/common";
import { PROTOCOL_VERSION } from "@playhtml/common";
import { applyOperation, checkSnapshotIntegrity } from "@playhtml/common";
import { V2Store, type V2StoreTransport } from "../v2/store";
import {
  V2Transport,
  type V2Socket,
  type V2SocketFactory,
} from "../v2/transport";

const initialSnapshot = (): RoomSnapshot => ({
  state: {
    play: {
      first: { count: 0, items: ["base"] },
      second: { count: 0 },
    },
  },
  arrays: [
    {
      capability: "play",
      elementId: "first",
      path: ["items"],
      itemIds: ["base-item"],
    },
  ],
  lastMutationIds: {},
});

class InProcessServer {
  snapshot: RoomSnapshot;
  generation = 1;
  sequence = 0;

  constructor(snapshot: RoomSnapshot = initialSnapshot()) {
    this.snapshot = structuredClone(snapshot);
  }

  receive(message: ClientToServerMessage): ServerToClientMessage | undefined {
    if (message.type === "snapshot-request") return this.snapshotMessage();
    if (message.generation !== this.generation) {
      return {
        type: "operation-rejected",
        protocolVersion: PROTOCOL_VERSION,
        sequence: this.sequence,
        clientId: message.clientId,
        mutationId: message.mutationId,
        code: "stale-generation",
        message: "The room was reset",
      };
    }
    if (
      message.mutationId <=
      (this.snapshot.lastMutationIds[message.clientId] ?? 0)
    ) {
      return undefined;
    }

    const applied = applyOperation(this.snapshot, message.operation);
    if (!applied.ok) {
      return {
        type: "operation-rejected",
        protocolVersion: PROTOCOL_VERSION,
        sequence: this.sequence,
        clientId: message.clientId,
        mutationId: message.mutationId,
        code: applied.code,
        message: applied.message,
      };
    }
    this.sequence += 1;
    this.snapshot = {
      ...applied.snapshot,
      lastMutationIds: {
        ...applied.snapshot.lastMutationIds,
        [message.clientId]: message.mutationId,
      },
    };
    return {
      type: "operation",
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        sequence: this.sequence,
        generation: this.generation,
        clientId: message.clientId,
        mutationId: message.mutationId,
        operation: message.operation,
      },
    };
  }

  applyRemote(
    clientId: string,
    mutationId: number,
    operation: Operation,
  ): ServerOperationMessage {
    const result = this.receive({
      type: "operation",
      protocolVersion: PROTOCOL_VERSION,
      generation: this.generation,
      clientId,
      mutationId,
      operation,
    });
    if (!result || result.type !== "operation") {
      throw new Error("Remote operation was not accepted");
    }
    return result;
  }

  snapshotMessage(): ServerSnapshotMessage {
    return {
      type: "snapshot",
      protocolVersion: PROTOCOL_VERSION,
      sequence: this.sequence,
      generation: this.generation,
      snapshot: structuredClone(this.snapshot),
    };
  }
}

class StoreTransport implements V2StoreTransport {
  sent: ClientOperationMessage[] = [];
  snapshotRequests = 0;

  send(message: ClientOperationMessage): void {
    this.sent.push(message);
  }

  requestSnapshot(): void {
    this.snapshotRequests += 1;
  }
}

const createStore = (
  transport = new StoreTransport(),
  snapshot = initialSnapshot(),
) => ({
  transport,
  store: new V2Store({
    snapshot,
    generation: 1,
    transport,
    clientId: "local-client",
  }),
});

const element = <Value>(snapshot: RoomSnapshot, elementId: string): Value =>
  snapshot.state.play[elementId] as Value;

const waitForOutgoingFlush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

class FakeSocket implements V2Socket {
  readyState = WebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<EventListener>>();

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatch("open", new Event("open"));
  }

  disconnect(): void {
    this.readyState = WebSocket.CLOSED;
    this.dispatch("close", new Event("close"));
  }

  receive(message: ServerToClientMessage): void {
    this.dispatch(
      "message",
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("V2Store", () => {
  it("replaces only changed element values inside its live snapshot", () => {
    const { store } = createStore();
    const liveSnapshot = store.getSnapshot();
    const state = liveSnapshot.state;
    const capability = liveSnapshot.state.play;
    const first = liveSnapshot.state.play.first;
    const second = liveSnapshot.state.play.second;

    store.mutate<{ count: number }>("play", "second", (draft) => {
      draft.count = 1;
    });

    expect(store.getSnapshot()).toBe(liveSnapshot);
    expect(liveSnapshot.state).toBe(state);
    expect(liveSnapshot.state.play).toBe(capability);
    expect(liveSnapshot.state.play.first).toBe(first);
    expect(liveSnapshot.state.play.second).not.toBe(second);
    expect(checkSnapshotIntegrity(liveSnapshot)).toEqual({ ok: true });
  });

  it("notifies room listeners only after a multi-operation view is complete", () => {
    const { store } = createStore();
    const listener = vi.fn((value: RoomSnapshot) => {
      expect(
        element<{ count: number; items: string[] }>(value, "first"),
      ).toEqual({ count: 1, items: ["base", "added"] });
      expect(checkSnapshotIntegrity(value)).toEqual({ ok: true });
    });
    store.subscribeRoom(listener);

    store.mutate<{ count: number; items: string[] }>(
      "play",
      "first",
      (draft) => {
        draft.count = 1;
        draft.items.push("added");
      },
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("applies a mutation optimistically and retires it on its server echo", async () => {
    const server = new InProcessServer();
    const { store, transport } = createStore();

    const [message] = store.mutate<{ count: number; items: string[] }>(
      "play",
      "first",
      (draft) => {
        draft.count = 1;
      },
    );

    expect(element<{ count: number }>(store.getSnapshot(), "first").count).toBe(
      1,
    );
    expect(store.getPendingOperations()).toHaveLength(1);
    await waitForOutgoingFlush();
    const echo = server.receive(message);
    expect(echo?.type).toBe("operation");
    store.applyServerOperation((echo as ServerOperationMessage).payload);

    expect(store.getPendingOperations()).toHaveLength(0);
    expect(element<{ count: number }>(store.getSnapshot(), "first").count).toBe(
      1,
    );
    expect(transport.sent[0].mutationId).toBe(1);
  });

  it("rebases a pending array insert over an interleaved remote insert", () => {
    const server = new InProcessServer();
    const { store, transport } = createStore();

    const [local] = store.mutate<{ count: number; items: string[] }>(
      "play",
      "first",
      (draft) => {
        draft.items.push("local");
      },
    );
    const remote = server.applyRemote("remote-client", 1, {
      type: "insert",
      capability: "play",
      elementId: "first",
      path: ["items"],
      target: { kind: "array", index: 1, itemId: "remote-item" },
      value: "remote",
      arrays: [],
    });

    store.applyServerOperation(remote.payload);
    expect(
      element<{ items: string[] }>(store.getSnapshot(), "first").items,
    ).toEqual(["base", "local", "remote"]);

    const localEcho = server.receive(local);
    store.applyServerOperation((localEcho as ServerOperationMessage).payload);
    expect(
      element<{ items: string[] }>(store.getSnapshot(), "first").items,
    ).toEqual(["base", "local", "remote"]);
    expect(store.getPendingOperations()).toHaveLength(0);
  });

  it("discards confirmed operations and replays unconfirmed ones on snapshot", () => {
    const server = new InProcessServer();
    const { store, transport } = createStore();

    const [first] = store.mutate<{ count: number; items: string[] }>(
      "play",
      "first",
      (draft) => {
        draft.count = 1;
      },
    );
    store.mutate<{ count: number }>("play", "second", (draft) => {
      draft.count = 2;
    });
    server.receive(first);

    store.applyServerSnapshot(server.snapshotMessage());

    expect(
      store.getPendingOperations().map((message) => message.mutationId),
    ).toEqual([2]);
    expect(element<{ count: number }>(store.getSnapshot(), "first").count).toBe(
      1,
    );
    expect(
      element<{ count: number }>(store.getSnapshot(), "second").count,
    ).toBe(2);
  });

  it("drops a rejected operation and emits a write-rejected event", () => {
    const { store } = createStore();
    const listener = vi.fn();
    store.subscribeStatus(listener);
    const [message] = store.mutate<{ count: number }>(
      "play",
      "second",
      (draft) => {
        draft.count = 4;
      },
    );
    const rejection: ServerOperationRejectedMessage = {
      type: "operation-rejected",
      protocolVersion: PROTOCOL_VERSION,
      sequence: 0,
      clientId: store.clientId,
      mutationId: message.mutationId,
      code: "permission-denied",
      message: "Read-only element",
    };

    store.handleRejection(rejection);

    expect(store.getPendingOperations()).toHaveLength(0);
    expect(
      element<{ count: number }>(store.getSnapshot(), "second").count,
    ).toBe(0);
    expect(listener).toHaveBeenCalledWith({
      type: "write-rejected",
      rejection,
    });
  });

  it("drops all pending operations and requests a snapshot when generation is stale", () => {
    const { store, transport } = createStore();
    const [message] = store.mutate<{ count: number }>(
      "play",
      "second",
      (draft) => {
        draft.count = 8;
      },
    );

    store.handleRejection({
      type: "operation-rejected",
      protocolVersion: PROTOCOL_VERSION,
      sequence: 1,
      clientId: store.clientId,
      mutationId: message.mutationId,
      code: "stale-generation",
      message: "The room was reset",
    });

    expect(store.getPendingOperations()).toHaveLength(0);
    expect(
      element<{ count: number }>(store.getSnapshot(), "second").count,
    ).toBe(0);
    expect(transport.snapshotRequests).toBe(1);
  });

  it("only notifies subscribers whose element value changed", () => {
    const server = new InProcessServer();
    const { store } = createStore();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    store.subscribe("play", "first", firstListener);
    store.subscribe("play", "second", secondListener);

    const [local] = store.mutate<{ count: number; items: string[] }>(
      "play",
      "first",
      (draft) => {
        draft.count = 1;
      },
    );
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).not.toHaveBeenCalled();

    const remote = server.applyRemote("remote-client", 1, {
      type: "set",
      capability: "play",
      elementId: "second",
      path: ["count"],
      value: 2,
      arrays: [],
    });
    store.applyServerOperation(remote.payload);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);

    const echo = server.receive(local) as ServerOperationMessage;
    store.applyServerOperation(echo.payload);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
  });

  it("replaces only consecutive unsent sets to the same path", async () => {
    vi.useFakeTimers();
    try {
      const { store, transport } = createStore();
      const [first] = store.mutate<{ count: number }>(
        "play",
        "second",
        (draft) => {
          draft.count = 1;
        },
      );
      const [replacement] = store.mutate<{ count: number }>(
        "play",
        "second",
        (draft) => {
          draft.count = 2;
        },
      );

      expect(replacement.mutationId).toBe(first.mutationId);
      expect(store.getPendingOperations()).toEqual([replacement]);
      expect(transport.sent).toEqual([]);

      store.mutate<{ count: number; items: string[] }>(
        "play",
        "first",
        (draft) => {
          draft.count = 3;
        },
      );
      const [afterOtherPath] = store.mutate<{ count: number }>(
        "play",
        "second",
        (draft) => {
          draft.count = 4;
        },
      );
      expect(afterOtherPath.mutationId).not.toBe(first.mutationId);

      store.mutate<{ count: number }>("play", "second", (draft) => {
        draft.count += 1;
      });
      expect(store.getPendingOperations()).toHaveLength(4);

      // The queue flushes on a microtask (one send per synchronous burst).
      await Promise.resolve();
      expect(transport.sent).toEqual(store.getPendingOperations());

      const [afterFlush] = store.mutate<{ count: number }>(
        "play",
        "second",
        (draft) => {
          draft.count = 9;
        },
      );
      expect(afterFlush.mutationId).toBeGreaterThan(
        transport.sent.at(-1)?.mutationId ?? 0,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("V2Transport", () => {
  it("requests a snapshot then resends pending operations with original mutation IDs", async () => {
    const server = new InProcessServer();
    const socket = new FakeSocket();
    let socketOptions: Parameters<V2SocketFactory>[0] | undefined;
    const transport = new V2Transport((options) => {
      socketOptions = options;
      return socket;
    });
    transport.connect("example.com", "room-1", {
      clientId: "local-client",
      generation: 1,
    });
    expect(socketOptions).toMatchObject({
      host: "example.com",
      room: "room-1",
      party: "v2",
      maxEnqueuedMessages: 0,
    });
    const store = new V2Store({
      snapshot: initialSnapshot(),
      generation: 1,
      transport,
      clientId: "local-client",
    });
    transport.subscribeMessage((message) => {
      if (message.type === "operation") {
        store.applyServerOperation(message.payload);
      } else if (message.type === "snapshot") {
        store.applyServerSnapshot(message);
      } else {
        store.handleRejection(message);
      }
    });

    socket.open();
    const [first] = store.mutate<{ count: number }>(
      "play",
      "second",
      (draft) => {
        draft.count = 1;
      },
    );
    const [second] = store.mutate<{ count: number; items: string[] }>(
      "play",
      "first",
      (draft) => {
        draft.count = 2;
      },
    );
    await waitForOutgoingFlush();
    server.receive(first);
    server.receive(second);
    socket.disconnect();
    socket.sent = [];

    socket.open();

    const resent = socket.sent.map(
      (message) => JSON.parse(message) as ClientToServerMessage,
    );
    expect(resent[0]).toEqual({
      type: "snapshot-request",
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(
      resent
        .slice(1)
        .map((message) =>
          message.type === "operation" ? message.mutationId : undefined,
        ),
    ).toEqual([first.mutationId, second.mutationId]);

    for (const message of resent) {
      const response = server.receive(message);
      if (response) socket.receive(response);
    }
    expect(store.getPendingOperations()).toHaveLength(0);
    expect(
      element<{ count: number }>(store.getSnapshot(), "second").count,
    ).toBe(1);
    expect(element<{ count: number }>(store.getSnapshot(), "first").count).toBe(
      2,
    );
  });

  it("replays an operation whose store queue flushed while disconnected", async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const transport = new V2Transport(() => socket);
      transport.connect("example.com", "room-1", {
        clientId: "local-client",
        generation: 1,
      });
      socket.open();
      socket.disconnect();
      socket.sent = [];
      const store = new V2Store({
        snapshot: initialSnapshot(),
        generation: 1,
        transport,
        clientId: "local-client",
      });

      const [message] = store.mutate<{ count: number }>(
        "play",
        "second",
        (draft) => {
          draft.count = 7;
        },
      );
      // The queue flushes on a microtask; the socket is disconnected, so the
      // transport holds the operation for reconnect replay.
      await Promise.resolve();
      expect(socket.sent).toEqual([]);

      socket.open();
      const replayed = socket.sent.map(
        (value) => JSON.parse(value) as ClientToServerMessage,
      );
      expect(replayed.at(-1)).toEqual(message);
    } finally {
      vi.useRealTimers();
    }
  });
});
