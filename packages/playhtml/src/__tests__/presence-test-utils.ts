// ABOUTME: Shared helpers for driving fake presence PartySockets in tests.
// ABOUTME: Builds presence transports, flushes publishes, and parses protocol messages.

import type { PresenceServerMessage } from "@playhtml/common";
import { PeerStore } from "../peer-store";
import type { PresenceJoinInput } from "../presence-transport";

export const cursorTestModes = [
  { cursorMode: "disabled", cursors: { enabled: false } },
  { cursorMode: "enabled", cursors: { enabled: true } },
] as const;

export type FakePresenceTransport = {
  updates: Array<{ channel: string; value: unknown }>;
  clears: string[];
  joins: PresenceJoinInput[];
  peers: PeerStore;
  join(input: PresenceJoinInput): void;
  update(channel: string, value: unknown): void;
  clear(channel: string): void;
  subscribe(listener: (message: PresenceServerMessage) => void): () => void;
  emit(message: PresenceServerMessage): void;
  destroy(): void;
};

export function createFakePresenceTransport(): FakePresenceTransport {
  const listeners = new Set<(message: PresenceServerMessage) => void>();
  const transport = {
    updates: [] as Array<{ channel: string; value: unknown }>,
    clears: [] as string[],
    joins: [] as PresenceJoinInput[],
    join(input: PresenceJoinInput) {
      this.joins.push(input);
    },
    update(channel: string, value: unknown) {
      this.updates.push({ channel, value });
    },
    clear(channel: string) {
      this.clears.push(channel);
    },
    subscribe(listener: (message: PresenceServerMessage) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(message: PresenceServerMessage) {
      for (const listener of listeners) listener(message);
    },
    destroy() {
      transport.peers.destroy();
      listeners.clear();
    },
  } as FakePresenceTransport;
  transport.peers = new PeerStore(transport);
  return transport;
}

export type FakePresenceSocket = {
  options: Record<string, unknown>;
  sent: string[];
  closed: boolean;
  readyState: number;
  open: () => void;
  receive: (data: unknown) => void;
};

export function getPresenceSockets(): FakePresenceSocket[] {
  return ((globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS ??
    []) as FakePresenceSocket[];
}

export function getPresenceSocketForRoom(room: string): FakePresenceSocket {
  const socket = getPresenceSockets().find(
    (candidate) => candidate.options.room === room && !candidate.closed,
  );
  if (!socket) {
    throw new Error(`Expected open presence socket for room ${room}`);
  }
  return socket;
}

export function sentMessages(socket: FakePresenceSocket): any[] {
  return socket.sent.map((message) => JSON.parse(message));
}

export function sentChannelUpdates(
  socket: FakePresenceSocket,
  channel: string,
): any[] {
  return sentMessages(socket)
    .filter(
      (message) =>
        message.type === "presence-update" && message.channel === channel,
    )
    .map((message) => message.value);
}

/** Like sentChannelUpdates but unwraps the page-presence {at, value} staleness
 * envelope back to the user payload, so assertions can ignore the timestamp. */
export function sentPresenceValues(
  socket: FakePresenceSocket,
  channel: string,
): any[] {
  return sentChannelUpdates(socket, channel).map((v) =>
    v && typeof v === "object" && "value" in v && "at" in v ? v.value : v,
  );
}

export function flushPresencePublishes(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
