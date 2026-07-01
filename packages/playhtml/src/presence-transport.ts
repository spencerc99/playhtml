// ABOUTME: Connects PlayHTML clients to generic realtime presence rooms.
// ABOUTME: Sends validated presence messages and dispatches server deltas.

import PartySocket, { type PartySocketOptions } from "partysocket";
import type {
  PlayerIdentity,
  PresenceClientMessage,
  PresenceServerMessage,
} from "@playhtml/common";
import { validatePresenceClientMessage } from "@playhtml/common";
import {
  isPresenceRecord,
  isPresenceRemoves,
  isPresenceSnapshot,
} from "./presence-utils";

export type PresenceSocket = Pick<PartySocket, "readyState" | "send" | "close"> &
  Pick<EventTarget, "addEventListener" | "removeEventListener">;

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

const SOCKET_OPEN_STATE = 1;

export class RealtimePresenceTransport {
  private socket: PresenceSocket;
  private listeners = new Set<PresenceTransportListener>();
  private latestJoin: PresenceJoinInput | null = null;
  private channelValues = new Map<string, unknown>();
  private onMessage = (event: MessageEvent) => {
    const message = parsePresenceServerMessage(event.data);
    if (!message) return;
    for (const listener of this.listeners) {
      listener(message);
    }
  };
  private onOpen = () => {
    this.flushCurrentState();
  };

  constructor(options: PresenceTransportOptions) {
    const socketFactory =
      options.socketFactory ??
      ((socketOptions: PartySocketOptions) => new PartySocket(socketOptions));
    this.socket = socketFactory({
      host: options.host,
      room: options.room,
      party: "presence",
      maxEnqueuedMessages: 0,
    });
    this.socket.addEventListener("message", this.onMessage as EventListener);
    this.socket.addEventListener("open", this.onOpen);
  }

  join(input: PresenceJoinInput): void {
    this.latestJoin = input;
    this.sendIfOpen({
      type: "presence-join",
      identity: input.identity,
      page: input.page,
    });
  }

  update(channel: string, value: unknown): void {
    this.channelValues.set(channel, value);
    this.sendIfOpen({
      type: "presence-update",
      channel,
      value,
    });
  }

  clear(channel: string): void {
    this.channelValues.delete(channel);
    this.sendIfOpen({
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
    this.socket.removeEventListener("message", this.onMessage as EventListener);
    this.socket.removeEventListener("open", this.onOpen);
    this.socket.close();
    this.listeners.clear();
  }

  private flushCurrentState(): void {
    if (this.latestJoin) {
      this.sendIfOpen({
        type: "presence-join",
        identity: this.latestJoin.identity,
        page: this.latestJoin.page,
      });
    }

    for (const [channel, value] of this.channelValues) {
      this.sendIfOpen({
        type: "presence-update",
        channel,
        value,
      });
    }
  }

  private sendIfOpen(message: PresenceClientMessage): void {
    validatePresenceClientMessage(message);
    if (!this.isSocketOpen()) return;
    this.socket.send(JSON.stringify(message));
  }

  private isSocketOpen(): boolean {
    return (
      this.socket.readyState === undefined ||
      this.socket.readyState === SOCKET_OPEN_STATE
    );
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

  if (!isPresenceRecord(parsed)) return null;
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
