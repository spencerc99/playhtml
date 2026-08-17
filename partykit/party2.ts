// ABOUTME: Hosts version 2 PlayHTML rooms with server-ordered JSON operations.
// ABOUTME: Hydrates, sequences, broadcasts, and persists snapshots while retaining presence.

import { env } from "cloudflare:workers";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import {
  PROTOCOL_VERSION,
  type ClientOperationMessage,
  type Operation,
  type OperationRejectionCode,
  type RoomSnapshot,
  type ServerOperationMessage,
  type ServerOperationRejectedMessage,
  type ServerSnapshotMessage,
} from "@playhtml/common";
import {
  applyOperation,
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
} from "./const";
import { getErrorMessage, retryWithTimeout } from "./persistenceMode";
import { PresenceServer } from "./presenceServer";

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
  private legacyDocument: string | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private dirty = false;
  private savePromise: Promise<void> | null = null;
  private hasWarnedDocumentSize = false;

  override async onStart(): Promise<void> {
    await this.hydrate();
  }

  override async onConnect(
    connection: Connection,
    ctx: ConnectionContext,
  ): Promise<void> {
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

    this.handleOperationMessage(connection, parsed);
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

    const result = await retryWithTimeout(
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

    this.legacyDocument = result.document;
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

  private handleOperationMessage(
    connection: Connection,
    parsed: Record<string, unknown>,
  ): void {
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

    const lastMutationId = this.snapshot.lastMutationIds[parsed.clientId] ?? 0;
    if (parsed.mutationId <= lastMutationId) return;

    const result = applyOperation(this.snapshot, parsed.operation);
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
    this.snapshot = {
      ...result.snapshot,
      lastMutationIds: {
        ...result.snapshot.lastMutationIds,
        [parsed.clientId]: parsed.mutationId,
      },
    };
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
    const { error } = await supabase.from("documents").upsert(
      {
        name: this.name,
        document_json: documentJson,
        protocol_version: PROTOCOL_VERSION,
        document: this.legacyDocument,
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
