// ABOUTME: Exchanges version 2 room messages over a reconnecting PartySocket.
// ABOUTME: Validates server messages and resends pending operations after reconnects.

import PartySocket, { type PartySocketOptions } from "partysocket";
import type {
  ArrayIdentity,
  ClientOperationMessage,
  ClientToServerMessage,
  JsonValue,
  Operation,
  OperationRejectionCode,
  ProtocolPath,
  RoomSnapshot,
  ServerOperationRejectedMessage,
  ServerToClientMessage,
} from "@playhtml/common";
import { PROTOCOL_VERSION } from "@playhtml/common";
import { checkSnapshotIntegrity } from "@playhtml/common";
import { pickReconnectionDelay } from "../presence-transport";

export type V2Socket = Pick<PartySocket, "readyState" | "send" | "close"> &
  Pick<EventTarget, "addEventListener" | "removeEventListener">;

type HandlerPropertySocket = V2Socket & {
  onmessage: ((event: MessageEvent) => void) | null;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
};

export type V2SocketFactory = (options: PartySocketOptions) => V2Socket;

export type V2TransportConnectOptions = {
  readonly clientId: string;
  readonly generation: number;
  readonly sharedElements?: string;
  readonly sharedReferences?: string;
};

export type V2TransportStatusEvent =
  | { readonly type: "connected" }
  | { readonly type: "disconnected" }
  | {
      readonly type: "write-rejected";
      readonly rejection: ServerOperationRejectedMessage;
    };

type MessageListener = (message: ServerToClientMessage) => void;
type StatusListener = (event: V2TransportStatusEvent) => void;

const SOCKET_OPEN_STATE = 1;
const rejectionCodes = new Set<OperationRejectionCode>([
  "invalid-message",
  "invalid-operation",
  "permission-denied",
  "room-unavailable",
  "size-limit",
  "stale-generation",
  "unsupported-protocol",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  isNonNegativeInteger(value) && value > 0;

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};

const isPath = (value: unknown): value is ProtocolPath =>
  Array.isArray(value) &&
  value.every(
    (segment) =>
      typeof segment === "string" ||
      (isRecord(segment) &&
        typeof segment.itemId === "string" &&
        Object.keys(segment).length === 1),
  );

const hasAddress = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  capability: string;
  elementId: string;
  path: ProtocolPath;
} =>
  typeof value.capability === "string" &&
  typeof value.elementId === "string" &&
  isPath(value.path);

const hasOperationValue = (value: Record<string, unknown>): boolean =>
  isJsonValue(value.value) &&
  Array.isArray(value.arrays) &&
  value.arrays.every(
    (identity) =>
      isRecord(identity) &&
      isPath(identity.path) &&
      Array.isArray(identity.itemIds) &&
      identity.itemIds.every((itemId) => typeof itemId === "string"),
  );

const isOperation = (value: unknown): value is Operation => {
  if (!isRecord(value) || !hasAddress(value)) return false;
  switch (value.type) {
    case "set":
      return hasOperationValue(value);
    case "insert":
      if (!hasOperationValue(value) || !isRecord(value.target)) return false;
      return value.target.kind === "object"
        ? typeof value.target.key === "string"
        : value.target.kind === "array" &&
            isNonNegativeInteger(value.target.index) &&
            typeof value.target.itemId === "string";
    case "remove":
      if (!isRecord(value.target)) return false;
      return value.target.kind === "object"
        ? typeof value.target.key === "string"
        : value.target.kind === "array" &&
            typeof value.target.itemId === "string";
    case "increment":
      return typeof value.delta === "number" && Number.isFinite(value.delta);
    default:
      return false;
  }
};

const isArrayIdentity = (value: unknown): value is ArrayIdentity =>
  isRecord(value) &&
  hasAddress(value) &&
  Array.isArray(value.itemIds) &&
  value.itemIds.every((itemId) => typeof itemId === "string");

const isSnapshot = (value: unknown): value is RoomSnapshot => {
  if (
    !isRecord(value) ||
    !isRecord(value.state) ||
    !Array.isArray(value.arrays) ||
    !value.arrays.every(isArrayIdentity) ||
    !isRecord(value.lastMutationIds)
  ) {
    return false;
  }
  if (
    !Object.values(value.state).every(
      (elements) =>
        isRecord(elements) && Object.values(elements).every(isJsonValue),
    ) ||
    !Object.values(value.lastMutationIds).every(isPositiveInteger)
  ) {
    return false;
  }
  return checkSnapshotIntegrity(value as unknown as RoomSnapshot).ok;
};

const isPresenceMessage = (input: unknown): boolean => {
  if (typeof input !== "string") return false;
  try {
    const value = JSON.parse(input) as unknown;
    return (
      isRecord(value) &&
      typeof value.type === "string" &&
      value.type.startsWith("presence-")
    );
  } catch {
    return false;
  }
};

export const parseServerMessage = (
  input: unknown,
): ServerToClientMessage | undefined => {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return undefined;
    }
  }
  if (
    !isRecord(value) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    typeof value.type !== "string"
  ) {
    return undefined;
  }

  if (value.type === "operation") {
    const payload = value.payload;
    if (
      !isRecord(payload) ||
      !isNonNegativeInteger(payload.sequence) ||
      !isNonNegativeInteger(payload.generation) ||
      typeof payload.clientId !== "string" ||
      !isPositiveInteger(payload.mutationId) ||
      !isOperation(payload.operation)
    ) {
      return undefined;
    }
    return value as ServerToClientMessage;
  }

  if (value.type === "snapshot") {
    if (
      !isNonNegativeInteger(value.sequence) ||
      !isNonNegativeInteger(value.generation) ||
      !isSnapshot(value.snapshot)
    ) {
      return undefined;
    }
    return value as ServerToClientMessage;
  }

  if (value.type === "operation-rejected") {
    if (
      !isNonNegativeInteger(value.sequence) ||
      typeof value.code !== "string" ||
      !rejectionCodes.has(value.code as OperationRejectionCode) ||
      typeof value.message !== "string" ||
      (value.clientId !== undefined && typeof value.clientId !== "string") ||
      (value.mutationId !== undefined && !isPositiveInteger(value.mutationId))
    ) {
      return undefined;
    }
    return value as ServerToClientMessage;
  }

  return undefined;
};

export class V2Transport {
  private socket: V2Socket | null = null;
  private socketFactory: V2SocketFactory;
  private clientId: string | null = null;
  private generation = 0;
  private hasConnected = false;
  private isConnected = false;
  private usesHandlerProperties = false;
  private pending: ClientOperationMessage[] = [];
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(socketFactory?: V2SocketFactory) {
    this.socketFactory =
      socketFactory ??
      ((options: PartySocketOptions) => new PartySocket(options));
  }

  connect(
    host: string,
    room: string,
    options: V2TransportConnectOptions,
  ): void {
    const previousSocket = this.socket;
    this.detachSocket();
    previousSocket?.close();
    this.clientId = options.clientId;
    this.generation = options.generation;
    this.hasConnected = false;
    this.pending = [];
    this.socket = this.socketFactory({
      host,
      room,
      party: "v2",
      maxEnqueuedMessages: 0,
      // Spread reconnects after a room restart instead of every client
      // retrying at PartySocket's fixed first delay.
      minReconnectionDelay: pickReconnectionDelay(),
      query: {
        ...(options.sharedElements
          ? { sharedElements: options.sharedElements }
          : {}),
        ...(options.sharedReferences
          ? { sharedReferences: options.sharedReferences }
          : {}),
      },
    });
    this.attachSocket();
  }

  send(message: ClientToServerMessage): void {
    if (message.type === "operation") this.rememberPending(message);
    this.sendIfOpen(message);
  }

  requestSnapshot(): void {
    this.sendIfOpen({
      type: "snapshot-request",
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  setGeneration(generation: number): void {
    this.generation = generation;
  }

  subscribeMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    const socket = this.socket;
    const wasConnected = this.isConnected;
    this.detachSocket();
    socket?.close();
    if (wasConnected) this.emitStatus({ type: "disconnected" });
  }

  private onMessage = (event: MessageEvent): void => {
    const message = parseServerMessage(event.data);
    if (!message) {
      // Presence rides the same room socket and has its own consumer; it is
      // not part of the v2 op protocol, so it is not an invalid message.
      if (isPresenceMessage(event.data)) return;
      console.warn("[playhtml] Ignored invalid version 2 server message");
      return;
    }

    this.reconcilePending(message);
    for (const listener of this.messageListeners) listener(message);
  };

  private onOpen = (): void => {
    const reconnecting = this.hasConnected;
    this.hasConnected = true;
    this.isConnected = true;
    if (reconnecting) this.requestSnapshot();
    for (const pending of this.pending) this.sendIfOpen(pending);
    this.emitStatus({ type: "connected" });
  };

  private onDisconnect = (): void => {
    if (!this.isConnected) return;
    this.isConnected = false;
    this.emitStatus({ type: "disconnected" });
  };

  private rememberPending(message: ClientOperationMessage): void {
    if (
      message.clientId !== this.clientId ||
      this.pending.some((pending) => pending.mutationId === message.mutationId)
    ) {
      return;
    }
    this.pending.push(message);
    this.pending.sort((left, right) => left.mutationId - right.mutationId);
  }

  private reconcilePending(message: ServerToClientMessage): void {
    if (message.type === "operation") {
      if (message.payload.clientId === this.clientId) {
        this.dropPending(message.payload.mutationId);
      }
      return;
    }

    if (message.type === "snapshot") {
      if (message.generation !== this.generation) this.pending = [];
      this.generation = message.generation;
      const confirmed = this.clientId
        ? (message.snapshot.lastMutationIds[this.clientId] ?? 0)
        : 0;
      this.pending = this.pending.filter(
        (pending) => pending.mutationId > confirmed,
      );
      return;
    }

    const pending = this.pending.find(
      (candidate) => candidate.mutationId === message.mutationId,
    );
    console.warn(
      `[playhtml] Write rejected for ${pending ? `${pending.operation.capability}/${pending.operation.elementId}` : "unknown element"} (${message.code}): ${message.message}`,
    );
    if (message.code === "stale-generation") {
      this.pending = [];
    } else if (
      message.mutationId !== undefined &&
      (message.clientId === undefined || message.clientId === this.clientId)
    ) {
      this.dropPending(message.mutationId);
    }
    this.emitStatus({ type: "write-rejected", rejection: message });
  }

  private dropPending(mutationId: number): void {
    this.pending = this.pending.filter(
      (pending) => pending.mutationId !== mutationId,
    );
  }

  private sendIfOpen(message: ClientToServerMessage): void {
    if (this.socket?.readyState !== SOCKET_OPEN_STATE) return;
    this.socket.send(JSON.stringify(message));
  }

  private emitStatus(event: V2TransportStatusEvent): void {
    for (const listener of this.statusListeners) listener(event);
  }

  private attachSocket(): void {
    if (!this.socket) return;
    if (supportsHandlerProperties(this.socket)) {
      this.socket.onmessage = this.onMessage;
      this.socket.onopen = this.onOpen;
      this.socket.onclose = this.onDisconnect;
      this.socket.onerror = this.onDisconnect;
      this.usesHandlerProperties = true;
      return;
    }
    this.socket.addEventListener("message", this.onMessage as EventListener);
    this.socket.addEventListener("open", this.onOpen);
    this.socket.addEventListener("close", this.onDisconnect);
    this.socket.addEventListener("error", this.onDisconnect);
  }

  private detachSocket(): void {
    if (!this.socket) return;
    if (this.usesHandlerProperties && supportsHandlerProperties(this.socket)) {
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
    } else {
      this.socket.removeEventListener(
        "message",
        this.onMessage as EventListener,
      );
      this.socket.removeEventListener("open", this.onOpen);
      this.socket.removeEventListener("close", this.onDisconnect);
      this.socket.removeEventListener("error", this.onDisconnect);
    }
    this.socket = null;
    this.usesHandlerProperties = false;
    this.isConnected = false;
  }
}

const supportsHandlerProperties = (
  socket: V2Socket,
): socket is HandlerPropertySocket =>
  "onmessage" in socket &&
  "onopen" in socket &&
  "onclose" in socket &&
  "onerror" in socket;
