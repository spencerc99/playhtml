// ABOUTME: Maintains authoritative and optimistic version 2 room snapshots.
// ABOUTME: Rebases pending client operations after server updates and rejections.

import type {
  ClientOperationMessage,
  JsonValue,
  RoomGeneration,
  RoomSnapshot,
  SequencedOperation,
  ServerOperationRejectedMessage,
  ServerSnapshotMessage,
} from "@playhtml/common";
import { PROTOCOL_VERSION } from "@playhtml/common";
import {
  applyOperationInPlace,
  replaceSnapshotElementInPlace,
} from "@playhtml/common";
import { recordMutation, type MutationCallback } from "@playhtml/common";

export type V2StoreTransport = {
  send(message: ClientOperationMessage): void;
  requestSnapshot(): void;
};

export type V2StoreStatusEvent = {
  readonly type: "write-rejected";
  readonly rejection: ServerOperationRejectedMessage;
};

export type V2StoreOptions = {
  readonly snapshot: RoomSnapshot;
  readonly generation: RoomGeneration;
  readonly transport: V2StoreTransport;
  readonly clientId?: string;
  readonly sequence?: number;
  readonly echoWaitElementIds?: readonly string[];
};

type ElementListener = (value: JsonValue | undefined) => void;
type RoomListener = (snapshot: RoomSnapshot) => void;
type StatusListener = (event: V2StoreStatusEvent) => void;

const valuesEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const pathsEqual = (
  left: ClientOperationMessage["operation"]["path"],
  right: ClientOperationMessage["operation"]["path"],
): boolean =>
  left.length === right.length &&
  left.every((segment, index) => {
    const other = right[index];
    return (
      typeof segment === typeof other &&
      (typeof segment === "string"
        ? segment === other
        : segment.itemId === (other as { readonly itemId: string }).itemId)
    );
  });

const getElementValue = (
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
): JsonValue | undefined => snapshot.state[capability]?.[elementId];

const selectElementSnapshot = (
  snapshot: RoomSnapshot,
  capability: string,
  elementId: string,
): RoomSnapshot => {
  const value = getElementValue(snapshot, capability, elementId);
  return {
    state: value === undefined ? {} : { [capability]: { [elementId]: value } },
    arrays: snapshot.arrays.filter(
      (identity) =>
        identity.capability === capability && identity.elementId === elementId,
    ),
    lastMutationIds: snapshot.lastMutationIds,
  };
};

const applyOwnedOperation = (
  snapshot: RoomSnapshot,
  operation: ClientOperationMessage["operation"],
): void => {
  const applied = applyOperationInPlace(snapshot, operation);
  if (!applied.ok) {
    throw new Error(`Recorded operation was rejected: ${applied.message}`);
  }
};

export class V2Store {
  readonly clientId: string;

  private authoritative: RoomSnapshot;
  private view: RoomSnapshot;
  private generation: RoomGeneration;
  private serverSequence: number;
  private nextMutationId: number;
  private pending: ClientOperationMessage[] = [];
  private outgoing: ClientOperationMessage[] = [];
  private outgoingFlushScheduled = false;
  private readonly echoWaitElementIds: Set<string>;
  private readonly echoWaitMutationIds = new Set<number>();
  private readonly transport: V2StoreTransport;
  private readonly elementListeners = new Map<string, Set<ElementListener>>();
  private readonly roomListeners = new Set<RoomListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(options: V2StoreOptions) {
    this.clientId = options.clientId ?? crypto.randomUUID();
    this.authoritative = structuredClone(options.snapshot);
    this.view = structuredClone(options.snapshot);
    this.generation = options.generation;
    this.serverSequence = options.sequence ?? 0;
    this.nextMutationId =
      (this.authoritative.lastMutationIds[this.clientId] ?? 0) + 1;
    this.transport = options.transport;
    this.echoWaitElementIds = new Set(options.echoWaitElementIds ?? []);
  }

  /**
   * Returns the store's live read-only view. Element values are replaced
   * atomically, but callers must not mutate the snapshot or retain it as
   * historical state.
   */
  getSnapshot(): RoomSnapshot {
    return this.view;
  }

  getGeneration(): RoomGeneration {
    return this.generation;
  }

  getPendingOperations(): readonly ClientOperationMessage[] {
    return this.pending;
  }

  mutate<Value extends JsonValue>(
    capability: string,
    elementId: string,
    mutatorOrValue: Value | MutationCallback<Value>,
  ): readonly ClientOperationMessage[] {
    const previousValue = getElementValue(this.view, capability, elementId);
    const recorded = recordMutation(
      selectElementSnapshot(this.view, capability, elementId),
      capability,
      elementId,
      mutatorOrValue as Value | MutationCallback<Value>,
    );
    const messages = recorded.ops.map((operation) =>
      this.queueOperation(operation),
    );
    if (this.echoWaitElementIds.has(elementId)) {
      for (const message of messages) {
        this.echoWaitMutationIds.add(message.mutationId);
      }
    } else {
      for (const operation of recorded.ops) {
        applyOwnedOperation(this.view, operation);
      }
    }
    // Listeners fired during a local mutation must apply synchronously: the
    // caller (e.g. drag math) reads the element's data right after setData,
    // and a frame-delayed apply makes every step compute from a stale base.
    if (!this.echoWaitElementIds.has(elementId) && messages.length > 0) {
      this.notifyingLocalMutation = true;
      try {
        const key = this.elementKey(capability, elementId);
        this.notifyChanges(
          this.view,
          this.view,
          new Set([key]),
          new Map([[key, previousValue]]),
        );
      } finally {
        this.notifyingLocalMutation = false;
      }
    }
    this.scheduleOutgoingFlush();
    return messages;
  }

  /** True while listeners for a local mutation are being notified. */
  isNotifyingLocalMutation(): boolean {
    return this.notifyingLocalMutation;
  }

  private notifyingLocalMutation = false;

  applyServerOperation(envelope: SequencedOperation): void {
    if (
      envelope.generation !== this.generation ||
      envelope.sequence <= this.serverSequence
    ) {
      return;
    }

    const key = this.elementKey(
      envelope.operation.capability,
      envelope.operation.elementId,
    );
    const previousValues = new Map([
      [
        key,
        getElementValue(
          this.view,
          envelope.operation.capability,
          envelope.operation.elementId,
        ),
      ],
    ]);
    const applied = applyOperationInPlace(
      this.authoritative,
      envelope.operation,
    );
    if (!applied.ok) {
      // The server accepted this operation, so a local failure means the
      // authoritative copies have diverged. Resync rather than drift.
      console.warn(
        `[playhtml] Server operation failed locally for ${envelope.operation.capability}/${envelope.operation.elementId}; requesting fresh snapshot: ${applied.message}`,
      );
      this.transport.requestSnapshot();
      return;
    }

    this.serverSequence = envelope.sequence;
    this.authoritative.lastMutationIds[envelope.clientId] = Math.max(
      this.authoritative.lastMutationIds[envelope.clientId] ?? 0,
      envelope.mutationId,
    );
    if (envelope.clientId === this.clientId) {
      this.pending = this.pending.filter(
        (message) => message.mutationId !== envelope.mutationId,
      );
      this.outgoing = this.outgoing.filter(
        (message) => message.mutationId !== envelope.mutationId,
      );
      this.echoWaitMutationIds.delete(envelope.mutationId);
    }
    this.rederiveElement(
      envelope.operation.capability,
      envelope.operation.elementId,
    );
    this.notifyChanges(this.view, this.view, new Set([key]), previousValues);
  }

  applyServerSnapshot(message: ServerSnapshotMessage): void {
    const previous = this.view;
    const generationChanged = message.generation !== this.generation;
    this.authoritative = structuredClone(message.snapshot);
    this.generation = message.generation;
    this.serverSequence = message.sequence;
    const confirmedMutationId =
      message.snapshot.lastMutationIds[this.clientId] ?? 0;
    this.pending = generationChanged
      ? []
      : this.pending.filter(
          (pending) => pending.mutationId > confirmedMutationId,
        );
    this.outgoing = generationChanged
      ? []
      : this.outgoing.filter(
          (pending) => pending.mutationId > confirmedMutationId,
        );
    if (generationChanged) {
      this.echoWaitMutationIds.clear();
    } else {
      for (const mutationId of this.echoWaitMutationIds) {
        if (mutationId <= confirmedMutationId) {
          this.echoWaitMutationIds.delete(mutationId);
        }
      }
    }
    this.rederiveView();
    this.notifyChanges(previous, this.view);
  }

  handleRejection(message: ServerOperationRejectedMessage): void {
    const previous = this.view;
    let changedKey: string | undefined;
    let previousValue: JsonValue | undefined;
    if (message.code === "stale-generation") {
      this.pending = [];
      this.outgoing = [];
      this.echoWaitMutationIds.clear();
      this.rederiveView();
      this.transport.requestSnapshot();
    } else if (
      message.mutationId !== undefined &&
      (message.clientId === undefined || message.clientId === this.clientId)
    ) {
      const rejected = this.pending.find(
        (pending) => pending.mutationId === message.mutationId,
      );
      if (rejected) {
        changedKey = this.elementKey(
          rejected.operation.capability,
          rejected.operation.elementId,
        );
        previousValue = getElementValue(
          this.view,
          rejected.operation.capability,
          rejected.operation.elementId,
        );
      }
      this.pending = this.pending.filter(
        (pending) => pending.mutationId !== message.mutationId,
      );
      this.outgoing = this.outgoing.filter(
        (pending) => pending.mutationId !== message.mutationId,
      );
      this.echoWaitMutationIds.delete(message.mutationId);
      if (rejected) {
        this.rederiveElement(
          rejected.operation.capability,
          rejected.operation.elementId,
        );
      }
    }
    if (changedKey) {
      this.notifyChanges(
        this.view,
        this.view,
        new Set([changedKey]),
        new Map([[changedKey, previousValue]]),
      );
    } else {
      this.notifyChanges(previous, this.view);
    }
    const event = { type: "write-rejected", rejection: message } as const;
    for (const listener of this.statusListeners) listener(event);
  }

  subscribe(
    capability: string,
    elementId: string,
    listener: ElementListener,
  ): () => void {
    const key = this.elementKey(capability, elementId);
    const listeners = this.elementListeners.get(key) ?? new Set();
    listeners.add(listener);
    this.elementListeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.elementListeners.delete(key);
    };
  }

  subscribeRoom(listener: RoomListener): () => void {
    this.roomListeners.add(listener);
    return () => this.roomListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private rederiveView(): void {
    this.view = structuredClone(this.authoritative);
    for (const pending of this.pending) {
      if (this.echoWaitMutationIds.has(pending.mutationId)) continue;
      const applied = applyOperationInPlace(this.view, pending.operation);
      if (!applied.ok) continue;
    }
  }

  private rederiveElement(capability: string, elementId: string): void {
    replaceSnapshotElementInPlace(
      this.view,
      this.authoritative,
      capability,
      elementId,
    );
    for (const pending of this.pending) {
      if (
        pending.operation.capability !== capability ||
        pending.operation.elementId !== elementId ||
        this.echoWaitMutationIds.has(pending.mutationId)
      ) {
        continue;
      }
      const applied = applyOperationInPlace(this.view, pending.operation);
      if (!applied.ok) continue;
    }
  }

  private queueOperation(
    operation: ClientOperationMessage["operation"],
  ): ClientOperationMessage {
    const queued = this.outgoing.at(-1);
    if (
      operation.type === "set" &&
      queued?.operation.type === "set" &&
      queued.operation.capability === operation.capability &&
      queued.operation.elementId === operation.elementId &&
      pathsEqual(queued.operation.path, operation.path)
    ) {
      const replacement = { ...queued, operation };
      this.outgoing[this.outgoing.length - 1] = replacement;
      const pendingIndex = this.pending.findIndex(
        (message) => message.mutationId === queued.mutationId,
      );
      if (pendingIndex !== -1) this.pending[pendingIndex] = replacement;
      return replacement;
    }

    const message = {
      type: "operation" as const,
      protocolVersion: PROTOCOL_VERSION,
      generation: this.generation,
      clientId: this.clientId,
      mutationId: this.nextMutationId++,
      operation,
    };
    this.outgoing.push(message);
    this.pending.push(message);
    return message;
  }

  // Flushes on a microtask rather than a timer: a timer quantizes a drag to
  // the timer's real cadence (setTimeout(16) fires at 20-30ms with jitter),
  // which viewers perceive as coarser motion than the input. A microtask
  // still coalesces the writes of one synchronous burst (one send per input
  // event), matching how v1 shipped updates.
  private scheduleOutgoingFlush(): void {
    if (this.outgoing.length === 0 || this.outgoingFlushScheduled) return;
    this.outgoingFlushScheduled = true;
    queueMicrotask(() => {
      this.outgoingFlushScheduled = false;
      const outgoing = this.outgoing;
      this.outgoing = [];
      for (const message of outgoing) this.transport.send(message);
    });
  }

  // With a changedKeys set (single-op paths), only those elements' listeners
  // are compared and notified: scanning every subscribed element with a
  // stringify comparison is O(room size) and made large rooms visibly lag on
  // every operation. The full scan remains for snapshot replacement, where
  // anything may have changed.
  private notifyChanges(
    previous: RoomSnapshot,
    next: RoomSnapshot,
    changedKeys?: ReadonlySet<string>,
    previousValues?: ReadonlyMap<string, JsonValue | undefined>,
  ): void {
    if (previous === next && previousValues === undefined) return;
    if (changedKeys !== undefined) {
      for (const key of changedKeys) {
        const listeners = this.elementListeners.get(key);
        if (!listeners) continue;
        const [capability, elementId] = this.parseElementKey(key);
        const previousValue = previousValues?.has(key)
          ? previousValues.get(key)
          : getElementValue(previous, capability, elementId);
        const nextValue = getElementValue(next, capability, elementId);
        if (valuesEqual(previousValue, nextValue)) continue;
        for (const listener of listeners) listener(nextValue);
      }
      for (const listener of this.roomListeners) listener(next);
      return;
    }

    for (const [key, listeners] of this.elementListeners) {
      const [capability, elementId] = this.parseElementKey(key);
      const previousValue = getElementValue(previous, capability, elementId);
      const nextValue = getElementValue(next, capability, elementId);
      if (valuesEqual(previousValue, nextValue)) continue;
      for (const listener of listeners) listener(nextValue);
    }
    for (const listener of this.roomListeners) listener(next);
  }

  private elementKey(capability: string, elementId: string): string {
    return JSON.stringify([capability, elementId]);
  }

  private parseElementKey(key: string): [string, string] {
    return JSON.parse(key) as [string, string];
  }
}
