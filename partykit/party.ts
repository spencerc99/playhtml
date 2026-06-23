// ABOUTME: Hosts the playhtml PartyServer Durable Object for Yjs sync and room-to-room sharing.
// ABOUTME: Persists room documents, coordinates shared element bridges, and handles admin operations.
import type * as Party from "partyserver";
import { getServerByName, routePartykitRequest } from "partyserver";
import { YServer } from "y-partyserver";
import { syncedStore, getYjsValue } from "@syncedstore/core";
import { deepReplaceIntoProxy } from "@playhtml/common";
import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { supabase } from "./db";
import { AdminHandler } from "./admin";
import {
  docToJson,
  jsonToDoc,
  encodeDocToBase64,
  replaceDocFromSnapshot,
  setDocResetEpoch,
  getDocResetEpoch,
} from "./docUtils";
import {
  STORAGE_KEYS,
  DEFAULT_EMPTY_ROOM_COMPACT_DELAY_MS,
  DEFAULT_EMERGENCY_COMPACT_CHECK_BYTES,
  DEFAULT_EMERGENCY_COMPACT_RECHECK_DELAY_MS,
  DEFAULT_DOCUMENT_WARNING_BYTES,
  DEFAULT_MAX_REQUEST_BYTES,
  DEFAULT_MESSAGE_RATE_LIMIT,
  DEFAULT_MESSAGE_RATE_WINDOW_MS,
  DEFAULT_SUPABASE_LOAD_TIMEOUT_MS,
  DEFAULT_PRUNE_INTERVAL_MS,
  DEFAULT_SUBSCRIBER_LEASE_MS,
  ORIGIN_S2C,
  ORIGIN_C2S,
  Subscriber,
  SharedRefEntry,
  ensureExists,
} from "./const";
import {
  SubscribeRequest,
  ApplySubtreesImmediateRequest,
  SubscribeResponse,
  ExportPermissionsResponse,
  ApplySubtreesResponse,
  isSubscribeRequest,
  isExportPermissionsRequest,
  isApplySubtreesImmediateRequest,
} from "./request";
import {
  checkMessageRate,
  isDurableObjectOverloadError,
  shouldAcceptRequestBody,
  shouldWarnForDocumentSize,
  type MessageLimitState,
  type ServerLimits,
} from "./serverLimits";
import {
  getSourceRoomId,
  parseSharedElementsFromUrl,
  parseSharedReferencesFromUrl,
  SharedElementPermissions,
} from "./sharing";
import {
  getNextAlarmTime,
  isCompactionAutosave,
  shouldCheckEmergencyCompaction,
  shouldUseEmergencyCompactedDocument,
  shouldStoreCompactedDocument,
} from "./compactionPolicy";
import { isResetEpochStale, parseClientResetEpoch } from "./resetEpochPolicy";
import {
  createPersistenceUnavailableResponse,
  formatPersistenceFailureLog,
  getErrorMessage,
  withTimeout,
  type PersistenceMode,
} from "./persistenceMode";
import { getConnectionCloseDiagnostic } from "./connectionDiagnostics";
export { PresenceServer } from "./presenceServer";

const ACCEPTED_RESET_EPOCH_STATE_KEY = "__playhtmlAcceptedResetEpoch";
const MESSAGE_LIMIT_STATE_KEY = "__playhtmlMessageLimit";
const CONNECTION_OPENED_AT_STATE_KEY = "__playhtmlConnectionOpenedAt";

type PartyServerConnectionState = Record<string, unknown> & {
  [ACCEPTED_RESET_EPOCH_STATE_KEY]?: number | null;
  [MESSAGE_LIMIT_STATE_KEY]?: MessageLimitState;
  [CONNECTION_OPENED_AT_STATE_KEY]?: number;
};

type CompactedDocument = {
  base64: string;
  beforeSize: number;
  afterSize: number;
  resetEpoch: number;
};

type CommitCompactedDocumentOptions = {
  compactedDocument: CompactedDocument;
  beforeCommit?: () => Promise<boolean>;
  afterReplace?: () => Promise<void>;
};

// Build a JSON POST request for room-to-room (DO-to-DO) RPC.
// The URL is synthetic — the target server's onRequest reads the body, not the path.
function internalRequest(path: string, body: unknown): Request {
  return new Request(`http://internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = (env as unknown as Record<string, string | undefined>)[name];
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn(
    `[PartyServer] Ignoring invalid numeric env ${name}=${value}; using ${fallback}`
  );
  return fallback;
}

export class PartyServer extends YServer {
  static options = {
    hibernate: true,
  };

  // Public flag to pause autosave during administrative resets
  // This prevents the server from overwriting the clean DB state with
  // in-memory state while we are performing a reset.
  public isSkippingSave = false;
  private emptyRoomCompactionPromise: Promise<void> | null = null;
  private compactionAutosaveSnapshot: string | null = null;
  private cachedResetEpoch: number | null | undefined;
  private lastKnownDocumentBytes = 0;
  private hasWarnedDocumentSize = false;

  // In-memory caches for hot-path data that rarely changes.
  // Invalidated on writes via the set* methods.
  private cachedSubscribers: Subscriber[] | null = null;
  private cachedSharedRefs: SharedRefEntry[] | null = null;
  private cachedSharedPerms: Record<string, SharedElementPermissions> | null =
    null;
  private persistenceMode: PersistenceMode = { kind: "available" };

  // Pending bridge flush timer — batches bridge fan-out across rapid updates
  private bridgeFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly BRIDGE_DEBOUNCE_MS = 500;

  // Preserve the same debounce timing as the old y-partykit callback config
  static callbackOptions = {
    debounceWait: 3000,
    debounceMaxWait: 15000,
  };

  private observersAttached = false;
  private adminHandler = new AdminHandler(this);

  override async onStart(): Promise<void> {
    await super.onStart();
    await this.attachImmediateBridgeObservers();
  }

  async getSubscribers(): Promise<Subscriber[]> {
    if (this.cachedSubscribers !== null) return this.cachedSubscribers;
    const subs =
      ((await this.ctx.storage.get(STORAGE_KEYS.subscribers)) as
        | Subscriber[]
        | undefined) || [];
    this.cachedSubscribers = subs;
    return subs;
  }

  async setSubscribers(subscribers: Subscriber[]): Promise<void> {
    this.cachedSubscribers = subscribers;
    await this.ctx.storage.put(STORAGE_KEYS.subscribers, subscribers);
  }

  async getSharedReferences(): Promise<SharedRefEntry[]> {
    if (this.cachedSharedRefs !== null) return this.cachedSharedRefs;
    const refs =
      ((await this.ctx.storage.get(STORAGE_KEYS.sharedReferences)) as
        | SharedRefEntry[]
        | undefined) || [];
    this.cachedSharedRefs = refs;
    return refs;
  }

  async setSharedReferences(references: SharedRefEntry[]): Promise<void> {
    this.cachedSharedRefs = references;
    await this.ctx.storage.put(STORAGE_KEYS.sharedReferences, references);
  }

  async getSharedPermissions(): Promise<
    Record<string, SharedElementPermissions>
  > {
    if (this.cachedSharedPerms !== null) return this.cachedSharedPerms;
    const perms =
      ((await this.ctx.storage.get(STORAGE_KEYS.sharedPermissions)) as
        | Record<string, SharedElementPermissions>
        | undefined) || {};
    this.cachedSharedPerms = perms;
    return perms;
  }

  async setSharedPermissions(
    permissions: Record<string, SharedElementPermissions>
  ): Promise<void> {
    this.cachedSharedPerms = permissions;
    await this.ctx.storage.put(STORAGE_KEYS.sharedPermissions, permissions);
  }

  private getOpenConnectionCount(): number {
    return Array.from(this.getConnections()).length;
  }

  private async getEmptyRoomCompactAfter(): Promise<number | null> {
    const value = await this.ctx.storage.get(STORAGE_KEYS.emptyRoomCompactAfter);
    return typeof value === "number" ? value : null;
  }

  private async setEmptyRoomCompactAfter(timestamp: number): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEYS.emptyRoomCompactAfter, timestamp);
  }

  private async clearEmptyRoomCompactAfter(): Promise<void> {
    await this.ctx.storage.delete(STORAGE_KEYS.emptyRoomCompactAfter);
  }

  private async getEmergencyCompactCheckAfter(): Promise<number | null> {
    const value = await this.ctx.storage.get(
      STORAGE_KEYS.emergencyCompactCheckAfter
    );
    return typeof value === "number" ? value : null;
  }

  private async setEmergencyCompactCheckAfter(
    timestamp: number
  ): Promise<void> {
    await this.ctx.storage.put(
      STORAGE_KEYS.emergencyCompactCheckAfter,
      timestamp
    );
  }

  private getEmergencyCompactCheckBytes(): number {
    return readPositiveNumberEnv(
      "EMERGENCY_COMPACT_CHECK_BYTES",
      DEFAULT_EMERGENCY_COMPACT_CHECK_BYTES
    );
  }

  private getEmergencyCompactRecheckDelayMs(): number {
    return readPositiveNumberEnv(
      "EMERGENCY_COMPACT_RECHECK_DELAY_MS",
      DEFAULT_EMERGENCY_COMPACT_RECHECK_DELAY_MS
    );
  }

  private getServerLimits(): ServerLimits {
    return {
      maxMessagesPerWindow: readPositiveNumberEnv(
        "MESSAGE_RATE_LIMIT",
        DEFAULT_MESSAGE_RATE_LIMIT
      ),
      messageRateWindowMs: readPositiveNumberEnv(
        "MESSAGE_RATE_WINDOW_MS",
        DEFAULT_MESSAGE_RATE_WINDOW_MS
      ),
      maxRequestBytes: readPositiveNumberEnv(
        "MAX_REQUEST_BYTES",
        DEFAULT_MAX_REQUEST_BYTES
      ),
      documentWarningBytes: readPositiveNumberEnv(
        "DOCUMENT_WARNING_BYTES",
        DEFAULT_DOCUMENT_WARNING_BYTES
      ),
    };
  }

  private checkConnectionMessageRate(connection: Party.Connection) {
    const limitConnection =
      connection as Party.Connection<PartyServerConnectionState>;
    const decision = checkMessageRate({
      limits: this.getServerLimits(),
      now: Date.now(),
      state: limitConnection.state?.[MESSAGE_LIMIT_STATE_KEY],
    });

    limitConnection.setState((previousState) => {
      const state =
        previousState && typeof previousState === "object" ? previousState : {};
      return {
        ...(state as Record<string, unknown>),
        [MESSAGE_LIMIT_STATE_KEY]: decision.state,
      };
    });

    return { violation: decision.violation };
  }

  private getSupabaseLoadTimeoutMs(): number {
    return readPositiveNumberEnv(
      "SUPABASE_LOAD_TIMEOUT_MS",
      DEFAULT_SUPABASE_LOAD_TIMEOUT_MS
    );
  }

  isPersistenceAvailable(): boolean {
    return this.persistenceMode.kind === "available";
  }

  markPersistenceAvailable(): void {
    if (this.persistenceMode.kind === "transient") {
      console.log(
        `[PartyServer] Supabase persistence restored for room=${this.name}; leaving transient mode.`
      );
    }
    this.persistenceMode = { kind: "available" };
  }

  getPersistenceUnavailableResponse(): Response | null {
    if (this.persistenceMode.kind !== "transient") return null;
    return createPersistenceUnavailableResponse({
      ...this.persistenceMode,
      roomName: this.name,
    });
  }

  private enterTransientPersistenceMode(error: unknown): void {
    const timeoutMs = this.getSupabaseLoadTimeoutMs();
    this.persistenceMode = {
      kind: "transient",
      reason: getErrorMessage(error),
      failedAt: Date.now(),
    };
    console.error(
      formatPersistenceFailureLog({
        roomName: this.name,
        timeoutMs,
        error,
      })
    );
  }

  private async readLimitedJson(request: Request): Promise<unknown | Response> {
    const limits = this.getServerLimits();
    const contentLength = request.headers.get("content-length");
    const declaredBodySize =
      contentLength === null ? null : Number(contentLength);
    const declaredTooLarge =
      declaredBodySize !== null &&
      (!Number.isFinite(declaredBodySize) ||
        !shouldAcceptRequestBody(declaredBodySize, limits));

    const bodyText = await this.readLimitedRequestText(
      request,
      limits,
      declaredTooLarge
    );
    if (bodyText instanceof Response) {
      return bodyText;
    }

    return JSON.parse(bodyText);
  }

  private async readLimitedRequestText(
    request: Request,
    limits: ServerLimits,
    alreadyTooLarge: boolean
  ): Promise<string | Response> {
    if (!request.body) {
      return alreadyTooLarge
        ? new Response("Payload Too Large", { status: 413 })
        : "";
    }

    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bodyText = "";
    let bodySizeBytes = 0;
    let isTooLarge = alreadyTooLarge;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      bodySizeBytes += value.byteLength;
      if (isTooLarge || !shouldAcceptRequestBody(bodySizeBytes, limits)) {
        isTooLarge = true;
        continue;
      }

      bodyText += decoder.decode(value, { stream: true });
    }

    if (isTooLarge) {
      return new Response("Payload Too Large", { status: 413 });
    }

    bodyText += decoder.decode();
    return bodyText;
  }

  private async waitForEmptyRoomCompaction(): Promise<void> {
    const pending = this.emptyRoomCompactionPromise;
    if (pending) {
      await pending;
    }
  }

  private consumeCompactionAutosave(documentBase64: string): boolean {
    const compactionSnapshot = this.compactionAutosaveSnapshot;
    this.compactionAutosaveSnapshot = null;
    return isCompactionAutosave(documentBase64, compactionSnapshot);
  }

  private buildCompactedDocument(doc: Y.Doc): CompactedDocument | null {
    const currentPlayData = docToJson(doc);
    if (!currentPlayData) {
      return null;
    }

    const beforeSize = encodeDocToBase64(doc).length;
    const resetEpoch = Date.now();
    const compactDoc = jsonToDoc(currentPlayData);
    setDocResetEpoch(compactDoc, resetEpoch);
    const base64 = encodeDocToBase64(compactDoc);

    return {
      base64,
      beforeSize,
      afterSize: base64.length,
      resetEpoch,
    };
  }

  private async restoreResetEpoch(resetEpoch: number | null): Promise<void> {
    if (resetEpoch === null) {
      await this.clearResetEpoch();
      return;
    }

    await this.setResetEpoch(resetEpoch);
  }

  private async commitCompactedDocument({
    compactedDocument,
    beforeCommit,
    afterReplace,
  }: CommitCompactedDocumentOptions): Promise<boolean> {
    this.isSkippingSave = true;
    const rollbackResetEpoch = await this.getResetEpoch();
    let documentSaved = false;

    try {
      if (beforeCommit && !(await beforeCommit())) {
        return false;
      }

      await this.setResetEpoch(compactedDocument.resetEpoch);

      const { error } = await supabase.from("documents").upsert(
        {
          name: this.name,
          document: compactedDocument.base64,
        },
        { onConflict: "name" }
      );

      if (error) {
        throw new Error(error.message);
      }

      documentSaved = true;
      this.compactionAutosaveSnapshot = compactedDocument.base64;
      replaceDocFromSnapshot(this.document, compactedDocument.base64);
      await afterReplace?.();
      return true;
    } catch (error) {
      if (!documentSaved) {
        await this.restoreResetEpoch(rollbackResetEpoch);
      }
      this.compactionAutosaveSnapshot = null;
      throw error;
    } finally {
      this.isSkippingSave = false;
    }
  }

  async getResetEpoch(): Promise<number | null> {
    if (this.cachedResetEpoch !== undefined) {
      return this.cachedResetEpoch;
    }

    const value = await this.ctx.storage.get(STORAGE_KEYS.resetEpoch);
    this.cachedResetEpoch = typeof value === "number" ? value : null;
    return this.cachedResetEpoch;
  }

  async setResetEpoch(epoch: number): Promise<void> {
    this.cachedResetEpoch = epoch;
    try {
      await this.ctx.storage.put(STORAGE_KEYS.resetEpoch, epoch);
    } catch (error) {
      this.cachedResetEpoch = undefined;
      throw error;
    }
  }

  private async clearResetEpoch(): Promise<void> {
    this.cachedResetEpoch = null;
    try {
      await this.ctx.storage.delete(STORAGE_KEYS.resetEpoch);
    } catch (error) {
      this.cachedResetEpoch = undefined;
      throw error;
    }
  }

  private setConnectionAcceptedResetEpoch(
    connection: Party.Connection,
    resetEpoch: number | null
  ): void {
    const resetConnection =
      connection as Party.Connection<PartyServerConnectionState>;
    resetConnection.setState((previousState) => {
      const state =
        previousState && typeof previousState === "object" ? previousState : {};
      return {
        ...(state as Record<string, unknown>),
        [ACCEPTED_RESET_EPOCH_STATE_KEY]: resetEpoch,
      };
    });
  }

  private getConnectionAcceptedResetEpoch(
    connection: Party.Connection
  ): number | null {
    const state = (connection as Party.Connection<PartyServerConnectionState>)
      .state;
    const value = state?.[ACCEPTED_RESET_EPOCH_STATE_KEY];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private setConnectionOpenedAt(
    connection: Party.Connection,
    openedAt: number
  ): void {
    const trackedConnection =
      connection as Party.Connection<PartyServerConnectionState>;
    trackedConnection.setState((previousState) => {
      const state =
        previousState && typeof previousState === "object" ? previousState : {};
      return {
        ...(state as Record<string, unknown>),
        [CONNECTION_OPENED_AT_STATE_KEY]: openedAt,
      };
    });
  }

  private getConnectionOpenedAt(
    connection: Party.Connection
  ): number | undefined {
    const state = (connection as Party.Connection<PartyServerConnectionState>)
      .state;
    const value = state?.[CONNECTION_OPENED_AT_STATE_KEY];
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  private getRoomResetMessage(resetEpoch: number): string {
    return JSON.stringify({
      type: "room-reset",
      timestamp: resetEpoch,
      resetEpoch,
    });
  }

  private sendRoomResetAndClose(
    connection: Party.Connection,
    resetEpoch: number,
    reason: string
  ): void {
    this.sendCustomMessage(connection, this.getRoomResetMessage(resetEpoch));
    connection.close(4000, reason);
  }

  private closeConnections(reason: string): number {
    const connections = [...this.getConnections()];
    connections.forEach((conn) => {
      try {
        conn.close(4000, reason);
      } catch (error) {
        console.error("[PartyServer] Failed to close connection:", error);
      }
    });
    return connections.length;
  }

  /**
   * Determine whether a candidate epoch (from a doc, client, or bridge message)
   * is stale relative to the authoritative epoch stored in room storage.
   *
   * When we perform a hard reset or raw restore, we bump the room's
   * `resetEpoch`. Every autosave and bridge request checks that the data it is
   * about to persist is tagged with the same epoch so that stale PartyKit
   * instances (which might still hold the pre-reset Y.Doc in memory) cannot
   * overwrite the clean snapshot. Without this guard, autosave from a hibernated
   * worker could reintroduce the old, bloated state even if no clients are
   * connected.
   */
  private isEpochStale(
    candidateEpoch: number | null,
    serverEpoch: number | null
  ): boolean {
    return isResetEpochStale(candidateEpoch, serverEpoch);
  }

  /**
   * Restore the room's Y.Doc from a base64 snapshot.
   * This is used for restore-raw-document and force-reload-live operations.
   *
   * Steps:
   * 1. Lock autosave
   * 2. Save snapshot to database
   * 3. Replace live doc with snapshot
   * 4. Set resetEpoch
   * 5. Broadcast room-reset signal
   * 6. Close all connections
   * 7. Flush microtasks and release lock
   *
   * @param snapshotBase64 Base64-encoded Y.Doc snapshot
   * @returns Object with documentSize and resetEpoch
   */
  async restoreFromSnapshot(
    snapshotBase64: string,
    options?: { bumpEpoch?: boolean }
  ): Promise<{
    documentSize: number;
    resetEpoch: number;
  }> {
    const roomId = this.name;
    console.log(`[Restore Snapshot] Starting for room: ${roomId}`);

    // Lock autosave immediately
    this.isSkippingSave = true;

    try {
      // Decode snapshot to Y.Doc so we can ensure metadata is present
      const snapshotDoc = new Y.Doc();
      Y.applyUpdate(
        snapshotDoc,
        new Uint8Array(Buffer.from(snapshotBase64, "base64"))
      );

      const storedEpoch = await this.getResetEpoch();
      let resetEpoch = getDocResetEpoch(snapshotDoc);
      if (options?.bumpEpoch) {
        resetEpoch = Date.now();
      } else if (resetEpoch === null) {
        resetEpoch = storedEpoch ?? Date.now();
      }
      setDocResetEpoch(snapshotDoc, resetEpoch);

      const updatedBase64 = encodeDocToBase64(snapshotDoc);
      const documentSize = updatedBase64.length;

      // Save to database
      console.log(`[Restore Snapshot] Saving snapshot to database...`);
      const { error: saveError } = await supabase.from("documents").upsert(
        {
          name: this.name,
          document: updatedBase64,
        },
        { onConflict: "name" }
      );

      if (saveError) {
        console.error(
          `[Restore Snapshot] Database save failed:`,
          saveError.message,
          saveError
        );
        throw new Error(`Failed to save snapshot: ${saveError.message}`);
      }
      console.log(`[Restore Snapshot] Successfully saved snapshot to database`);

      // Reload the live server from the snapshot
      console.log(`[Restore Snapshot] Reloading live server from snapshot...`);
      const liveYDoc = this.document;
      replaceDocFromSnapshot(liveYDoc, updatedBase64);
      setDocResetEpoch(liveYDoc, resetEpoch);
      console.log(`[Restore Snapshot] Successfully reloaded live server`);

      // Set reset epoch for client detection
      await this.setResetEpoch(resetEpoch);
      console.log(`[Restore Snapshot] Set resetEpoch: ${resetEpoch}`);

      // Broadcast a "room-reset" message to all connected clients
      this.broadcastCustomMessage(this.getRoomResetMessage(resetEpoch));
      console.log(
        `[Restore Snapshot] Broadcasted room-reset signal to all clients`
      );

      // FORCE DISCONNECT: Close all connections
      const closedCount = this.closeConnections("Room Restored by Admin");
      console.log(
        `[Restore Snapshot] Closed ${closedCount} connections`
      );

      console.log(
        `[Restore Snapshot] Completed successfully: ${documentSize} bytes`
      );

      // Flush pending microtasks
      await Promise.resolve();

      return {
        documentSize,
        resetEpoch,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(
        `[Restore Snapshot] Failed for room ${roomId}:`,
        errorMessage,
        errorStack || error
      );

      throw error;
    } finally {
      // Re-enable autosave after a short delay
      setTimeout(() => {
        this.isSkippingSave = false;
        console.log("[Restore Snapshot] Autosave re-enabled");
      }, 1000);
    }
  }

  // Ensure an alarm is set for bridge lease pruning or empty-room compaction.
  private async ensureAlarmScheduled(): Promise<void> {
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    const subs = await this.getSubscribers();
    const refs = await this.getSharedReferences();
    const nextAlarm = getNextAlarmTime({
      compactAfter: await this.getEmptyRoomCompactAfter(),
      hasBridgeLeases: Boolean(subs.length || refs.length),
      now: Date.now(),
      pruneIntervalMs: DEFAULT_PRUNE_INTERVAL_MS,
    });

    if (nextAlarm === null) {
      await this.ctx.storage.deleteAlarm?.();
      return;
    }

    const previousAlarm = await this.ctx.storage.getAlarm?.();
    if (
      previousAlarm === null ||
      previousAlarm === undefined ||
      nextAlarm < previousAlarm
    ) {
      await this.ctx.storage.setAlarm?.(nextAlarm);
    }
  }

  private async scheduleEmptyRoomCompaction(): Promise<void> {
    if (this.isSkippingSave) return;
    if (!this.isPersistenceAvailable()) return;
    if (this.getOpenConnectionCount() !== 0) return;

    const compactAfter = Date.now() + DEFAULT_EMPTY_ROOM_COMPACT_DELAY_MS;
    await this.setEmptyRoomCompactAfter(compactAfter);
    await this.scheduleNextAlarm();

    console.log(
      `[PartyServer] Empty-room compaction scheduled: room=${this.name}, compactAfter=${compactAfter}`
    );
  }

  // --- Helper: group SharedReferences into storage entries
  private groupRefsToEntries(
    refs: Array<{ domain: string; path: string; elementId: string }>
  ): Array<{ sourceRoomId: string; elementIds: string[] }> {
    const bySource = new Map<string, Set<string>>();
    for (const ref of refs) {
      const srcId = getSourceRoomId(ref.domain, ref.path);
      const set = bySource.get(srcId) ?? new Set<string>();
      set.add(ref.elementId);
      bySource.set(srcId, set);
    }
    return Array.from(bySource.entries()).map(([sourceRoomId, ids]) => ({
      sourceRoomId,
      elementIds: Array.from(ids),
    }));
  }

  // --- Helper: merge and persist sharedReferences entries; returns updated entries and whether changed
  private async mergeAndStoreSharedRefs(
    newEntries: Array<{ sourceRoomId: string; elementIds: string[] }>
  ): Promise<{
    entries: Array<{ sourceRoomId: string; elementIds: string[] }>;
    changed: boolean;
  }> {
    const existing = await this.getSharedReferences();
    const bySource = new Map<string, Set<string>>();
    for (const e of existing)
      bySource.set(e.sourceRoomId, new Set(e.elementIds));
    let changed = false;
    for (const e of newEntries) {
      const set = bySource.get(e.sourceRoomId) ?? new Set<string>();
      const before = set.size;
      for (const id of e.elementIds) set.add(id);
      if (!bySource.has(e.sourceRoomId) || set.size !== before) changed = true;
      bySource.set(e.sourceRoomId, set);
    }
    if (changed) {
      const nowIso = new Date().toISOString();
      const merged: Array<SharedRefEntry> = Array.from(bySource.entries()).map(
        ([sourceRoomId, ids]) => {
          return {
            sourceRoomId,
            elementIds: Array.from(ids),
            lastSeen: nowIso,
          };
        }
      );
      await this.setSharedReferences(merged);
      return { entries: merged, changed: true };
    }
    return { entries: existing, changed: false };
  }

  // --- Helper: subscribe to sources and optionally hydrate immediately
  private async subscribeAndHydrate(
    entries: Array<{ sourceRoomId: string; elementIds: string[] }>
  ): Promise<void> {
    // Subscribe and cache allowedIds per source in sharedReferences
    await Promise.all(
      entries.map(async ({ sourceRoomId, elementIds }) => {
        if (!elementIds?.length) return;
        try {
          const sourceRoom = await getServerByName(env.Main, sourceRoomId);
          const subscribeRequest: SubscribeRequest = {
            action: "subscribe",
            consumerRoomId: this.name,
            elementIds,
          };
          await sourceRoom.fetch(internalRequest("/subscribe", subscribeRequest));
        } catch {}
      })
    );
  }

  // --- Helper: extract subtrees for a set of elementIds from the play map
  extractPlaySubtrees(
    doc: Y.Doc,
    elementIds: Set<string>
  ): Record<string, Record<string, any>> {
    const result: Record<string, Record<string, any>> = {};
    // Bind SyncedStore to this doc to operate on the same structure clients use
    const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
    const playY = getYjsValue(store.play) as unknown as Y.Map<any>;
    if (!playY) return result;
    playY.forEach((tagMap: any, tag: string) => {
      if (!(tagMap instanceof Y.Map)) return;
      const outForTag: Record<string, any> = {};
      tagMap.forEach((val: any, elementId: string) => {
        if (!elementIds.has(elementId)) return;
        // Prefer toJSON to get plain values
        const plain = typeof val?.toJSON === "function" ? val.toJSON() : val;
        outForTag[elementId] = plain;
      });
      if (Object.keys(outForTag).length) {
        result[tag] = outForTag;
      }
    });
    return result;
  }

  // --- Helper: assign subtrees into doc.play[tag][elementId] (replace semantics)
  assignPlaySubtrees(
    doc: Y.Doc,
    subtrees: Record<string, Record<string, any>>
  ): void {
    const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
    Object.entries(subtrees).forEach(([tag, elements]) => {
      // Ensure tag map exists
      // @ts-ignore
      store.play[tag] ??= {};
      Object.entries(elements).forEach(([elementId, data]) => {
        const tagObj = store.play[tag];
        const exists = Object.prototype.hasOwnProperty.call(tagObj, elementId);
        if (!exists) {
          // First time create to establish types
          tagObj[elementId] = data;
          return;
        }
        // In-place mutate existing proxy so observers remain attached
        const proxy = tagObj[elementId];
        // Equality guard to reduce redundant writes
        try {
          const yExisting = getYjsValue(proxy);
          const existingPlain =
            yExisting && typeof yExisting.toJSON === "function"
              ? yExisting.toJSON()
              : proxy;
          const same =
            JSON.stringify(existingPlain ?? null) ===
            JSON.stringify(data ?? null);
          if (same) return;
        } catch {}
        if (proxy && typeof proxy === "object") {
          deepReplaceIntoProxy(proxy, data);
        } else {
          tagObj[elementId] = data;
        }
      });
    });
  }

  override async onCustomMessage(
    sender: Party.Connection<unknown>,
    message: string
  ): Promise<void> {
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);

        if (parsed.type === "add-shared-reference") {
          // Handle dynamic addition of shared reference
          // TODO: this MIGHT still has some data inconsistencies when a source renders a dynamic element and changes it and then when we add the shared reference, it doesn't get the updated data
          await this.handleAddSharedReference(parsed.reference, sender);
        } else if (parsed.type === "export-permissions") {
          // Handle individual permission requests
          await this.handleExportPermissions(parsed.elementIds, sender);
        } else if (parsed.type === "register-shared-element") {
          // Handle dynamic registration of shared source element
          // TODO: this still has some data inconsistencies when a consumer renders a dynamic element and changes it and then when we register the shared element, it doesn't get the updated data
          await this.handleRegisterSharedElement(parsed.element, sender);
        } else {
          // Broadcast other messages normally
          this.broadcastCustomMessage(message);
        }
      } catch (error) {
        // If not valid JSON, broadcast as-is (existing behavior)
        this.broadcastCustomMessage(message);
      }
    }
  }

  private async handleAddSharedReference(
    reference: {
      domain: string;
      path: string;
      elementId: string;
    },
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (!reference?.domain || !reference?.path || !reference?.elementId) return;

    const sourceRoomId = getSourceRoomId(reference.domain, reference.path);
    const { entries, changed } = await this.mergeAndStoreSharedRefs([
      { sourceRoomId, elementIds: [reference.elementId] },
    ]);
    if (changed) await this.subscribeAndHydrate(entries);
  }

  private async handleExportPermissions(
    elementIds: string[],
    sender: Party.Connection<unknown>
  ): Promise<void> {
    const perms = await this.getSharedPermissions();
    const filtered: Record<string, SharedElementPermissions> = {};

    for (const id of elementIds) {
      if (perms[id]) filtered[id] = perms[id];
    }

    // Send permissions back to the requesting client
    this.sendCustomMessage(sender, JSON.stringify({ permissions: filtered }));
  }

  private async handleRegisterSharedElement(
    element: {
      elementId: string;
      permissions: SharedElementPermissions;
      path?: string;
    },
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (!element || !element.elementId) return;

    // Update shared permissions for this source room
    const existingPerms = await this.getSharedPermissions();
    const mode =
      element.permissions && element.permissions === "read-only"
        ? "read-only"
        : "read-write";
    existingPerms[element.elementId] = mode;
    await this.setSharedPermissions(existingPerms);

    // If new shared element just registered, proactively fanout to subscribers who requested it
    try {
      const yDoc = this.document;
      const play = yDoc.getMap("play") as Y.Map<any>;
      // Find the tag containing this elementId
      let subtreesForNew: Record<string, Record<string, any>> | null = null;
      play.forEach((tagMap: any, tag: string) => {
        if (!(tagMap instanceof Y.Map)) return;
        if (tagMap.has(element.elementId)) {
          const val = tagMap.get(element.elementId);
          const plain = typeof val?.toJSON === "function" ? val.toJSON() : val;
          subtreesForNew = { [tag]: { [element.elementId]: plain } };
        }
      });
      if (subtreesForNew === null) return;

      const subscribers = await this.getSubscribers();
      if (!subscribers.length) return;
      const currentEpoch = await this.getResetEpoch();
      await Promise.all(
        subscribers.map(async ({ consumerRoomId, elementIds }) => {
          if (!elementIds || !elementIds.includes(element.elementId)) return;
          const consumerRoom = await getServerByName(env.Main, consumerRoomId);
          try {
            const applyRequest: ApplySubtreesImmediateRequest = {
              action: "apply-subtrees-immediate",
              subtrees: ensureExists(subtreesForNew),
              sender: this.name,
              originKind: "source",
              resetEpoch: currentEpoch ?? null,
            };
            await consumerRoom.fetch(internalRequest("/apply", applyRequest));
          } catch {}
        })
      );
    } catch {}
  }

  override async onConnect(
    connection: Party.Connection,
    ctx: Party.ConnectionContext
  ) {
    this.setConnectionOpenedAt(connection, Date.now());
    await this.waitForEmptyRoomCompaction();

    const url = new URL(ctx.request.url);
    const connectionId = connection.id;

    const clientResetEpoch = parseClientResetEpoch(
      url.searchParams.get("clientResetEpoch")
    );
    let serverResetEpoch: number | null;

    try {
      serverResetEpoch = await this.getResetEpoch();
    } catch (error) {
      console.warn(
        `[PartyServer] Failed to check reset epoch on connect (connectionId=${connectionId}):`,
        error
      );
      serverResetEpoch = null;
    }

    if (
      serverResetEpoch !== null &&
      this.isEpochStale(clientResetEpoch, serverResetEpoch)
    ) {
      console.log(
        `[PartyServer] Rejecting stale client connection (connectionId=${connectionId}), sending room-reset message with epoch=${serverResetEpoch}`
      );
      // The WebSocket has already been accepted by PartyServer, so closing it
      // is part of enforcing the reset boundary.
      this.sendRoomResetAndClose(connection, serverResetEpoch, "Room Reset");
      console.log(
        `[PartyServer] Sent room-reset message to connectionId=${connectionId} and closed stale connection. Client will reload and reconnect.`
      );
      // Don't proceed with normal Y.js connection setup
      return;
    }

    this.setConnectionAcceptedResetEpoch(connection, serverResetEpoch);

    await this.clearEmptyRoomCompactAfter();

    // Opportunistically schedule an alarm if bridge leases or compaction need one
    await this.ensureAlarmScheduled();

    // Parse shared references from the connecting client (for consumer rooms)
    // Parse from the WebSocket request URL
    const sharedReferences = parseSharedReferencesFromUrl(ctx.request.url);

    // Persist consumer interest mapping for later pulls/mirroring
    if (sharedReferences.length) {
      const entries = this.groupRefsToEntries(sharedReferences);
      const { entries: merged } = await this.mergeAndStoreSharedRefs(entries);
      await this.subscribeAndHydrate(merged);
    }

    // Persist source-declared permissions for simple global read-only
    const sharedElements = parseSharedElementsFromUrl(ctx.request.url);
    if (sharedElements.length) {
      const permissionsByElementId: Record<string, SharedElementPermissions> =
        {};
      for (const el of sharedElements) {
        const mode =
          el.permissions && el.permissions.includes("read-only")
            ? "read-only"
            : "read-write";
        permissionsByElementId[el.elementId] = mode;
      }
      // TODO: instead of overriding, maybe we should merge and also do pruning of permissions that aren't present anymore to handle dynamic elements?
      // OR we should stop with all this pruning and instead enforce that these are declared globally in the client even for dynamically rendered elements (they have to be registered in init?)
      await this.setSharedPermissions(permissionsByElementId);
    }

    await super.onConnect(connection, ctx);
  }

  override async onMessage(
    connection: Party.Connection,
    message: Party.WSMessage
  ): Promise<void> {
    const limitResult = this.checkConnectionMessageRate(connection);
    if (limitResult.violation) {
      console.warn(
        `[PartyServer] Closing connection for ${limitResult.violation.kind}: ` +
          `connectionId=${connection.id}, ` +
          `documentBytes=${this.lastKnownDocumentBytes}`
      );
      connection.close(
        limitResult.violation.closeCode,
        limitResult.violation.reason
      );
      return;
    }

    const serverResetEpoch = await this.getResetEpoch();
    const connectionResetEpoch =
      this.getConnectionAcceptedResetEpoch(connection);

    // A reset can happen while an accepted socket is still closing. Reject
    // messages from sockets accepted under earlier history before y-partyserver
    // can merge them into the compacted Y.Doc.
    if (
      serverResetEpoch !== null &&
      this.isEpochStale(connectionResetEpoch, serverResetEpoch)
    ) {
      console.warn(
        `[PartyServer] Closing stale socket message: connectionId=${connection.id}, client=${connectionResetEpoch}, server=${serverResetEpoch}`
      );
      this.sendRoomResetAndClose(connection, serverResetEpoch, "Room Reset");
      return;
    }

    await super.onMessage(connection, message);
  }

  override async onClose(
    connection: Party.Connection,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    const closeDiagnostic = getConnectionCloseDiagnostic({
      roomName: this.name,
      connectionId: connection.id,
      code,
      reason,
      wasClean,
      openedAt: this.getConnectionOpenedAt(connection),
    });
    if (closeDiagnostic) {
      console.warn(closeDiagnostic);
    }

    try {
      await super.onClose(connection, code, reason, wasClean);
    } catch (error) {
      console.error(
        `[PartyServer] super.onClose failed: room=${this.name} connection=${connection.id} ` +
          `code=${code} reason=${JSON.stringify(reason)} wasClean=${wasClean}`,
        error
      );
      throw error;
    }

    try {
      await this.scheduleEmptyRoomCompaction();
    } catch (error) {
      console.error(
        `[PartyServer] Empty-room compaction scheduling failed after close: room=${this.name} connection=${connection.id}`,
        error
      );
    }
  }

  // Benign disconnect errors thrown by the Cloudflare runtime when a client's
  // underlying TCP connection is dropped before the WebSocket close handshake
  // completes (mobile network hiccups, tab closes, SIGINT during dev). The
  // protocol is self-healing — the client reconnects and Yjs catches up — so
  // these don't need to reach our production telemetry. Real errors still log.
  private static readonly BENIGN_CONNECTION_ERROR_PATTERNS = [
    "Network connection lost",
    "WebSocket is not connected",
    "WebSocket is closed",
  ];

  override onError(connection: Party.Connection, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const isBenign = PartyServer.BENIGN_CONNECTION_ERROR_PATTERNS.some((p) =>
      message.includes(p)
    );
    if (isBenign) {
      // Swallow — not useful signal for Cloudflare log monitoring.
      return;
    }
    console.error(
      `[PartyServer] onError connection=${connection.id} room=${this.name}:`,
      error
    );
  }

  override async onLoad(): Promise<void> {
    // Load the document from Supabase on first connection
    const timeoutMs = this.getSupabaseLoadTimeoutMs();
    const query = supabase
      .from("documents")
      .select("document")
      .eq("name", this.name)
      .maybeSingle();
    const result = await withTimeout(Promise.resolve(query), {
      timeoutMs,
      errorMessage: `Supabase document load timed out after ${timeoutMs}ms`,
    }).catch((error) => {
      this.enterTransientPersistenceMode(error);
      return null;
    });

    if (result === null) {
      return;
    }

    if (result.error) {
      this.enterTransientPersistenceMode(new Error(result.error.message));
      return;
    }

    this.markPersistenceAvailable();

    if (result.data) {
      this.lastKnownDocumentBytes =
        typeof result.data.document === "string"
          ? result.data.document.length
          : 0;
      Y.applyUpdate(
        this.document,
        new Uint8Array(Buffer.from(result.data.document, "base64"))
      );
    }
  }

  override async onSave(): Promise<void> {
    const doc = this.document;

    if (!this.isPersistenceAvailable()) {
      console.warn(
        `[PartyServer] Autosave skipped for room ${this.name}: Supabase persistence unavailable, room is in transient mode.`
      );
      return;
    }

    // Skip autosave if we are performing a reset operation
    if (this.isSkippingSave) {
      console.log(
        "[PartyServer] Skipping autosave due to active reset operation"
      );
      return;
    }

    // Get current reset epoch for logging and validation
    const serverResetEpoch = await this.getResetEpoch();
    const docResetEpoch = getDocResetEpoch(doc);

    if (this.isEpochStale(docResetEpoch, serverResetEpoch)) {
      const reason =
        docResetEpoch === null
          ? `doc reset epoch missing while server epoch=${serverResetEpoch}`
          : `doc reset epoch ${docResetEpoch} < server epoch ${serverResetEpoch}`;
      console.warn(
        `[PartyServer] Autosave skipped for room ${this.name}: ${reason}`
      );
      return;
    }

    if (
      docResetEpoch !== null &&
      serverResetEpoch !== null &&
      docResetEpoch > serverResetEpoch
    ) {
      console.warn(
        `[PartyServer] Autosave skipped for room ${this.name}: doc reset epoch (${docResetEpoch}) is ahead of server epoch (${serverResetEpoch})`
      );
      return;
    }

    // Ordinary autosave preserves Yjs history so reconnecting clients can merge
    // safely. Empty-room compaction is handled as a reset boundary by alarms.
    const documentBase64 = encodeDocToBase64(doc);
    const documentSize = documentBase64.length;
    this.lastKnownDocumentBytes = documentSize;
    const activeConnectionCount = this.getOpenConnectionCount();

    const serverLimits = this.getServerLimits();
    if (
      !this.hasWarnedDocumentSize &&
      shouldWarnForDocumentSize(documentSize, serverLimits)
    ) {
      this.hasWarnedDocumentSize = true;
      console.warn(
        `[PartyServer] Large document warning for room ${this.name}: ` +
          `documentBytes=${documentSize}, ` +
          `warningThresholdBytes=${serverLimits.documentWarningBytes}. ` +
          "Autosave will continue."
      );
    }

    // Log structured information about the save
    console.log(
      `[PartyServer] Autosave: room=${this.name}, size=${documentSize} bytes (${(documentSize / 1024 / 1024).toFixed(2)} MB), resetEpoch=${docResetEpoch ?? serverResetEpoch ?? "none"}`
    );

    // Save the document to the database
    const { data: _data, error } = await supabase.from("documents").upsert(
      {
        name: this.name,
        document: documentBase64,
      },
      { onConflict: "name" }
    );

    if (error) {
      console.error(
        `[PartyServer] SUPABASE AUTOSAVE FAILED for room ${this.name}:`,
        error
      );
    }

    if (!error) {
      if (this.consumeCompactionAutosave(documentBase64)) {
        console.log(
          `[PartyServer] Compaction autosave completed: room=${this.name}`
        );
        return;
      }
    }

    if (!error && activeConnectionCount > 0) {
      const compacted = await this.maybeCompactLargeConnectedRoom({
        documentSize,
        now: Date.now(),
      });
      if (compacted) {
        return;
      }
    }

    if (!error && activeConnectionCount === 0) {
      await this.scheduleEmptyRoomCompaction();
    }
  }

  private async maybeCompactLargeConnectedRoom({
    documentSize,
    now,
  }: {
    documentSize: number;
    now: number;
  }): Promise<boolean> {
    if (!this.isPersistenceAvailable()) return false;

    const thresholdBytes = this.getEmergencyCompactCheckBytes();
    const nextCheckAt = await this.getEmergencyCompactCheckAfter();

    if (
      !shouldCheckEmergencyCompaction({
        documentSize,
        thresholdBytes,
        nextCheckAt,
        now,
      })
    ) {
      return false;
    }

    const recheckAfter = now + this.getEmergencyCompactRecheckDelayMs();

    // Connected rooms normally keep raw Yjs history so hibernated clients can
    // resume without merging against a rewritten snapshot. This path is the
    // exception: once a never-empty room crosses the high-watermark threshold,
    // the server pays the expensive docToJson/jsonToDoc/encode check at most
    // once per cooldown window. If compaction is useful, it is enforced as a
    // reset boundary by broadcasting room-reset and closing active sockets.
    // That disruption is intentional because silently replacing Yjs history
    // while clients are connected can merge stale client history back into the
    // room. If compaction is not useful, the cooldown prevents every later
    // autosave of a naturally large document from rebuilding the whole Y.Doc.
    const compactedDocument = this.buildCompactedDocument(this.document);
    if (compactedDocument === null) {
      await this.setEmergencyCompactCheckAfter(recheckAfter);
      return false;
    }

    if (
      !shouldUseEmergencyCompactedDocument({
        beforeSize: documentSize,
        afterSize: compactedDocument.afterSize,
        thresholdBytes,
      })
    ) {
      await this.setEmergencyCompactCheckAfter(recheckAfter);
      console.log(
        `[PartyServer] Emergency compaction skipped: room=${this.name}, ${documentSize} -> ${compactedDocument.afterSize} bytes, nextCheckAt=${recheckAfter}`
      );
      return false;
    }

    await this.commitCompactedDocument({
      compactedDocument,
      afterReplace: async () => {
        await this.setEmergencyCompactCheckAfter(recheckAfter);
        await this.clearEmptyRoomCompactAfter();
        this.broadcastCustomMessage(
          this.getRoomResetMessage(compactedDocument.resetEpoch)
        );

        const closedCount = this.closeConnections("Room Compacted");
        console.log(
          `[PartyServer] Emergency compacted connected room: room=${this.name}, ${documentSize} -> ${compactedDocument.afterSize} bytes (${((1 - compactedDocument.afterSize / documentSize) * 100).toFixed(1)}% reduction), resetEpoch=${compactedDocument.resetEpoch}, closed=${closedCount}`
        );
      },
    });
    return true;
  }

  override async onRequest(request: Request): Promise<Response> {
    try {
      // Handle CORS preflight requests
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      const url = new URL(request.url);

      // Route admin requests to admin handler
      // PartyKit paths are like /parties/main/room-id/admin/inspect
      if (url.pathname.includes("/admin")) {
        return this.adminHandler.handleRequest(request);
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const body = await this.readLimitedJson(request);
      if (body instanceof Response) {
        return body;
      }

      if (isSubscribeRequest(body)) {
        // Called on SOURCE room; registers a consumer room id
        const { consumerRoomId, elementIds: elementIdsRaw } = body;
        const elementIds = Array.isArray(elementIdsRaw)
          ? Array.from(
              new Set(elementIdsRaw.filter((x) => typeof x === "string"))
            )
          : undefined;
        // IMPORTANT: Do NOT filter out unknown/not-yet-shared ids at subscribe time.
        // Keep the requested ids so that when the source registers those elements later,
        // existing subscribers will start receiving data automatically.
        const requestedIds = elementIds || [];
        const existing = await this.getSubscribers();
        const nowIso = new Date().toISOString();
        const leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS;
        const found = existing.find((s) => s.consumerRoomId === consumerRoomId);
        if (!found) {
          existing.push({
            consumerRoomId,
            elementIds: requestedIds,
            createdAt: nowIso,
            lastSeen: nowIso,
            leaseMs,
          });
        } else {
          // Update elementIds (filtered) and lastSeen
          found.elementIds = requestedIds;
          found.lastSeen = nowIso;
        }
        await this.setSubscribers(existing);
        const response: SubscribeResponse = {
          ok: true,
          subscribed: true,
          elementIds: requestedIds,
        };
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }

      if (isExportPermissionsRequest(body)) {
        // Returns simple permissions (read-only/read-write) for requested elementIds
        const { elementIds } = body;
        const perms = await this.getSharedPermissions();
        const filtered: Record<string, SharedElementPermissions> = {};
        for (const id of elementIds) {
          if (perms[id]) filtered[id] = perms[id];
        }
        const response: ExportPermissionsResponse = { permissions: filtered };
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }

      if (isApplySubtreesImmediateRequest(body)) {
        if (!this.isPersistenceAvailable()) {
          console.warn(
            `[Bridge] Ignoring apply-subtrees for transient room ${this.name}: Supabase persistence unavailable.`
          );
          const response: ApplySubtreesResponse = { ok: true };
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        }

        // Applies provided subtrees immediately and marks origin to suppress echo
        const { subtrees, sender, originKind } = body;

        const yDoc = this.document;
        const subscribers = await this.getSubscribers();
        const sharedRefs = await this.getSharedReferences();
        const senderResetEpoch =
          typeof body.resetEpoch === "number" ? body.resetEpoch : null;
        const serverResetEpoch = await this.getResetEpoch();

        if (this.isEpochStale(senderResetEpoch, serverResetEpoch)) {
          console.warn(
            `[Bridge] Ignoring apply-subtrees from ${sender} (${originKind}) due to stale reset epoch (sender=${senderResetEpoch}, server=${serverResetEpoch})`
          );
          const response: ApplySubtreesResponse = { ok: true };
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        }

        const receivingFromConsumer =
          originKind === "consumer" &&
          subscribers.some((s) => s.consumerRoomId === sender);
        const receivingFromSource =
          originKind === "source" &&
          sharedRefs.some((r) => r.sourceRoomId === sender);

        let subtreesToApply: Record<string, Record<string, any>> = subtrees;
        if (receivingFromConsumer) {
          // IMPORTANT: Only apply tags/elementIds that already exist in the source's doc to ensure
          // the source of truth is derived from the source room and not consumer-added capabilities.
          const play = yDoc.getMap("play") as Y.Map<any>;
          const filtered: Record<string, Record<string, any>> = {};
          Object.entries(subtreesToApply).forEach(([tag, elements]) => {
            const tagMap = play.get?.(tag) as Y.Map<any> | undefined;
            if (!(tagMap instanceof Y.Map)) return;
            const kept: Record<string, any> = {};
            Object.entries(elements).forEach(([elementId, data]) => {
              if (tagMap.has(elementId)) kept[elementId] = data;
            });
            if (Object.keys(kept).length) filtered[tag] = kept;
          });
          // Enforce simple permissions: read-only shared elements on this source room cannot be modified by consumers
          const perms = await this.getSharedPermissions();
          const filteredByPerms: Record<string, Record<string, any>> = {};
          Object.entries(filtered).forEach(([tag, elements]) => {
            const kept: Record<string, any> = {};
            Object.entries(elements).forEach(([elementId, data]) => {
              // Only allow writes to elements explicitly shared as read-write
              // This handles both read-only elements and ones that aren't even shared
              if (perms[elementId] !== "read-write") {
                return;
              }
              kept[elementId] = data;
            });
            if (Object.keys(kept).length) filteredByPerms[tag] = kept;
          });
          subtreesToApply = filteredByPerms;
        } else if (receivingFromSource) {
          // Consumer: apply only the elementIds we are subscribed to for this sender/source
          const ref = sharedRefs.find((r) => r.sourceRoomId === sender);
          const allowed = new Set(ref?.elementIds || []);
          if (allowed.size > 0) {
            const filteredByRefs: Record<string, Record<string, any>> = {};
            Object.entries(subtreesToApply).forEach(([tag, elements]) => {
              const kept: Record<string, any> = {};
              Object.entries(elements).forEach(([elementId, data]) => {
                if (allowed.has(elementId)) kept[elementId] = data;
              });
              if (Object.keys(kept).length) filteredByRefs[tag] = kept;
            });
            subtreesToApply = filteredByRefs;
          } else {
            subtreesToApply = {};
          }
        }
        if (!Object.keys(subtreesToApply).length) {
          const response: ApplySubtreesResponse = { ok: true };
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        }
        const ORIGIN = originKind === "consumer" ? ORIGIN_C2S : ORIGIN_S2C;
        yDoc.transact(
          () => this.assignPlaySubtrees(yDoc, subtreesToApply),
          ORIGIN
        );

        // If this is a SOURCE room receiving from a CONSUMER, immediately fanout to other consumers (excluding sender if provided)
        if (receivingFromConsumer) {
          const subscribers = await this.getSubscribers();
          const currentEpoch = await this.getResetEpoch();
          await Promise.all(
            subscribers.map(async ({ consumerRoomId, elementIds }) => {
              if (sender && consumerRoomId === sender) return;
              // Per-subscriber filtering by their subscribed elementIds
              let toSend = subtreesToApply;
              if (elementIds && elementIds.length) {
                const allowedElementIds = new Set(elementIds);
                const filteredSubtrees: Record<
                  string,
                  Record<string, any>
                > = {};
                Object.entries(subtreesToApply).forEach(([tag, elements]) => {
                  const kept: Record<string, any> = {};
                  Object.entries(elements).forEach(([elementId, data]) => {
                    if (allowedElementIds.has(elementId))
                      kept[elementId] = data;
                  });
                  if (Object.keys(kept).length) filteredSubtrees[tag] = kept;
                });
                toSend = filteredSubtrees;
                if (!Object.keys(toSend).length) return;
              }
              const consumerRoom = await getServerByName(
                env.Main,
                consumerRoomId
              );
              try {
                const applyRequest: ApplySubtreesImmediateRequest = {
                  action: "apply-subtrees-immediate",
                  subtrees: toSend,
                  sender: this.name,
                  originKind: "source",
                  resetEpoch: currentEpoch ?? null,
                };
                await consumerRoom.fetch(internalRequest("/apply", applyRequest));
              } catch {}
            })
          );
        }
        const response: ApplySubtreesResponse = { ok: true };
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Bad Request", { status: 400 });
    } catch (err) {
      console.error("onRequest error", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  /**
   * Perform a hard reset (garbage collection) of the room's Y.Doc.
   * This creates a fresh document from the current state, removing all history/tombstones.
   *
   * Steps:
   * 1. Lock autosave to prevent overwriting clean DB state
   * 2. Extract current state as JSON
   * 3. Create fresh Y.Doc from JSON (no history)
   * 4. Save to database
   * 5. Replace live doc with snapshot
   * 6. Set resetEpoch for client detection
   * 7. Broadcast room-reset signal
   * 8. Close all connections
   * 9. Flush microtasks and release lock
   *
   * @returns Object with beforeSize, afterSize, and resetEpoch
   */
  async performHardReset(): Promise<{
    beforeSize: number;
    afterSize: number;
    resetEpoch: number;
  }> {
    const roomId = this.name;
    console.log(`[Hard Reset] Starting for room: ${roomId}`);

    // Lock autosave immediately
    this.isSkippingSave = true;

    try {
      // Get current live doc state
      const liveYDoc = this.document;
      console.log(`[Hard Reset] Successfully retrieved live Y.Doc`);

      // Extract current state as JSON
      let currentPlayData = docToJson(liveYDoc);
      console.log(
        `[Hard Reset] Extracted play data from live doc: ${
          currentPlayData ? "has data" : "empty"
        }`
      );

      // If the live doc is empty (e.g. after a Cloudflare memory limit reset),
      // fall back to the database as the source of truth to avoid data loss.
      if (!currentPlayData) {
        console.log(
          `[Hard Reset] Live doc is empty, falling back to database...`
        );
        const { data: dbRow, error: dbError } = await supabase
          .from("documents")
          .select("document")
          .eq("name", roomId)
          .maybeSingle();

        if (dbError) {
          throw new Error(
            `Failed to load fallback from database: ${dbError.message}`
          );
        }

        if (dbRow?.document) {
          const fallbackDoc = new Y.Doc();
          Y.applyUpdate(
            fallbackDoc,
            new Uint8Array(Buffer.from(dbRow.document, "base64"))
          );
          currentPlayData = docToJson(fallbackDoc);
          console.log(
            `[Hard Reset] Loaded from database: ${
              currentPlayData ? "has data" : "still empty"
            }`
          );
        }
      }

      // Calculate before size
      const beforeSize = encodeDocToBase64(liveYDoc).length;
      console.log(
        `[Hard Reset] Before size: ${beforeSize} bytes (${(
          beforeSize /
          1024 /
          1024
        ).toFixed(2)} MB)`
      );

      const resetEpoch = Date.now();
      let freshBase64: string;
      let afterSize: number;

      // Handle truly empty room (empty live doc AND empty database)
      if (!currentPlayData) {
        console.log(
          `[Hard Reset] Room is empty in both live doc and database, creating empty fresh doc...`
        );
        const emptyDoc = new Y.Doc();
        setDocResetEpoch(emptyDoc, resetEpoch);
        freshBase64 = encodeDocToBase64(emptyDoc);
        afterSize = freshBase64.length;
        console.log(`[Hard Reset] Empty doc size: ${afterSize} bytes`);
      } else {
        // Create a fresh Y.Doc with the current state (no history/tombstones)
        console.log(`[Hard Reset] Creating fresh Y.Doc from play data...`);
        const freshDoc = jsonToDoc(currentPlayData);
        setDocResetEpoch(freshDoc, resetEpoch);
        console.log(`[Hard Reset] Successfully created fresh Y.Doc`);

        // Encode the fresh doc
        freshBase64 = encodeDocToBase64(freshDoc);
        afterSize = freshBase64.length;
        console.log(
          `[Hard Reset] After size: ${afterSize} bytes (${(
            afterSize /
            1024 /
            1024
          ).toFixed(2)} MB)`
        );
      }

      // Save to database
      console.log(`[Hard Reset] Saving fresh doc to database...`);
      const { error: saveError } = await supabase.from("documents").upsert(
        {
          name: this.name,
          document: freshBase64,
        },
        { onConflict: "name" }
      );

      if (saveError) {
        console.error(
          `[Hard Reset] Database save failed:`,
          saveError.message,
          saveError
        );
        throw new Error(`Failed to save reset document: ${saveError.message}`);
      }
      console.log(`[Hard Reset] Successfully saved fresh doc to database`);

      // Reload the live server from the new snapshot
      console.log(`[Hard Reset] Reloading live server from snapshot...`);
      replaceDocFromSnapshot(liveYDoc, freshBase64);
      setDocResetEpoch(liveYDoc, resetEpoch);
      console.log(`[Hard Reset] Successfully reloaded live server`);

      // Set reset epoch for client detection
      await this.setResetEpoch(resetEpoch);
      console.log(`[Hard Reset] Set resetEpoch: ${resetEpoch}`);

      // Broadcast a "room-reset" message to all connected clients
      this.broadcastCustomMessage(this.getRoomResetMessage(resetEpoch));
      console.log(`[Hard Reset] Broadcasted room-reset signal to all clients`);

      // FORCE DISCONNECT: Close all connections to ensure no lingering clients
      // push their old state back to the server
      const closedCount = this.closeConnections("Room Reset by Admin");
      console.log(`[Hard Reset] Closed ${closedCount} connections`);

      const sizeReduction = beforeSize - afterSize;
      const sizeReductionPercent = ((sizeReduction / beforeSize) * 100).toFixed(
        1
      );

      console.log(
        `[Hard Reset] Completed successfully: ${beforeSize} -> ${afterSize} bytes (${sizeReductionPercent}% reduction)`
      );

      // Flush pending microtasks to ensure any queued autosave callbacks are processed
      // before we release the lock
      await Promise.resolve();

      return {
        beforeSize,
        afterSize,
        resetEpoch,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(
        `[Hard Reset] Failed for room ${roomId}:`,
        errorMessage,
        errorStack || error
      );

      throw error;
    } finally {
      // Re-enable autosave after a short delay to let the dust settle
      // Use setTimeout to ensure any pending callbacks have been processed
      setTimeout(() => {
        this.isSkippingSave = false;
        console.log("[Hard Reset] Autosave re-enabled");
      }, 1000);
    }
  }

  private async compactEmptyRoomDocument(): Promise<void> {
    if (this.emptyRoomCompactionPromise) {
      await this.emptyRoomCompactionPromise;
      return;
    }

    if (this.isSkippingSave) return;
    if (!this.isPersistenceAvailable()) return;
    if (this.getOpenConnectionCount() !== 0) return;

    const run = async () => {
      const compactedDocument = this.buildCompactedDocument(this.document);
      if (compactedDocument === null) {
        await this.clearEmptyRoomCompactAfter();
        return;
      }

      if (
        !shouldStoreCompactedDocument(
          compactedDocument.beforeSize,
          compactedDocument.afterSize
        )
      ) {
        await this.clearEmptyRoomCompactAfter();
        console.log(
          `[PartyServer] Empty-room compaction skipped: room=${this.name}, ${compactedDocument.beforeSize} -> ${compactedDocument.afterSize} bytes`
        );
        return;
      }

      const committed = await this.commitCompactedDocument({
        compactedDocument,
        beforeCommit: async () => {
          if (this.getOpenConnectionCount() === 0) {
            return true;
          }
          await this.clearEmptyRoomCompactAfter();
          return false;
        },
        afterReplace: async () => {
          await this.clearEmptyRoomCompactAfter();
        },
      });
      if (committed) {
        console.log(
          `[PartyServer] Empty-room compacted: room=${this.name}, ${compactedDocument.beforeSize} -> ${compactedDocument.afterSize} bytes (${((1 - compactedDocument.afterSize / compactedDocument.beforeSize) * 100).toFixed(1)}% reduction), resetEpoch=${compactedDocument.resetEpoch}`
        );
      }
    };

    this.emptyRoomCompactionPromise = run();
    try {
      await this.emptyRoomCompactionPromise;
    } finally {
      this.emptyRoomCompactionPromise = null;
    }
  }

  // PartyKit Alarm: invoked when storage alarm rings
  override async onAlarm(): Promise<void> {
    try {
      const compactAfter = await this.getEmptyRoomCompactAfter();
      if (compactAfter !== null && compactAfter <= Date.now()) {
        if (this.getOpenConnectionCount() === 0) {
          await this.compactEmptyRoomDocument();
        } else {
          await this.clearEmptyRoomCompactAfter();
        }
      }

      const subscribers = await this.getSubscribers();

      if (subscribers.length) {
        const now = Date.now();
        const withinLease = (s: any) => {
          const leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS;
          const last = s?.lastSeen || s?.createdAt;
          const t = last ? Date.parse(last) : NaN;
          if (!Number.isFinite(t)) return true; // if no timestamp, be permissive but keep once
          return now - t <= leaseMs;
        };

        const prunedForLease = subscribers.filter(withinLease);
        if (prunedForLease.length !== subscribers.length) {
          await this.setSubscribers(prunedForLease);
        }
      }

      // Prune shared references by TTL on consumer rooms
      const refsRaw = await this.getSharedReferences();
      const refs: Array<SharedRefEntry> = Array.isArray(refsRaw) ? refsRaw : [];
      if (refs.length) {
        const now = Date.now();
        const leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS; // unified lease
        const kept = refs.filter((r) => {
          const t = r?.lastSeen ? Date.parse(r.lastSeen) : NaN;
          if (!Number.isFinite(t)) return true;
          return now - t <= leaseMs;
        });
        if (kept.length !== refs.length) {
          await this.setSharedReferences(kept);
        }
      }
    } finally {
      await this.scheduleNextAlarm();
    }
  }

  // Flush batched bridge updates to subscribers and source rooms
  private async flushBridgeUpdates(yDoc: Y.Doc): Promise<void> {
    if (!this.isPersistenceAvailable()) {
      console.warn(
        `[PartyServer] Bridge flush skipped for room ${this.name}: Supabase persistence unavailable, room is in transient mode.`
      );
      return;
    }

    const currentEpoch = await this.getResetEpoch();

    // Push to subscribers (source -> consumer direction)
    const subscribers = await this.getSubscribers();
    if (subscribers.length) {
      const permissions = await this.getSharedPermissions();
      await Promise.all(
        subscribers.map(async ({ consumerRoomId, elementIds }) => {
          if (!elementIds || !elementIds.length) return;
          const sharedElementIds = elementIds.filter((id) => {
            return Boolean(permissions[id]);
          });
          const subtrees = this.extractPlaySubtrees(
            yDoc,
            new Set(sharedElementIds)
          );
          if (!Object.keys(subtrees).length) return;
          const consumerRoom = await getServerByName(env.Main, consumerRoomId);
          const applyRequest: ApplySubtreesImmediateRequest = {
            action: "apply-subtrees-immediate",
            subtrees,
            sender: this.name,
            originKind: "source",
            resetEpoch: currentEpoch ?? null,
          };
          await consumerRoom.fetch(internalRequest("/apply", applyRequest));
        })
      );
    }

    // Push back to sources (consumer -> source direction)
    const refs = await this.getSharedReferences();
    for (const { sourceRoomId, elementIds } of refs) {
      if (!elementIds?.length) continue;
      const subtrees = this.extractPlaySubtrees(yDoc, new Set(elementIds));
      if (!Object.keys(subtrees).length) continue;
      const sourceRoom = await getServerByName(env.Main, sourceRoomId);
      const applyRequest: ApplySubtreesImmediateRequest = {
        action: "apply-subtrees-immediate",
        subtrees,
        sender: this.name,
        originKind: "consumer",
        resetEpoch: currentEpoch ?? null,
      };
      await sourceRoom.fetch(internalRequest("/apply", applyRequest));
    }
  }

  // Schedule a debounced bridge flush. Multiple rapid updates coalesce into one flush.
  private scheduleBridgeFlush(yDoc: Y.Doc): void {
    if (this.bridgeFlushTimer !== null) {
      clearTimeout(this.bridgeFlushTimer);
    }
    this.bridgeFlushTimer = setTimeout(() => {
      this.bridgeFlushTimer = null;
      this.flushBridgeUpdates(yDoc).catch((err) => {
        console.error("[PartyServer] Bridge flush failed:", err);
      });
    }, PartyServer.BRIDGE_DEBOUNCE_MS);
  }

  // Attach observers to this room's doc to bridge changes to shared element subscribers.
  // Updates are debounced to avoid flooding subscribers with per-keystroke HTTP calls.
  private async attachImmediateBridgeObservers(): Promise<void> {
    if (this.observersAttached) return;
    const yDoc = this.document;

    yDoc.on("update", (_update: Uint8Array, origin: any) => {
      // Ignore echoed updates from bridge apply operations
      if (origin === ORIGIN_C2S || origin === ORIGIN_S2C) return;

      // Fast bail: if no subscribers or refs are cached, skip entirely
      if (
        this.cachedSubscribers !== null &&
        this.cachedSubscribers.length === 0 &&
        this.cachedSharedRefs !== null &&
        this.cachedSharedRefs.length === 0
      ) {
        return;
      }

      this.scheduleBridgeFlush(yDoc);
    });

    this.observersAttached = true;
  }
}

export default {
  // Set up your fetch handler to use configured Servers
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return (
        (await routePartykitRequest(request, env)) ||
        new Response("Not Found", { status: 404 })
      );
    } catch (error) {
      if (isDurableObjectOverloadError(error)) {
        return new Response("Service Busy", {
          status: 503,
          headers: {
            "Retry-After": "5",
          },
        });
      }

      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
