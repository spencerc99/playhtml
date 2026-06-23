// ABOUTME: Connects PlayHTML clients to generic realtime presence rooms.
// ABOUTME: Sends validated presence messages and dispatches server deltas.

import PartySocket, { type PartySocketOptions } from "partysocket";
import type {
  PlayerIdentity,
  PresenceClientMessage,
  PresenceServerMessage,
} from "@playhtml/common";
import { validatePresenceClientMessage } from "@playhtml/common";

export type PresenceSocket = {
  send(message: string): void;
  close(): void;
  addEventListener(
    event: "message",
    callback: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    event: "message",
    callback: (event: MessageEvent) => void,
  ): void;
};

export type PresenceSocketFactory = (
  options: PartySocketOptions,
) => PresenceSocket;

export type PresenceTransportOptions = {
  host: string;
  room: string;
  socketFactory?: PresenceSocketFactory;
};

export type PresenceJoinInput = {
  identity: PlayerIdentity;
  page?: string;
};

type PresenceTransportListener = (message: PresenceServerMessage) => void;

export class RealtimePresenceTransport {
  private socket: PresenceSocket;
  private listeners = new Set<PresenceTransportListener>();
  private onMessage = (event: MessageEvent) => {
    const message = parsePresenceServerMessage(event.data);
    if (!message) return;
    for (const listener of this.listeners) {
      listener(message);
    }
  };

  constructor(options: PresenceTransportOptions) {
    const socketFactory =
      options.socketFactory ??
      ((socketOptions: PartySocketOptions) => new PartySocket(socketOptions));
    this.socket = socketFactory({
      host: options.host,
      room: options.room,
      party: "presence",
    });
    this.socket.addEventListener("message", this.onMessage);
  }

  join(input: PresenceJoinInput): void {
    this.send({
      type: "presence-join",
      identity: input.identity,
      page: input.page,
    });
  }

  update(channel: string, value: unknown): void {
    this.send({
      type: "presence-update",
      channel,
      value,
    });
  }

  clear(channel: string): void {
    this.send({
      type: "presence-clear",
      channel,
    });
  }

  subscribe(listener: PresenceTransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.socket.removeEventListener("message", this.onMessage);
    this.socket.close();
    this.listeners.clear();
  }

  private send(message: PresenceClientMessage): void {
    validatePresenceClientMessage(message);
    this.socket.send(JSON.stringify(message));
  }
}

export function canUseRealtimePresenceTransport(): boolean {
  return typeof WebSocket !== "undefined";
}

function parsePresenceServerMessage(value: unknown): PresenceServerMessage | null {
  if (typeof value !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  switch (parsed.type) {
    case "presence-sync":
      return isPresenceSnapshot(parsed.peers)
        ? (parsed as PresenceServerMessage)
        : null;
    case "presence-changes":
      return isPresenceSnapshot(parsed.updates) &&
        isPresenceRemoves(parsed.removes)
        ? (parsed as PresenceServerMessage)
        : null;
    case "presence-rate":
      return typeof parsed.channel === "string" &&
        typeof parsed.hz === "number"
        ? (parsed as PresenceServerMessage)
        : null;
    case "presence-error":
      return typeof parsed.message === "string"
        ? (parsed as PresenceServerMessage)
        : null;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPresenceSnapshot(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isRecord);
}

function isPresenceRemoves(value: unknown): value is Record<string, string[]> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (channels) =>
      Array.isArray(channels) &&
      channels.every((channel) => typeof channel === "string"),
  );
}
