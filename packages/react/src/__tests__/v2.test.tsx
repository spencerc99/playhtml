// ABOUTME: Verifies React shared state against playhtml's version 2 protocol.
// ABOUTME: Exercises provider initialization, local mutations, and remote updates.

import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClientToServerMessage,
  Operation,
  RoomSnapshot,
  ServerOperationMessage,
  ServerToClientMessage,
} from "@playhtml/common";
import { PROTOCOL_VERSION, applyOperation } from "@playhtml/common";

const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  closed = false;
  binaryType = "blob";
  options: Record<string, unknown>;
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    this.options = {
      host: new URL(url).host,
      party: url.includes("/parties/v2/") ? "v2" : "unknown",
    };
    if (this.options.party === "v2") {
      ((globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS ??= []).push(this);
    }
    queueMicrotask(() => this.open());
  }

  send(message: string): void {
    if (this.readyState !== 1) return;
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  open(): void {
    if (this.closed) return;
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  receive(data: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
}

vi.unmock("playhtml");

const {
  CanMoveElement,
  CanSpinElement,
  CanToggleElement,
  PlayProvider,
  withSharedState,
} = await import("../index");
const { resetPlayHTML } = await import("playhtml");
const originalWebSocket = globalThis.WebSocket;

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const sockets = (globalThis as any)
      .PLAYHTML_TEST_PRESENCE_SOCKETS as TestSocket[];
    const socket = sockets.find((candidate) => candidate.options.party === "v2");
    if (socket) return socket;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Version 2 socket was not created");
}

function flushClientMessages(
  server: InProcessServer,
  socket: TestSocket,
  offset: number,
): number {
  const messages = socket.sent.slice(offset).map(
    (message) => JSON.parse(message) as ClientToServerMessage,
  );
  for (const message of messages) {
    const response = server.receive(message);
    if (response) socket.receive(response);
  }
  return socket.sent.length;
}

describe("React version 2 integration", () => {
  beforeEach(async () => {
    await resetPlayHTML();
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    (globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
    globalThis.WebSocket = originalWebSocket;
  });

  it("renders, mutates, and receives remote operations with v2", async () => {
    const server = new InProcessServer();
    const statusEvents: string[] = [];
    const Counter = withSharedState(
      { defaultData: { count: 0 } },
      ({ data, setData }) => (
        <button
          id="react-v2-counter"
          onClick={() => {
            setData((draft) => {
              draft.count += 1;
            });
          }}
        >
          {data.count}
        </button>
      ),
    );

    render(
      <PlayProvider
        initOptions={{
          v2: true,
          host: "localhost:1999",
          room: "/react-v2",
          onStatusChange: (event) => statusEvents.push(event.type),
        }}
      >
        <Counter />
        <CanToggleElement>
          <button id="react-v2-toggle">Toggle</button>
        </CanToggleElement>
        <CanMoveElement>
          <div id="react-v2-move" />
        </CanMoveElement>
        <CanSpinElement>
          <div id="react-v2-spin" />
        </CanSpinElement>
      </PlayProvider>,
    );

    const socket = await waitForV2Socket();
    await act(async () => {
      socket.receive(server.snapshotMessage());
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "0" })).toBeInTheDocument();
      expect(statusEvents).toContain("connected");
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "[playhtml] Version 2 transport connected",
    );
    expect(socket.options).toMatchObject({
      host: "localhost:1999",
      party: "v2",
    });
    expect((globalThis as any).PLAYHTML_TEST_PROVIDERS).toEqual([]);
    const toggle = screen.getByRole("button", { name: "Toggle" });
    expect(toggle).toHaveAttribute("can-toggle");
    expect(toggle).not.toHaveClass("toggled");
    expect(document.getElementById("react-v2-move")).toHaveAttribute(
      "can-move",
    );
    expect(document.getElementById("react-v2-spin")).toHaveAttribute(
      "can-spin",
    );

    let sentCount = flushClientMessages(server, socket, 0);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveClass("toggled");
    });
    sentCount = flushClientMessages(server, socket, sentCount);
    expect(server.snapshot.state["can-toggle"]?.["react-v2-toggle"]).toEqual({
      on: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "0" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    });
    sentCount = flushClientMessages(server, socket, sentCount);
    expect(server.snapshot.state["can-play"]?.["react-v2-counter"]).toEqual({
      count: 1,
    });

    const remote = server.applyRemote({
      type: "set",
      capability: "can-play",
      elementId: "react-v2-counter",
      path: ["count"],
      value: 9,
      arrays: [],
    });
    await act(async () => {
      socket.receive(remote);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "9" })).toBeInTheDocument();
    });
    expect(sentCount).toBeGreaterThan(0);
  });
});
