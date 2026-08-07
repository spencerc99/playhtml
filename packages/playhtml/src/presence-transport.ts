// ABOUTME: Connects PlayHTML clients to generic realtime presence rooms.
// ABOUTME: Sends validated presence messages and dispatches server deltas.

import PartySocket, { type PartySocketOptions } from "partysocket";
import type {
  PlayerIdentity,
  PresenceClientMessage,
  PresenceServerMessage,
} from "@playhtml/common";
import { clonePlain, validatePresenceClientMessage } from "@playhtml/common";
import {
  isPresenceRecord,
  isPresenceRemoves,
  isPresenceSnapshot,
  safeInvoke,
} from "./presence-utils";
import { PeerStore } from "./peer-store";

export type PresenceSocket = Pick<PartySocket, "readyState" | "send" | "close"> &
  Pick<EventTarget, "addEventListener" | "removeEventListener">;

type HandlerPropertySocket = PresenceSocket & {
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
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

/** Observability only — never gates behavior. "unreachable" means the socket
 * failed to open within the grace window / retry threshold; consumers keep
 * running (empty presence) rather than falling back. */
export type PresenceConnectionState = "connecting" | "open" | "unreachable";

const SOCKET_OPEN_STATE = 1;
// After this many failed reconnects, or this long without a single open, log one
// loud error that realtime presence is degraded. Kept generous so a normal slow
// connect doesn't trip it.
const UNREACHABLE_RECONNECT_THRESHOLD = 3;
const UNREACHABLE_GRACE_MS = 15_000;
// Rate-limit per-event-type control logging so a reconnect/reject loop can't
// spam the console (one line per event type per window).
const CONTROL_LOG_WINDOW_MS = 5_000;

export class RealtimePresenceTransport {
  private socket: PresenceSocket;
  private room: string;
  private listeners = new Set<PresenceTransportListener>();
  private latestJoin: PresenceJoinInput | null = null;
  private channelValues = new Map<string, unknown>();
  // One peer-folding layer per socket, shared by every consumer (cursors,
  // element awareness, page presence). It subscribes to this transport's raw
  // message stream and exposes per-namespace subscriptions + the folded peers.
  readonly peers: PeerStore;
  // Observability state (see PresenceConnectionState). Internal, for tests/debug.
  private _connectionState: PresenceConnectionState = "connecting";
  private hasEverOpened = false;
  private failedReconnects = 0;
  private unreachableLogged = false;
  private unreachableTimer: ReturnType<typeof setTimeout> | null = null;
  private lastControlLogAt = new Map<string, number>();
  private usesHandlerProperties = false;
  private onMessage = (event: MessageEvent) => {
    const message = parsePresenceServerMessage(event.data);
    if (!message) return;
    this.handleControlMessage(message);
    for (const listener of this.listeners) {
      // Isolate a throwing listener so one consumer can't skip the rest of the
      // fan-out on this shared socket.
      safeInvoke(() => listener(message), "presence transport listener");
    }
  };
  private onOpen = () => {
    this._connectionState = "open";
    this.hasEverOpened = true;
    this.failedReconnects = 0;
    this.unreachableLogged = false;
    if (this.unreachableTimer !== null) {
      clearTimeout(this.unreachableTimer);
      this.unreachableTimer = null;
    }
    this.flushCurrentState();
  };
  private onCloseOrError = () => {
    // PartySocket retries silently forever. Track failures so a never-opening
    // socket surfaces ONE loud error instead of an invisible dead transport.
    if (this._connectionState !== "open") this.failedReconnects += 1;
    if (this._connectionState !== "unreachable") {
      this._connectionState = "connecting";
    }
    if (this.failedReconnects >= UNREACHABLE_RECONNECT_THRESHOLD) {
      this.markUnreachable();
    }
  };

  constructor(options: PresenceTransportOptions) {
    this.room = options.room;
    const socketFactory =
      options.socketFactory ??
      ((socketOptions: PartySocketOptions) => new PartySocket(socketOptions));
    this.socket = socketFactory({
      host: options.host,
      room: options.room,
      party: "presence",
      maxEnqueuedMessages: 0,
    });
    if (supportsHandlerProperties(this.socket)) {
      this.socket.onmessage = this.onMessage;
      this.socket.onopen = this.onOpen;
      this.socket.onclose = this.onCloseOrError;
      this.socket.onerror = this.onCloseOrError;
      this.usesHandlerProperties = true;
    } else {
      this.socket.addEventListener("message", this.onMessage as EventListener);
      this.socket.addEventListener("open", this.onOpen);
      this.socket.addEventListener("close", this.onCloseOrError);
      this.socket.addEventListener("error", this.onCloseOrError);
    }
    // Grace window: if the socket never opens at all, flag it once.
    this.unreachableTimer = setTimeout(() => {
      this.unreachableTimer = null;
      if (!this.hasEverOpened) this.markUnreachable();
    }, UNREACHABLE_GRACE_MS);
    this.peers = new PeerStore(this);
  }

  /** Observability flag: whether the realtime socket is connecting, open, or
   * has been declared unreachable. Never gates behavior — for tests/debugging. */
  get connectionState(): PresenceConnectionState {
    return this._connectionState;
  }

  private markUnreachable(): void {
    if (this.unreachableLogged) return;
    this.unreachableLogged = true;
    this._connectionState = "unreachable";
    console.error(
      `[playhtml] presence transport unreachable — realtime presence degraded (room ${this.room}). ` +
        `Cursors, element awareness, and custom presence will not sync until the connection recovers.`,
    );
  }

  /**
   * Base handling of server control messages, on EVERY socket (not just the
   * cursor client's). Consumers still layer their own reactions (e.g. the cursor
   * client's hz pacing) via subscribe(); this only guarantees rejections, the
   * channel cap, and force-close loops are never fully silent. Logging is
   * rate-limited per event type so a loop can't spam the console.
   */
  private handleControlMessage(message: PresenceServerMessage): void {
    if (message.type === "presence-error") {
      this.logControl("presence-error", () =>
        console.warn(
          `[playhtml] presence server rejected a message (room ${this.room}):`,
          message.message,
        ),
      );
    } else if (message.type === "presence-rate") {
      this.logControl("presence-rate", () =>
        console.warn(
          `[playhtml] presence channel "${message.channel}" is rate-limited to ${message.hz}Hz (room ${this.room}).`,
        ),
      );
    }
  }

  private logControl(key: string, log: () => void): void {
    const now = Date.now();
    const last = this.lastControlLogAt.get(key) ?? 0;
    if (now - last < CONTROL_LOG_WINDOW_MS) return;
    this.lastControlLogAt.set(key, now);
    log();
  }

  join(input: PresenceJoinInput): void {
    const snapshot = clonePlain(input);
    const message = {
      type: "presence-join",
      identity: snapshot.identity,
      page: snapshot.page,
    } satisfies PresenceClientMessage;
    validatePresenceClientMessage(message);
    // latestJoin is replayed verbatim on every reconnect. On a fixed-custom-room
    // SPA app the room (and thus this socket) does not change across in-app
    // navigations, so join() may not be called again and latestJoin.page can go
    // stale server-side until the next explicit join. Page-scoped rooms don't
    // hit this (a new room rebuilds the socket, which re-joins with the new page).
    this.latestJoin = snapshot;
    this.sendIfOpen(message);
  }

  update(channel: string, value: unknown): void {
    const snapshot = clonePlain(value);
    const message = {
      type: "presence-update",
      channel,
      value: snapshot,
    } satisfies PresenceClientMessage;
    validatePresenceClientMessage(message);
    this.channelValues.set(channel, snapshot);
    this.sendIfOpen(message);
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
    if (this.unreachableTimer !== null) {
      clearTimeout(this.unreachableTimer);
      this.unreachableTimer = null;
    }
    this.peers.destroy();
    if (
      this.usesHandlerProperties &&
      supportsHandlerProperties(this.socket)
    ) {
      if (this.socket.onmessage === this.onMessage) {
        this.socket.onmessage = null;
      }
      if (this.socket.onopen === this.onOpen) {
        this.socket.onopen = null;
      }
      if (this.socket.onclose === this.onCloseOrError) {
        this.socket.onclose = null;
      }
      if (this.socket.onerror === this.onCloseOrError) {
        this.socket.onerror = null;
      }
    } else {
      this.socket.removeEventListener(
        "message",
        this.onMessage as EventListener,
      );
      this.socket.removeEventListener("open", this.onOpen);
      this.socket.removeEventListener("close", this.onCloseOrError);
      this.socket.removeEventListener("error", this.onCloseOrError);
    }
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

function supportsHandlerProperties(
  socket: PresenceSocket,
): socket is HandlerPropertySocket {
  return (
    "onmessage" in socket &&
    "onopen" in socket &&
    "onclose" in socket &&
    "onerror" in socket
  );
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
