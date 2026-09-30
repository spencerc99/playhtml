// ABOUTME: Hosts version 2 PlayHTML rooms with server-ordered JSON operations.
// ABOUTME: Hydrates, sequences, broadcasts, and persists snapshots while retaining presence.

import { env } from "cloudflare:workers";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import { getServerByName } from "partyserver";
import {
  PROTOCOL_VERSION,
  type ClientOperationMessage,
  type Operation,
  type OperationRejectionCode,
  type RoomSnapshot,
  type SequencedOperation,
  type ServerOperationMessage,
  type ServerOperationRejectedMessage,
  type ServerSnapshotMessage,
} from "@playhtml/common";
import {
  applyOperationInPlace,
  checkSnapshotIntegrity,
} from "../packages/common/src/protocol/engine";
import { supabase } from "./db";
import { convertDocumentToSnapshot } from "./convert";
import {
  DEFAULT_SUPABASE_LOAD_ATTEMPTS,
  DEFAULT_SUPABASE_LOAD_RETRY_DELAY_MS,
  DEFAULT_SUPABASE_LOAD_TIMEOUT_MS,
  DEFAULT_V2_AUTOSAVE_DEBOUNCE_MS,
  DEFAULT_V2_AUTOSAVE_MAX_WAIT_MS,
  DEFAULT_V2_DOCUMENT_WARNING_BYTES,
  DEFAULT_V2_MAX_OPERATION_BYTES,
  DEFAULT_SUBSCRIBER_LEASE_MS,
} from "./const";
import { getErrorMessage, retryWithinTimeout } from "./persistenceMode";
import { PresenceServer } from "./presenceServer";
import { getBridgeAuthFailure } from "./bridgeAuth";
import {
  V2_BRIDGE_STORAGE_KEYS,
  createBridge2Request,
  extractBridge2Snapshot,
  isBridge2Request,
  mergeBridge2Snapshot,
  pruneBridge2Leases,
  type Bridge2ApplyResponse,
  type Bridge2ConsumerOperationRequest,
  type Bridge2ForwardOperationRequest,
  type Bridge2PermissionMap,
  type Bridge2Reference,
  type Bridge2SubscribeRequest,
  type Bridge2SubscribeResponse,
  type Bridge2Subscriber,
} from "./bridge2";
import {
  getSourceRoomId,
  parseSharedElementsFromUrl,
  parseSharedReferencesFromUrl,
} from "./sharing";

type PersistedRoomDocument = {
  snapshot: RoomSnapshot;
  sequence: number;
  generation: number;
};

type DocumentsRow = {
  document: string | null;
  document_json: unknown;
  protocol_version: number;
};

const EMPTY_SNAPSHOT: RoomSnapshot = {
  state: {},
  arrays: [],
  lastMutationIds: {},
};

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = (env as unknown as Record<string, string | undefined>)[name];
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  console.warn(
    `[PartyServerV2] Ignoring invalid numeric env ${name}=${value}; using ${fallback}`,
  );
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isProtocolOperation(value: unknown): value is Operation {
  if (!isRecord(value)) return false;
  if (
    value.type !== "set" &&
    value.type !== "insert" &&
    value.type !== "remove" &&
    value.type !== "increment"
  ) {
    return false;
  }
  return (
    typeof value.capability === "string" &&
    typeof value.elementId === "string" &&
    Array.isArray(value.path)
  );
}

function isOperationMessage(value: unknown): value is ClientOperationMessage {
  return (
    isRecord(value) &&
    value.type === "operation" &&
    typeof value.clientId === "string" &&
    value.clientId.length > 0 &&
    Number.isSafeInteger(value.mutationId) &&
    (value.mutationId as number) >= 1 &&
    isSafeNonNegativeInteger(value.generation) &&
    isProtocolOperation(value.operation)
  );
}

function parsePersistedDocument(value: unknown): PersistedRoomDocument {
  if (!isRecord(value))
    throw new Error("Persisted v2 document must be an object");
  if (
    !isSafeNonNegativeInteger(value.sequence) ||
    !isSafeNonNegativeInteger(value.generation) ||
    !isRecord(value.snapshot)
  ) {
    throw new Error("Persisted v2 document metadata is invalid");
  }

  const snapshot = value.snapshot as RoomSnapshot;
  const integrity = checkSnapshotIntegrity(snapshot);
  if (!integrity.ok) {
    throw new Error(`Persisted v2 snapshot is invalid: ${integrity.message}`);
  }
  if (!isRecord(snapshot.lastMutationIds)) {
    throw new Error("Persisted v2 mutation metadata is invalid");
  }
  for (const mutationId of Object.values(snapshot.lastMutationIds)) {
    if (!Number.isSafeInteger(mutationId) || mutationId < 1) {
      throw new Error("Persisted v2 mutation metadata is invalid");
    }
  }

  return {
    snapshot,
    sequence: value.sequence,
    generation: value.generation,
  };
}

export class PartyServerV2 extends PresenceServer {
  static override options = {
    hibernate: true,
  };

  private snapshot: RoomSnapshot = structuredClone(EMPTY_SNAPSHOT);
  private sequence = 0;
  private generation = 0;
  private hydrated = false;
  private transient = false;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private dirty = false;
  private savePromise: Promise<void> | null = null;
  private hasWarnedDocumentSize = false;
  private bridgeForwardPromise: Promise<void> = Promise.resolve();

  override async onStart(): Promise<void> {
    await this.hydrate();
  }

  override async onConnect(
    connection: Connection,
    ctx: ConnectionContext,
  ): Promise<void> {
    await this.registerBridgeDeclarations(ctx.request.url);
    await super.onConnect(connection, ctx);
    connection.send(JSON.stringify(this.createSnapshotMessage()));
  }

  override async onMessage(
    connection: Connection,
    message: WSMessage,
  ): Promise<void> {
    if (typeof message !== "string") {
      await super.onMessage(connection, message);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      await super.onMessage(connection, message);
      return;
    }

    if (!isRecord(parsed)) {
      await super.onMessage(connection, message);
      return;
    }

    if (parsed.type === "snapshot-request") {
      this.handleSnapshotRequest(connection, parsed);
      return;
    }

    if (parsed.type !== "operation") {
      await super.onMessage(connection, message);
      return;
    }

    await this.handleOperationMessage(connection, parsed);
  }

  override async onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    await super.onClose(connection, code, reason, wasClean);
    const hasOtherConnections = Array.from(this.getConnections()).some(
      (candidate) => candidate.id !== connection.id,
    );
    if (!hasOtherConnections) {
      try {
        await this.flushAutosave();
      } catch (error) {
        console.error(
          `[PartyServerV2] SUPABASE AUTOSAVE FAILED on last disconnect for room=${this.name}:`,
          error,
        );
      }
    }
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    // Every v2 room HTTP endpoint is a room-to-room bridge call, and the
    // Worker routes /parties/v2/<room> publicly, so authenticate before parsing.
    const bridgeAuthFailure = getBridgeAuthFailure(
      request,
      env.PARTYKIT_BRIDGE_SECRET,
    );
    if (bridgeAuthFailure) return bridgeAuthFailure;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    if (!isBridge2Request(body)) {
      return new Response("Bad Request", { status: 400 });
    }

    if (body.action === "bridge2-subscribe") {
      return this.handleBridgeSubscribe(body);
    }
    if (body.action === "bridge2-forward-operation") {
      return this.handleForwardedBridgeOperation(body);
    }
    return this.handleBridgeConsumerOperation(body);
  }

  override async onAlarm(): Promise<void> {
    await this.pruneBridgeLeases();
    await this.scheduleBridgeAlarm();
  }

  private async registerBridgeDeclarations(url: string): Promise<void> {
    if (!this.hydrated || this.transient) return;

    const sharedElements = parseSharedElementsFromUrl(url);
    if (sharedElements.length > 0) {
      const permissions: Bridge2PermissionMap = {};
      for (const element of sharedElements) {
        if (!element.elementId) continue;
        permissions[element.elementId] = element.permissions?.includes(
          "read-only",
        )
          ? "read-only"
          : "read-write";
      }
      await this.setBridgePermissions(permissions);
    }

    const references = parseSharedReferencesFromUrl(url);
    if (references.length === 0) return;
    const bySource = new Map<string, Set<string>>();
    for (const reference of references) {
      const sourceRoomId = getSourceRoomId(reference.domain, reference.path);
      const elementIds = bySource.get(sourceRoomId) ?? new Set<string>();
      elementIds.add(reference.elementId);
      bySource.set(sourceRoomId, elementIds);
    }

    const now = new Date().toISOString();
    const existing = await this.getBridgeReferences();
    for (const [sourceRoomId, elementIds] of bySource) {
      const reference = existing.find(
        (candidate) => candidate.sourceRoomId === sourceRoomId,
      );
      if (reference) {
        reference.elementIds = Array.from(
          new Set([...reference.elementIds, ...elementIds]),
        );
        reference.lastSeen = now;
        reference.leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS;
      } else {
        existing.push({
          sourceRoomId,
          elementIds: Array.from(elementIds),
          lastSeen: now,
          leaseMs: DEFAULT_SUBSCRIBER_LEASE_MS,
        });
      }
    }
    await this.setBridgeReferences(existing);
    await this.scheduleBridgeAlarm();
    for (const sourceRoomId of bySource.keys()) {
      const reference = existing.find(
        (candidate) => candidate.sourceRoomId === sourceRoomId,
      );
      if (reference) await this.subscribeToBridgeSource(reference);
    }
  }

  private async subscribeToBridgeSource(
    reference: Bridge2Reference,
  ): Promise<void> {
    try {
      const sourceRoom = await getServerByName(env.V2, reference.sourceRoomId);
      const request: Bridge2SubscribeRequest = {
        action: "bridge2-subscribe",
        consumerRoomId: this.name,
        elementIds: reference.elementIds,
      };
      const response = await sourceRoom.fetch(
        createBridge2Request("/subscribe", request, env.PARTYKIT_BRIDGE_SECRET),
      );
      if (!response.ok) return;
      const subscription = (await response.json()) as Bridge2SubscribeResponse;
      if (!subscription.ok) return;

      const previousSnapshot = this.snapshot;
      this.snapshot = mergeBridge2Snapshot(
        this.snapshot,
        subscription.snapshot,
        Object.keys(subscription.permissions),
      );
      const references = await this.getBridgeReferences();
      const storedReference = references.find(
        (candidate) => candidate.sourceRoomId === reference.sourceRoomId,
      );
      if (storedReference) {
        storedReference.sourceGeneration = subscription.sourceGeneration;
        storedReference.lastSourceSequence = subscription.sourceSequence;
        await this.setBridgeReferences(references);
      }
      if (JSON.stringify(previousSnapshot) !== JSON.stringify(this.snapshot)) {
        this.broadcast(JSON.stringify(this.createSnapshotMessage()));
        this.scheduleAutosave();
      }
    } catch {
      // The persisted mirror remains authoritative for the consumer while the
      // source is temporarily unavailable.
    }
  }

  private async handleBridgeSubscribe(
    request: Bridge2SubscribeRequest,
  ): Promise<Response> {
    if (!this.hydrated || this.transient) {
      return this.bridgeUnavailableResponse();
    }
    const requestedIds = Array.from(new Set(request.elementIds));
    const subscribers = await this.getBridgeSubscribers();
    const now = new Date().toISOString();
    const existing = subscribers.find(
      (subscriber) => subscriber.consumerRoomId === request.consumerRoomId,
    );
    if (existing) {
      existing.elementIds = requestedIds;
      existing.lastSeen = now;
      existing.leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS;
    } else {
      subscribers.push({
        consumerRoomId: request.consumerRoomId,
        elementIds: requestedIds,
        createdAt: now,
        lastSeen: now,
        leaseMs: DEFAULT_SUBSCRIBER_LEASE_MS,
      });
    }
    await this.setBridgeSubscribers(subscribers);
    await this.scheduleBridgeAlarm();

    const permissions = await this.getBridgePermissions();
    const filteredPermissions = Object.fromEntries(
      requestedIds
        .filter((elementId) => permissions[elementId])
        .map((elementId) => [elementId, permissions[elementId]]),
    );
    const body: Bridge2SubscribeResponse = {
      ok: true,
      sourceSequence: this.sequence,
      sourceGeneration: this.generation,
      snapshot: extractBridge2Snapshot(
        this.snapshot,
        requestedIds,
        permissions,
      ),
      permissions: filteredPermissions,
    };
    return Response.json(body);
  }

  private async handleBridgeConsumerOperation(
    request: Bridge2ConsumerOperationRequest,
  ): Promise<Response> {
    if (!this.hydrated || this.transient) {
      return this.bridgeUnavailableResponse();
    }
    const subscribers = await this.pruneBridgeLeases();
    const subscriber = subscribers.find(
      (candidate) => candidate.consumerRoomId === request.consumerRoomId,
    );
    if (
      !subscriber ||
      !isOperationMessage(request.message) ||
      !subscriber.elementIds.includes(request.message.operation.elementId)
    ) {
      return Response.json(
        {
          ok: false,
          code: "permission-denied",
          message: "Consumer is not subscribed to this shared element",
        } satisfies Bridge2ApplyResponse,
        { status: 403 },
      );
    }
    const permission = (await this.getBridgePermissions())[
      request.message.operation.elementId
    ];
    if (permission !== "read-write") {
      return Response.json(
        {
          ok: false,
          code: "permission-denied",
          message: "Shared element is read-only",
        } satisfies Bridge2ApplyResponse,
        { status: 403 },
      );
    }
    const existing =
      this.snapshot.state[request.message.operation.capability]?.[
        request.message.operation.elementId
      ];
    if (existing === undefined) {
      return Response.json(
        {
          ok: false,
          code: "invalid-operation",
          message: "Shared source element does not exist",
        } satisfies Bridge2ApplyResponse,
        { status: 422 },
      );
    }

    const lastMutationId =
      this.snapshot.lastMutationIds[request.message.clientId] ?? 0;
    if (request.message.mutationId <= lastMutationId) {
      return Response.json({
        ok: true,
        applied: false,
      } satisfies Bridge2ApplyResponse);
    }
    const result = applyOperationInPlace(
      this.snapshot,
      request.message.operation,
    );
    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          code: result.code,
          message: result.message,
        } satisfies Bridge2ApplyResponse,
        { status: 422 },
      );
    }

    this.sequence += 1;
    this.snapshot.lastMutationIds[request.message.clientId] =
      request.message.mutationId;
    const payload: SequencedOperation = {
      sequence: this.sequence,
      generation: this.generation,
      clientId: request.message.clientId,
      mutationId: request.message.mutationId,
      operation: request.message.operation,
    };
    const response: ServerOperationMessage = {
      type: "operation",
      protocolVersion: PROTOCOL_VERSION,
      payload,
    };
    this.broadcast(JSON.stringify(response));
    this.scheduleAutosave();
    await this.forwardAcceptedBridgeOperation(payload);
    return Response.json({
      ok: true,
      applied: true,
    } satisfies Bridge2ApplyResponse);
  }

  private async handleForwardedBridgeOperation(
    request: Bridge2ForwardOperationRequest,
  ): Promise<Response> {
    if (!this.hydrated || this.transient) {
      return this.bridgeUnavailableResponse();
    }
    const references = await this.getBridgeReferences();
    const reference = references.find(
      (candidate) => candidate.sourceRoomId === request.sourceRoomId,
    );
    if (
      !reference ||
      !reference.elementIds.includes(request.payload.operation.elementId)
    ) {
      return Response.json(
        {
          ok: false,
          code: "permission-denied",
          message: "Room is not subscribed to this shared element",
        } satisfies Bridge2ApplyResponse,
        { status: 403 },
      );
    }
    if (
      reference.sourceGeneration !== undefined &&
      reference.sourceGeneration !== request.sourceGeneration
    ) {
      return Response.json(
        {
          ok: false,
          code: "room-unavailable",
          message: "Shared source generation changed; resubscribe required",
        } satisfies Bridge2ApplyResponse,
        { status: 503 },
      );
    }
    if (request.sourceSequence <= (reference.lastSourceSequence ?? -1)) {
      return Response.json({
        ok: true,
        applied: false,
      } satisfies Bridge2ApplyResponse);
    }
    const result = applyOperationInPlace(
      this.snapshot,
      request.payload.operation,
    );
    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          code: result.code,
          message: result.message,
        } satisfies Bridge2ApplyResponse,
        { status: 422 },
      );
    }

    this.sequence += 1;
    this.snapshot.lastMutationIds[request.payload.clientId] =
      request.payload.mutationId;
    reference.sourceGeneration = request.sourceGeneration;
    reference.lastSourceSequence = request.sourceSequence;
    await this.setBridgeReferences(references);
    const response: ServerOperationMessage = {
      type: "operation",
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        ...request.payload,
        sequence: this.sequence,
        generation: this.generation,
      },
    };
    this.broadcast(JSON.stringify(response));
    this.scheduleAutosave();
    return Response.json({
      ok: true,
      applied: true,
    } satisfies Bridge2ApplyResponse);
  }

  private async forwardConsumerOperation(
    connection: Connection,
    reference: Bridge2Reference,
    message: ClientOperationMessage,
  ): Promise<void> {
    try {
      const sourceRoom = await getServerByName(env.V2, reference.sourceRoomId);
      const request: Bridge2ConsumerOperationRequest = {
        action: "bridge2-consumer-operation",
        consumerRoomId: this.name,
        message,
      };
      const response = await sourceRoom.fetch(
        createBridge2Request("/operation", request, env.PARTYKIT_BRIDGE_SECRET),
      );
      const result = (await response.json()) as Bridge2ApplyResponse;
      if (response.ok && result.ok) return;
      this.reject(
        connection,
        result.ok ? "room-unavailable" : result.code,
        result.ok ? "Shared source room is unavailable" : result.message,
        message.clientId,
        message.mutationId,
      );
    } catch {
      this.reject(
        connection,
        "room-unavailable",
        "Shared source room is unavailable",
        message.clientId,
        message.mutationId,
      );
    }
  }

  private async forwardAcceptedBridgeOperation(
    payload: SequencedOperation,
  ): Promise<void> {
    const run = async () => {
      const subscribers = await this.pruneBridgeLeases();
      const permissions = await this.getBridgePermissions();
      if (!permissions[payload.operation.elementId]) return;
      const targets = subscribers.filter((subscriber) =>
        subscriber.elementIds.includes(payload.operation.elementId),
      );
      await Promise.all(
        targets.map(async (subscriber) => {
          try {
            const consumerRoom = await getServerByName(
              env.V2,
              subscriber.consumerRoomId,
            );
            const request: Bridge2ForwardOperationRequest = {
              action: "bridge2-forward-operation",
              sourceRoomId: this.name,
              sourceSequence: payload.sequence,
              sourceGeneration: this.generation,
              payload,
            };
            await consumerRoom.fetch(
              createBridge2Request(
                "/forward",
                request,
                env.PARTYKIT_BRIDGE_SECRET,
              ),
            );
          } catch {
            // Subscribers retain their last mirrored state and renew later.
          }
        }),
      );
    };
    this.bridgeForwardPromise = this.bridgeForwardPromise.then(run, run);
    await this.bridgeForwardPromise;
  }

  private async findBridgeReference(
    elementId: string,
  ): Promise<Bridge2Reference | undefined> {
    return (await this.getBridgeReferences()).find((reference) =>
      reference.elementIds.includes(elementId),
    );
  }

  private bridgeUnavailableResponse(): Response {
    return Response.json(
      {
        ok: false,
        code: "room-unavailable",
        message: "Room persistence is unavailable",
      } satisfies Bridge2ApplyResponse,
      { status: 503 },
    );
  }

  // Bridge state is read on every accepted operation (the forward check), so
  // the getters memoize in memory: a Durable Object storage round-trip per op
  // stalls the room's broadcast stream, which viewers perceive as jerky
  // remote motion. Setters keep the cache coherent; the DO is the only
  // writer of its own storage.
  private bridgeSubscribersCache: Bridge2Subscriber[] | null = null;
  private bridgeReferencesCache: Bridge2Reference[] | null = null;
  private bridgePermissionsCache: Bridge2PermissionMap | null = null;

  private async getBridgeSubscribers(): Promise<Bridge2Subscriber[]> {
    this.bridgeSubscribersCache ??=
      (await this.ctx.storage.get<Bridge2Subscriber[]>(
        V2_BRIDGE_STORAGE_KEYS.subscribers,
      )) ?? [];
    return this.bridgeSubscribersCache;
  }

  private async setBridgeSubscribers(
    subscribers: Bridge2Subscriber[],
  ): Promise<void> {
    this.bridgeSubscribersCache = subscribers;
    await this.ctx.storage.put(V2_BRIDGE_STORAGE_KEYS.subscribers, subscribers);
  }

  private async getBridgeReferences(): Promise<Bridge2Reference[]> {
    this.bridgeReferencesCache ??=
      (await this.ctx.storage.get<Bridge2Reference[]>(
        V2_BRIDGE_STORAGE_KEYS.references,
      )) ?? [];
    return this.bridgeReferencesCache;
  }

  private async setBridgeReferences(
    references: Bridge2Reference[],
  ): Promise<void> {
    this.bridgeReferencesCache = references;
    await this.ctx.storage.put(V2_BRIDGE_STORAGE_KEYS.references, references);
  }

  private async getBridgePermissions(): Promise<Bridge2PermissionMap> {
    this.bridgePermissionsCache ??=
      (await this.ctx.storage.get<Bridge2PermissionMap>(
        V2_BRIDGE_STORAGE_KEYS.permissions,
      )) ?? {};
    return this.bridgePermissionsCache;
  }

  private async setBridgePermissions(
    permissions: Bridge2PermissionMap,
  ): Promise<void> {
    this.bridgePermissionsCache = permissions;
    await this.ctx.storage.put(V2_BRIDGE_STORAGE_KEYS.permissions, permissions);
  }

  private async pruneBridgeLeases(): Promise<Bridge2Subscriber[]> {
    const now = Date.now();
    const subscribers = await this.getBridgeSubscribers();
    const references = await this.getBridgeReferences();
    const liveSubscribers = pruneBridge2Leases(subscribers, now);
    const liveReferences = pruneBridge2Leases(references, now);
    if (liveSubscribers.length !== subscribers.length) {
      await this.setBridgeSubscribers(liveSubscribers);
    }
    if (liveReferences.length !== references.length) {
      await this.setBridgeReferences(liveReferences);
    }
    return liveSubscribers;
  }

  private async scheduleBridgeAlarm(): Promise<void> {
    const leases = [
      ...(await this.getBridgeSubscribers()),
      ...(await this.getBridgeReferences()),
    ];
    if (leases.length === 0) return;
    const nextExpiry = Math.min(
      ...leases.map((lease) => Date.parse(lease.lastSeen) + lease.leaseMs),
    );
    await this.ctx.storage.setAlarm(nextExpiry);
  }

  private async hydrate(): Promise<void> {
    this.hydrated = false;
    const timeoutMs = readPositiveNumberEnv(
      "SUPABASE_LOAD_TIMEOUT_MS",
      DEFAULT_SUPABASE_LOAD_TIMEOUT_MS,
    );
    const attempts = Math.max(
      1,
      Math.floor(
        readPositiveNumberEnv(
          "SUPABASE_LOAD_ATTEMPTS",
          DEFAULT_SUPABASE_LOAD_ATTEMPTS,
        ),
      ),
    );
    const retryDelayMs = readPositiveNumberEnv(
      "SUPABASE_LOAD_RETRY_DELAY_MS",
      DEFAULT_SUPABASE_LOAD_RETRY_DELAY_MS,
    );

    const result = await retryWithinTimeout(
      async (signal) => {
        const queryResult = await supabase
          .from("documents")
          .select("document, document_json, protocol_version")
          .eq("name", this.name)
          .abortSignal(signal)
          .maybeSingle();
        if (queryResult.error) throw new Error(queryResult.error.message);
        return queryResult.data as DocumentsRow | null;
      },
      {
        attempts,
        timeoutMs,
        retryDelayMs,
        errorMessage: `Supabase v2 document load timed out after ${timeoutMs}ms`,
        onRetry: ({ attempt, retryAfterMs, error }) => {
          console.warn(
            `[PartyServerV2] Supabase document load attempt ${attempt}/${attempts} failed for room=${this.name}; ` +
              `retrying in ${retryAfterMs}ms: ${getErrorMessage(error)}`,
          );
        },
      },
    ).catch((error) => {
      this.transient = true;
      console.error(
        `[PartyServerV2] SUPABASE PERSISTENCE UNAVAILABLE: room=${this.name} ` +
          `reason=${getErrorMessage(error)} Entering TRANSIENT MODE: presence remains available and operations are disabled.`,
      );
      return undefined;
    });

    if (result === undefined) return;

    this.transient = false;
    if (result === null) {
      this.hydrated = true;
      return;
    }

    try {
      if (result.protocol_version === PROTOCOL_VERSION) {
        const persisted = parsePersistedDocument(result.document_json);
        this.snapshot = persisted.snapshot;
        this.sequence = persisted.sequence;
        this.generation = persisted.generation;
      } else if (typeof result.document === "string") {
        const conversion = convertDocumentToSnapshot(result.document);
        if (!conversion.ok) throw new Error(conversion.error.message);
        this.snapshot = conversion.snapshot;
        this.sequence = 0;
        this.generation = 0;
        await this.persistDocument();
      }
      this.hydrated = true;
    } catch (error) {
      this.transient = true;
      console.error(
        `[PartyServerV2] Failed to hydrate room=${this.name}; entering transient mode: ${getErrorMessage(error)}`,
      );
    }
  }

  private handleSnapshotRequest(
    connection: Connection,
    message: Record<string, unknown>,
  ): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      this.reject(
        connection,
        "unsupported-protocol",
        "Protocol version 2 is required",
      );
      return;
    }
    connection.send(JSON.stringify(this.createSnapshotMessage()));
  }

  private async handleOperationMessage(
    connection: Connection,
    parsed: Record<string, unknown>,
  ): Promise<void> {
    const clientId =
      typeof parsed.clientId === "string" ? parsed.clientId : undefined;
    const mutationId = Number.isSafeInteger(parsed.mutationId)
      ? (parsed.mutationId as number)
      : undefined;

    if (parsed.protocolVersion !== PROTOCOL_VERSION) {
      this.reject(
        connection,
        "unsupported-protocol",
        "Protocol version 2 is required",
        clientId,
        mutationId,
      );
      return;
    }
    if (!isOperationMessage(parsed)) {
      this.reject(
        connection,
        "invalid-message",
        "Operation message is malformed",
        clientId,
        mutationId,
      );
      return;
    }
    if (!this.hydrated || this.transient) {
      this.reject(
        connection,
        "room-unavailable",
        "Room persistence is unavailable",
        parsed.clientId,
        parsed.mutationId,
      );
      return;
    }
    if (parsed.generation !== this.generation) {
      this.reject(
        connection,
        "stale-generation",
        `Operation generation ${parsed.generation} does not match room generation ${this.generation}`,
        parsed.clientId,
        parsed.mutationId,
      );
      return;
    }

    // The environment variable name was not specified by the contract; this
    // v2-specific name avoids changing the much larger v1 message limit.
    const maxOperationBytes = readPositiveNumberEnv(
      "V2_MAX_OPERATION_BYTES",
      DEFAULT_V2_MAX_OPERATION_BYTES,
    );
    const operationBytes = new TextEncoder().encode(
      JSON.stringify(parsed.operation),
    ).byteLength;
    if (operationBytes > maxOperationBytes) {
      this.reject(
        connection,
        "size-limit",
        `Operation is ${operationBytes} bytes; limit is ${maxOperationBytes} bytes`,
        parsed.clientId,
        parsed.mutationId,
      );
      return;
    }

    const sharedReference = await this.findBridgeReference(
      parsed.operation.elementId,
    );
    if (sharedReference) {
      await this.forwardConsumerOperation(connection, sharedReference, parsed);
      return;
    }

    const lastMutationId = this.snapshot.lastMutationIds[parsed.clientId] ?? 0;
    if (parsed.mutationId <= lastMutationId) return;

    const result = applyOperationInPlace(this.snapshot, parsed.operation);
    if (!result.ok) {
      this.reject(
        connection,
        result.code,
        result.message,
        parsed.clientId,
        parsed.mutationId,
      );
      return;
    }

    this.sequence += 1;
    this.snapshot.lastMutationIds[parsed.clientId] = parsed.mutationId;
    const response: ServerOperationMessage = {
      type: "operation",
      protocolVersion: PROTOCOL_VERSION,
      payload: {
        sequence: this.sequence,
        generation: this.generation,
        clientId: parsed.clientId,
        mutationId: parsed.mutationId,
        operation: parsed.operation,
      },
    };
    this.broadcast(JSON.stringify(response));
    this.scheduleAutosave();
    await this.forwardAcceptedBridgeOperation(response.payload);
  }

  private createSnapshotMessage(): ServerSnapshotMessage {
    return {
      type: "snapshot",
      protocolVersion: PROTOCOL_VERSION,
      sequence: this.sequence,
      generation: this.generation,
      snapshot: this.snapshot,
    };
  }

  private reject(
    connection: Connection,
    code: OperationRejectionCode,
    message: string,
    clientId?: string,
    mutationId?: number,
  ): void {
    const response: ServerOperationRejectedMessage = {
      type: "operation-rejected",
      protocolVersion: PROTOCOL_VERSION,
      sequence: this.sequence,
      ...(clientId === undefined ? {} : { clientId }),
      ...(mutationId === undefined ? {} : { mutationId }),
      code,
      message,
    };
    connection.send(JSON.stringify(response));
  }

  private scheduleAutosave(): void {
    if (this.transient) return;
    const now = Date.now();
    this.dirty = true;
    this.firstDirtyAt ??= now;

    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    const runAt = Math.min(
      now + DEFAULT_V2_AUTOSAVE_DEBOUNCE_MS,
      this.firstDirtyAt + DEFAULT_V2_AUTOSAVE_MAX_WAIT_MS,
    );
    this.autosaveTimer = setTimeout(
      () => {
        this.autosaveTimer = null;
        void this.flushAutosave().catch((error) => {
          console.error(
            `[PartyServerV2] SUPABASE AUTOSAVE FAILED for room=${this.name}:`,
            error,
          );
        });
      },
      Math.max(0, runAt - now),
    );
  }

  private async flushAutosave(): Promise<void> {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    if (this.transient || !this.hydrated || !this.dirty) return;
    if (this.savePromise) return this.savePromise;

    this.dirty = false;
    this.firstDirtyAt = null;
    // Sized here, once per save, rather than on every operation: the check
    // serializes the whole document.
    this.warnIfDocumentLarge();
    this.savePromise = this.persistDocument();
    try {
      await this.savePromise;
    } catch (error) {
      this.dirty = true;
      this.firstDirtyAt ??= Date.now();
      throw error;
    } finally {
      this.savePromise = null;
      if (this.dirty) this.scheduleAutosave();
    }
  }

  private async persistDocument(): Promise<void> {
    if (this.transient) return;
    const documentJson: PersistedRoomDocument = {
      snapshot: this.snapshot,
      sequence: this.sequence,
      generation: this.generation,
    };
    // The v1 `document` column is deliberately absent: the upsert leaves it
    // untouched for rollback, and resending it would re-upload the whole
    // legacy Yjs snapshot on every save.
    const { error } = await supabase.from("documents").upsert(
      {
        name: this.name,
        document_json: documentJson,
        protocol_version: PROTOCOL_VERSION,
      },
      { onConflict: "name" },
    );
    if (error) throw new Error(error.message);
  }

  private warnIfDocumentLarge(): void {
    const documentBytes = new TextEncoder().encode(
      JSON.stringify({
        snapshot: this.snapshot,
        sequence: this.sequence,
        generation: this.generation,
      }),
    ).byteLength;
    if (
      documentBytes > DEFAULT_V2_DOCUMENT_WARNING_BYTES &&
      !this.hasWarnedDocumentSize
    ) {
      this.hasWarnedDocumentSize = true;
      console.warn(
        `[PartyServerV2] Large document warning for room=${this.name}: ` +
          `documentBytes=${documentBytes}, warningThresholdBytes=${DEFAULT_V2_DOCUMENT_WARNING_BYTES}`,
      );
    } else if (documentBytes <= DEFAULT_V2_DOCUMENT_WARNING_BYTES) {
      this.hasWarnedDocumentSize = false;
    }
  }
}
