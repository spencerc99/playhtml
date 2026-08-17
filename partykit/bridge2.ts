// ABOUTME: Defines version 2 shared-element bridge messages and state helpers.
// ABOUTME: Keeps cross-room leases, snapshots, and forwarded operation metadata typed.

import type {
  ClientOperationMessage,
  OperationRejectionCode,
  RoomSnapshot,
  SequencedOperation,
} from "@playhtml/common";
import type { SharedElementPermissions } from "./sharing";

export const V2_BRIDGE_STORAGE_KEYS = {
  subscribers: "v2BridgeSubscribers",
  references: "v2BridgeReferences",
  permissions: "v2BridgePermissions",
} as const;

export type Bridge2Subscriber = {
  consumerRoomId: string;
  elementIds: string[];
  createdAt: string;
  lastSeen: string;
  leaseMs: number;
};

export type Bridge2Reference = {
  sourceRoomId: string;
  elementIds: string[];
  lastSeen: string;
  leaseMs: number;
  sourceGeneration?: number;
  lastSourceSequence?: number;
};

export type Bridge2PermissionMap = Record<string, SharedElementPermissions>;

export type Bridge2SubscribeRequest = {
  action: "bridge2-subscribe";
  consumerRoomId: string;
  elementIds: string[];
};

export type Bridge2SubscribeResponse = {
  ok: true;
  sourceSequence: number;
  sourceGeneration: number;
  snapshot: RoomSnapshot;
  permissions: Bridge2PermissionMap;
};

export type Bridge2ForwardOperationRequest = {
  action: "bridge2-forward-operation";
  sourceRoomId: string;
  sourceSequence: number;
  sourceGeneration: number;
  payload: SequencedOperation;
};

export type Bridge2ConsumerOperationRequest = {
  action: "bridge2-consumer-operation";
  consumerRoomId: string;
  message: ClientOperationMessage;
};

export type Bridge2ApplyResponse =
  | { ok: true; applied: boolean }
  | {
      ok: false;
      code: OperationRejectionCode;
      message: string;
    };

export type Bridge2Request =
  | Bridge2SubscribeRequest
  | Bridge2ForwardOperationRequest
  | Bridge2ConsumerOperationRequest;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isOperation = (value: unknown): boolean =>
  isRecord(value) &&
  (value.type === "set" ||
    value.type === "insert" ||
    value.type === "remove" ||
    value.type === "increment") &&
  typeof value.capability === "string" &&
  typeof value.elementId === "string" &&
  Array.isArray(value.path);

const isClientOperationMessage = (value: unknown): boolean =>
  isRecord(value) &&
  value.type === "operation" &&
  value.protocolVersion === 2 &&
  isNonNegativeInteger(value.generation) &&
  typeof value.clientId === "string" &&
  value.clientId.length > 0 &&
  isNonNegativeInteger(value.mutationId) &&
  value.mutationId > 0 &&
  isOperation(value.operation);

const isSequencedOperation = (value: unknown): boolean =>
  isRecord(value) &&
  isNonNegativeInteger(value.sequence) &&
  isNonNegativeInteger(value.generation) &&
  typeof value.clientId === "string" &&
  value.clientId.length > 0 &&
  isNonNegativeInteger(value.mutationId) &&
  value.mutationId > 0 &&
  isOperation(value.operation);

export function isBridge2Request(value: unknown): value is Bridge2Request {
  if (!isRecord(value)) return false;
  if (value.action === "bridge2-subscribe") {
    return (
      typeof value.consumerRoomId === "string" &&
      Array.isArray(value.elementIds) &&
      value.elementIds.every((elementId) => typeof elementId === "string")
    );
  }
  if (value.action === "bridge2-forward-operation") {
    return (
      typeof value.sourceRoomId === "string" &&
      isNonNegativeInteger(value.sourceSequence) &&
      value.sourceSequence > 0 &&
      isNonNegativeInteger(value.sourceGeneration) &&
      isSequencedOperation(value.payload)
    );
  }
  if (value.action === "bridge2-consumer-operation") {
    return (
      typeof value.consumerRoomId === "string" &&
      isClientOperationMessage(value.message)
    );
  }
  return false;
}

export function createBridge2Request(
  path: string,
  body: Bridge2Request,
): Request {
  return new Request(`http://internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function extractBridge2Snapshot(
  snapshot: RoomSnapshot,
  requestedElementIds: readonly string[],
  permissions: Bridge2PermissionMap,
): RoomSnapshot {
  const permittedIds = new Set(
    requestedElementIds.filter((elementId) => permissions[elementId]),
  );
  const state: RoomSnapshot["state"] = {};
  for (const [capability, elements] of Object.entries(snapshot.state)) {
    const selected = Object.fromEntries(
      Object.entries(elements).filter(([elementId]) =>
        permittedIds.has(elementId),
      ),
    );
    if (Object.keys(selected).length > 0) state[capability] = selected;
  }
  return {
    state,
    arrays: snapshot.arrays.filter((identity) =>
      permittedIds.has(identity.elementId),
    ),
    lastMutationIds: {},
  };
}

export function mergeBridge2Snapshot(
  snapshot: RoomSnapshot,
  mirrored: RoomSnapshot,
  mirroredElementIds: readonly string[],
): RoomSnapshot {
  const state = structuredClone(snapshot.state);
  const mirroredIds = new Set(mirroredElementIds);
  for (const [capability, elements] of Object.entries(state)) {
    for (const elementId of mirroredIds) delete elements[elementId];
    if (Object.keys(elements).length === 0) delete state[capability];
  }
  for (const [capability, elements] of Object.entries(mirrored.state)) {
    state[capability] ??= {};
    for (const [elementId, value] of Object.entries(elements)) {
      state[capability][elementId] = structuredClone(value);
    }
  }
  return {
    state,
    arrays: [
      ...snapshot.arrays.filter(
        (identity) => !mirroredIds.has(identity.elementId),
      ),
      ...structuredClone(mirrored.arrays),
    ],
    lastMutationIds: snapshot.lastMutationIds,
  };
}

export function pruneBridge2Leases<
  Lease extends { lastSeen: string; leaseMs: number },
>(leases: readonly Lease[], now: number): Lease[] {
  return leases.filter((lease) => {
    const lastSeen = Date.parse(lease.lastSeen);
    return Number.isFinite(lastSeen) && lastSeen + lease.leaseMs > now;
  });
}
