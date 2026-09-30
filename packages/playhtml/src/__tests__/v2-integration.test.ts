// ABOUTME: Verifies opt-in version 2 initialization through real element handlers.
// ABOUTME: Uses an in-process operation server behind the test PartySocket.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClientToServerMessage,
  Operation,
  RoomSnapshot,
  ServerOperationMessage,
  ServerToClientMessage,
} from "@playhtml/common";
import { PROTOCOL_VERSION, applyOperation } from "@playhtml/common";
import { elementHandlers, playhtml, resetPlayHTML } from "../index";

type TestSocket = {
  options: Record<string, unknown>;
  sent: string[];
  receive(message: ServerToClientMessage): void;
};

const emptySnapshot = (): RoomSnapshot => ({
  state: {},
  arrays: [],
  lastMutationIds: {},
});

class InProcessServer {
  snapshot = emptySnapshot();
  generation = 1;
  sequence = 0;

  receive(message: ClientToServerMessage): ServerToClientMessage | undefined {
    if (message.type === "snapshot-request") return this.snapshotMessage();
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

  applyRemote(operation: Operation): ServerOperationMessage {
    const response = this.receive({
      type: "operation",
      protocolVersion: PROTOCOL_VERSION,
      generation: this.generation,
      clientId: "remote-client",
      mutationId: 1,
      operation,
    });
    if (response?.type !== "operation") {
      throw new Error("Remote operation was not accepted");
    }
    return response;
  }

  snapshotMessage(): ServerToClientMessage {
    return {
      type: "snapshot",
      protocolVersion: PROTOCOL_VERSION,
      sequence: this.sequence,
      generation: this.generation,
      snapshot: structuredClone(this.snapshot),
    };
  }
}

async function waitForV2Socket(): Promise<TestSocket> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sockets = (globalThis as any)
      .PLAYHTML_TEST_PRESENCE_SOCKETS as TestSocket[];
    const socket = sockets.find(
      (candidate) => candidate.options.party === "v2",
    );
    if (socket) return socket;
    await Promise.resolve();
  }
  throw new Error("Version 2 socket was not created");
}

function flushClientMessages(
  server: InProcessServer,
  socket: TestSocket,
  offset: number,
): number {
  const messages = socket.sent
    .slice(offset)
    .map((message) => JSON.parse(message) as ClientToServerMessage);
  for (const message of messages) {
    const response = server.receive(message);
    if (response) socket.receive(response);
  }
  return socket.sent.length;
}

const waitForOutgoingFlush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

const waitForAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

describe("playhtml version 2 integration", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    (globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  it("opts into v2 from __pv2 when no v2 option is configured", async () => {
    window.history.replaceState(null, "", "/?__pv2=localhost:2000");
    const server = new InProcessServer();
    const initialized = playhtml.init();
    const socket = await waitForV2Socket();

    socket.receive(server.snapshotMessage());
    await initialized;

    expect(socket.options).toMatchObject({
      host: "localhost:2000",
      party: "v2",
    });
    expect((globalThis as any).PLAYHTML_TEST_PROVIDERS).toEqual([]);
  });

  it("does not let __pv2 override an explicit v2 opt-in", async () => {
    window.history.replaceState(null, "", "/?__pv2=localhost:2000");

    const initialized = playhtml.init({ v2: true, host: "localhost:1999" });
    const socket = await waitForV2Socket();
    socket.receive(new InProcessServer().snapshotMessage());
    await initialized;

    expect(socket.options).toMatchObject({
      host: "localhost:1999",
      party: "v2",
    });
  });

  it("persists page data through the operation socket", async () => {
    const server = new InProcessServer();
    server.snapshot.state.__page__ = { visits: 3, board: { notes: ["a"] } };
    server.snapshot.arrays = [
      {
        capability: "__page__",
        elementId: "board",
        path: ["notes"],
        itemIds: ["note-a"],
      },
    ];
    const initialized = playhtml.init({
      v2: true,
      host: "localhost:1999",
      room: "/v2-page-data",
    });
    const socket = await waitForV2Socket();
    socket.receive(server.snapshotMessage());
    await initialized;

    const visits = playhtml.createPageData("visits", 0);
    const board = playhtml.createPageData("board", {
      notes: [] as string[],
    });
    const fresh = playhtml.createPageData("fresh", { on: false });
    const updates: number[] = [];
    visits.onUpdate((value) => updates.push(value));

    expect(visits.getData()).toBe(3);
    expect(board.getData()).toEqual({ notes: ["a"] });

    visits.setData((value) => value + 1);
    board.setData((draft) => {
      draft.notes.push("b");
    });
    await waitForOutgoingFlush();
    let sentCount = flushClientMessages(server, socket, 0);

    expect(server.snapshot.state.__page__).toEqual({
      visits: 4,
      board: { notes: ["a", "b"] },
      fresh: { on: false },
    });
    expect(updates).toContain(4);

    socket.receive(
      server.applyRemote({
        type: "set",
        capability: "__page__",
        elementId: "visits",
        path: [],
        value: 10,
        arrays: [],
      }),
    );
    await Promise.resolve();
    expect(visits.getData()).toBe(10);
    expect(updates.at(-1)).toBe(10);

    fresh.setData({ on: true });
    await waitForOutgoingFlush();
    sentCount = flushClientMessages(server, socket, sentCount);
    expect(server.snapshot.state.__page__?.fresh).toEqual({ on: true });
    expect(sentCount).toBeGreaterThan(0);
  });

  it("seeds, mutates, and renders remote operations without a Yjs provider", async () => {
    const server = new InProcessServer();
    const updateElement = vi.fn(({ element, data }) => {
      element.textContent = String(data.count);
    });
    const statusEvents: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const element = document.createElement("div");
    element.id = "v2-counter";
    element.setAttribute("can-play", "");
    (element as any).defaultData = { count: 0, entries: [] };
    (element as any).updateElement = updateElement;
    document.body.appendChild(element);

    const initialized = playhtml.init({
      v2: true,
      host: "localhost:1999",
      room: "/v2-integration",
      onStatusChange: (event) => statusEvents.push(event.type),
    });
    const socket = await waitForV2Socket();
    socket.receive(server.snapshotMessage());
    await initialized;

    expect(socket.options).toMatchObject({
      host: "localhost:1999",
      party: "v2",
    });
    expect((globalThis as any).PLAYHTML_TEST_PROVIDERS).toEqual([]);
    expect(statusEvents).toContain("connected");
    expect(server.snapshot.state["can-play"]?.["v2-counter"]).toBeUndefined();
    expect(elementHandlers.get("can-play")?.get("v2-counter")?.data).toEqual({
      count: 0,
      entries: [],
    });

    await waitForOutgoingFlush();
    let sentCount = flushClientMessages(server, socket, 0);
    expect(server.snapshot.state["can-play"]?.["v2-counter"]).toEqual({
      count: 0,
      entries: [],
    });

    const handler = elementHandlers.get("can-play")?.get("v2-counter");
    handler?.setData((draft: { count: number; entries: string[] }) => {
      draft.count += 1;
      draft.entries.push("local");
    });
    await waitForOutgoingFlush();
    sentCount = flushClientMessages(server, socket, sentCount);
    await waitForAnimationFrame();

    expect(handler?.data).toEqual({ count: 1, entries: ["local"] });
    expect(server.snapshot.state["can-play"]?.["v2-counter"]).toEqual({
      count: 1,
      entries: ["local"],
    });

    const updateCountBeforeRemote = updateElement.mock.calls.length;
    const remoteFirst = server.applyRemote({
      type: "set",
      capability: "can-play",
      elementId: "v2-counter",
      path: ["count"],
      value: 8,
      arrays: [],
    });
    const remoteSecond = server.applyRemote({
      type: "set",
      capability: "can-play",
      elementId: "v2-counter",
      path: ["count"],
      value: 9,
      arrays: [],
    });
    socket.receive(remoteFirst);
    socket.receive(remoteSecond);

    expect(updateElement).toHaveBeenCalledTimes(updateCountBeforeRemote);
    await waitForAnimationFrame();

    expect(handler?.data).toEqual({ count: 9, entries: ["local"] });
    expect(element.textContent).toBe("9");
    expect(updateElement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { count: 9, entries: ["local"] },
      }),
    );
    expect(updateElement).toHaveBeenCalledTimes(updateCountBeforeRemote + 1);

    handler?.setData((draft: { count: number; entries: string[] }) => {
      draft.count += 1;
    });
    await waitForOutgoingFlush();
    const rejected = JSON.parse(
      socket.sent.at(-1) as string,
    ) as ClientToServerMessage;
    if (rejected.type !== "operation") {
      throw new Error("Expected a client operation");
    }
    socket.receive({
      type: "operation-rejected",
      protocolVersion: PROTOCOL_VERSION,
      sequence: server.sequence,
      clientId: rejected.clientId,
      mutationId: rejected.mutationId,
      code: "permission-denied",
      message: "Read-only element",
    });
    await waitForAnimationFrame();

    expect(statusEvents).toContain("write-rejected");
    expect(handler?.data).toEqual({ count: 9, entries: ["local"] });
    expect(warn).toHaveBeenCalledWith(
      "[playhtml] Version 2 transport connected",
    );
    expect(warn).toHaveBeenCalledWith(
      "[playhtml] Version 2 write rejected (permission-denied): Read-only element",
    );
    expect(sentCount).toBeGreaterThan(0);
  });
});
