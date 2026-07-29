// ABOUTME: Owns room quarantine, retry backoff, and compaction parking state.
// ABOUTME: Keeps failure recovery policy separate from PartyServer synchronization.
import { STORAGE_KEYS } from "./const";
import { getErrorMessage } from "./persistenceMode";
import {
  createQuarantineStatusBody,
  ExternalCompactionRequiredError,
  formatCompactionSkipLog,
  formatFailureBackoffLog,
  formatQuarantineLog,
  getFailureRetryAt,
  isRetryDue,
  isTooLargeToCompactInDurableObject,
  shouldQuarantineForFailures,
  type FailureKind,
  type QuarantineReason,
  type QuarantineState,
} from "./quarantinePolicy";

type RoomStorage = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
  setAlarm?(scheduledTime: number | Date): Promise<void>;
  deleteAlarm?(): Promise<void>;
};

type RoomCircuitBreakerOptions = {
  roomName: string;
  storage: RoomStorage;
  getQuarantineControl: () => KVNamespace | null;
  readPositiveNumber: (name: string, fallback: number) => number;
  defaults: {
    documentWarningBytes: number;
    maxInDurableObjectBytes: number;
    failureThreshold: number;
    failureBackoffMs: number;
    failureBackoffMaxMs: number;
  };
  activateTransientPersistence: (quarantine: QuarantineState) => void;
  startRealtimeSync: () => Promise<void>;
  reloadRoom: () => Promise<boolean>;
  prepareGuardedReload: () => void;
  clearCompactionSchedule: () => Promise<void>;
};

export type EnterQuarantineOptions = {
  reason: QuarantineReason;
  detail: string;
  failureKind: FailureKind | null;
  failureCount: number;
  skipExternalWrite?: boolean;
};

export type QuarantineResetSummary = {
  wasQuarantined: boolean;
  loadFailures: number;
  alarmFailures: number;
  wasLoadDeferred: boolean;
};

export class RoomCircuitBreaker {
  private quarantine: QuarantineState | null = null;
  private compactionTooLargeBytes: number | null = null;
  private loadDeferredUntil: number | null = null;
  private hasLoggedQuarantine = false;
  private inFlightReload: Promise<boolean> | null = null;

  constructor(private options: RoomCircuitBreakerOptions) {}

  private get roomName(): string {
    return this.options.roomName;
  }

  private get storage(): RoomStorage {
    return this.options.storage;
  }

  getDocumentWarningBytes(): number {
    return this.options.readPositiveNumber(
      "QUARANTINE_DOCUMENT_BYTES",
      this.options.defaults.documentWarningBytes
    );
  }

  getCompactionMaxInDurableObjectBytes(): number {
    return this.options.readPositiveNumber(
      "COMPACTION_MAX_IN_DO_BYTES",
      this.options.defaults.maxInDurableObjectBytes
    );
  }

  private getFailureThreshold(): number {
    return this.options.readPositiveNumber(
      "QUARANTINE_FAILURE_THRESHOLD",
      this.options.defaults.failureThreshold
    );
  }

  private getFailureBackoffBaseMs(): number {
    return this.options.readPositiveNumber(
      "FAILURE_BACKOFF_MS",
      this.options.defaults.failureBackoffMs
    );
  }

  private getFailureBackoffMaxMs(): number {
    return this.options.readPositiveNumber(
      "FAILURE_BACKOFF_MAX_MS",
      this.options.defaults.failureBackoffMaxMs
    );
  }

  isQuarantined(): boolean {
    return this.quarantine !== null;
  }

  getQuarantineState(): QuarantineState | null {
    return this.quarantine;
  }

  isLoadDeferred(): boolean {
    return this.loadDeferredUntil !== null;
  }

  setLoadDeferredUntil(retryAt: number | null): void {
    this.loadDeferredUntil = retryAt;
  }

  private failureKeyFor(kind: FailureKind): string {
    return kind === "load"
      ? STORAGE_KEYS.quarantineLoadAttempts
      : STORAGE_KEYS.alarmFailureAttempts;
  }

  private retryKeyFor(kind: FailureKind): string {
    return kind === "load"
      ? STORAGE_KEYS.loadRetryAfter
      : STORAGE_KEYS.alarmRetryAfter;
  }

  async getFailureCount(kind: FailureKind): Promise<number> {
    const value = await this.storage.get(this.failureKeyFor(kind));
    return typeof value === "number" ? value : 0;
  }

  async getFailureRetryAfter(kind: FailureKind): Promise<number | null> {
    const value = await this.storage.get(this.retryKeyFor(kind));
    return typeof value === "number" ? value : null;
  }

  async getCompactionParkedBytes(): Promise<number | null> {
    const value = await this.storage.get(STORAGE_KEYS.compactionParked);
    return typeof value === "number" ? value : null;
  }

  /**
   * Records that risky work is starting before the operation can kill the
   * isolate. A successful or observed failure clears this evidence.
   */
  async beginRiskyOperation(kind: FailureKind): Promise<number> {
    const attempt = (await this.getFailureCount(kind)) + 1;
    await this.storage.put(this.failureKeyFor(kind), attempt);
    return attempt;
  }

  async completeRiskyOperation(kind: FailureKind): Promise<void> {
    await this.storage.delete(this.failureKeyFor(kind));
    await this.storage.delete(this.retryKeyFor(kind));
  }

  async releaseLoadAttempt(loadAttempts: number): Promise<void> {
    const remaining = loadAttempts - 1;
    if (remaining <= 0) {
      await this.completeRiskyOperation("load");
      return;
    }

    await this.storage.put(STORAGE_KEYS.quarantineLoadAttempts, remaining);
    await this.storage.delete(STORAGE_KEYS.loadRetryAfter);
  }

  private async handleRepeatedFailures({
    kind,
    failureCount,
    retryFailureCount = failureCount,
  }: {
    kind: FailureKind;
    failureCount: number;
    retryFailureCount?: number;
  }): Promise<{ quarantined: boolean; retryAt: number }> {
    const failureThreshold = this.getFailureThreshold();

    if (shouldQuarantineForFailures({ failureCount, failureThreshold })) {
      await this.enterQuarantine({
        reason: "repeated-failures",
        detail: `${kind} work failed ${failureCount} times in a row`,
        failureKind: kind,
        failureCount,
      });
      return { quarantined: true, retryAt: 0 };
    }

    const retryAt = getFailureRetryAt({
      failureCount: retryFailureCount,
      baseMs: this.getFailureBackoffBaseMs(),
      maxMs: this.getFailureBackoffMaxMs(),
      now: Date.now(),
    });
    await this.storage.put(this.retryKeyFor(kind), retryAt);

    console.error(
      formatFailureBackoffLog({
        roomName: this.roomName,
        failureKind: kind,
        failureCount,
        retryAt,
        failureThreshold,
      })
    );

    return { quarantined: false, retryAt };
  }

  async shouldDeferLoad(): Promise<boolean> {
    const previousFailures = await this.getFailureCount("load");
    if (previousFailures === 0) return false;

    const failureThreshold = this.getFailureThreshold();
    if (
      shouldQuarantineForFailures({
        failureCount: previousFailures,
        failureThreshold,
      })
    ) {
      await this.enterQuarantine({
        reason: "repeated-failures",
        detail: `load work failed ${previousFailures} times in a row`,
        failureKind: "load",
        failureCount: previousFailures,
      });
      return true;
    }

    const retryAfter = await this.getFailureRetryAfter("load");
    if (retryAfter === null) {
      const firstRetryAt = getFailureRetryAt({
        failureCount: previousFailures,
        baseMs: this.getFailureBackoffBaseMs(),
        maxMs: this.getFailureBackoffMaxMs(),
        now: Date.now(),
      });
      await this.storage.put(STORAGE_KEYS.loadRetryAfter, firstRetryAt);
      this.deferLoad(firstRetryAt, previousFailures);
      return true;
    }

    if (!isRetryDue({ retryAfter, now: Date.now() })) {
      this.deferLoad(retryAfter, previousFailures);
      return true;
    }

    const nextRetryAt = getFailureRetryAt({
      failureCount: previousFailures + 1,
      baseMs: this.getFailureBackoffBaseMs(),
      maxMs: this.getFailureBackoffMaxMs(),
      now: Date.now(),
    });
    await this.storage.put(STORAGE_KEYS.loadRetryAfter, nextRetryAt);

    console.error(
      formatFailureBackoffLog({
        roomName: this.roomName,
        failureKind: "load",
        failureCount: previousFailures,
        retryAt: nextRetryAt,
        failureThreshold,
      }) + " Attempting hydration now."
    );
    return false;
  }

  private deferLoad(retryAt: number, failureCount: number): void {
    this.loadDeferredUntil = retryAt;
    console.error(
      formatFailureBackoffLog({
        roomName: this.roomName,
        failureKind: "load",
        failureCount,
        retryAt,
        failureThreshold: this.getFailureThreshold(),
      }) + " Serving 503 until the deadline; the document was not read."
    );
  }

  async loadStoredQuarantine(): Promise<void> {
    const value = await this.storage.get(STORAGE_KEYS.quarantine);
    this.quarantine = (value as QuarantineState | undefined) ?? null;
  }

  async enterQuarantine({
    reason,
    detail,
    failureKind,
    failureCount,
    skipExternalWrite = false,
  }: EnterQuarantineOptions): Promise<void> {
    const quarantine: QuarantineState = {
      reason,
      detail,
      failureKind,
      failureCount,
      quarantinedAt: Date.now(),
    };
    this.quarantine = quarantine;
    await this.storage.put(STORAGE_KEYS.quarantine, quarantine);

    await this.enterQuarantineRuntimeState();

    if (!skipExternalWrite) {
      await this.writeExternalQuarantineFlag(detail);
    }

    await this.options.startRealtimeSync();
  }

  async enterQuarantineRuntimeState(): Promise<void> {
    const quarantine = this.quarantine;
    if (quarantine === null) {
      throw new Error(
        "Cannot enter quarantine runtime state without a quarantine"
      );
    }

    this.options.activateTransientPersistence(quarantine);
    this.loadDeferredUntil = null;
    await this.cancelAlarm();

    if (this.hasLoggedQuarantine) return;
    this.hasLoggedQuarantine = true;
    console.error(
      formatQuarantineLog({
        roomName: this.roomName,
        reason: quarantine.reason,
        detail: quarantine.detail,
        failureKind: quarantine.failureKind,
        failureCount: quarantine.failureCount,
      })
    );
  }

  async cancelAlarm(): Promise<void> {
    await this.storage.deleteAlarm?.();
  }

  private getQuarantineControlKey(): string {
    return `quarantine:${this.roomName}`;
  }

  async applyExternalQuarantineFlag(): Promise<void> {
    const kv = this.options.getQuarantineControl();
    if (kv === null) return;

    let flag: string | null;
    try {
      flag = await kv.get(this.getQuarantineControlKey());
    } catch (error) {
      console.warn(
        `[PartyServer] Quarantine control lookup failed for room=${this.roomName}; proceeding normally. ` +
          `reason=${getErrorMessage(error)}`
      );
      return;
    }

    if (flag === null) return;

    await this.enterQuarantine({
      reason: "manual",
      detail: flag || "no reason given",
      failureKind: null,
      failureCount: 0,
      skipExternalWrite: true,
    });
  }

  private async writeExternalQuarantineFlag(
    detail: string | null
  ): Promise<void> {
    const kv = this.options.getQuarantineControl();
    if (kv === null) return;

    const key = this.getQuarantineControlKey();
    try {
      if (detail === null) {
        await kv.delete(key);
      } else {
        await kv.put(key, detail);
      }
    } catch (error) {
      console.error(
        `[PartyServer] Quarantine control write FAILED for room=${this.roomName}; ` +
          `the pre-hydration flag is NOT set and will not survive a restart. ` +
          `reason=${getErrorMessage(error)}`
      );
      throw error;
    }
  }

  async getLoadDeferredResponse(): Promise<Response | null> {
    if (this.loadDeferredUntil === null) return null;

    if (Date.now() >= this.loadDeferredUntil) {
      const recovered = await this.attemptDeferredReload();
      if (recovered) return null;
    }

    if (this.loadDeferredUntil === null) return null;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((this.loadDeferredUntil - Date.now()) / 1000)
    );

    return new Response(
      JSON.stringify({
        error: "room_load_deferred",
        message:
          "This room failed to load and is waiting before trying again. Its data is intact and was not read or modified.",
        roomId: this.roomName,
        retryAfterSeconds,
        retryAt: new Date(this.loadDeferredUntil).toISOString(),
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfterSeconds),
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  private async attemptDeferredReload(): Promise<boolean> {
    if (this.inFlightReload) return this.inFlightReload;

    const attempt = (async () => {
      try {
        const previousFailures = await this.getFailureCount("load");
        const failureThreshold = this.getFailureThreshold();

        if (
          shouldQuarantineForFailures({
            failureCount: previousFailures,
            failureThreshold,
          })
        ) {
          await this.enterQuarantine({
            reason: "repeated-failures",
            detail: `load work failed ${previousFailures} times in a row`,
            failureKind: "load",
            failureCount: previousFailures,
          });
          this.loadDeferredUntil = null;
          return false;
        }

        const nextRetryAt = getFailureRetryAt({
          failureCount: previousFailures + 1,
          baseMs: this.getFailureBackoffBaseMs(),
          maxMs: this.getFailureBackoffMaxMs(),
          now: Date.now(),
        });
        await this.storage.put(STORAGE_KEYS.loadRetryAfter, nextRetryAt);

        if (previousFailures === 0) {
          console.log(
            `[PartyServer] Starting guarded hydration after quarantine clear: room=${this.roomName}`
          );
        } else {
          console.error(
            formatFailureBackoffLog({
              roomName: this.roomName,
              failureKind: "load",
              failureCount: previousFailures,
              retryAt: nextRetryAt,
              failureThreshold,
            }) + " Retrying hydration in place now."
          );
        }

        this.loadDeferredUntil = null;
        const recovered = await this.options.reloadRoom();
        if (recovered) {
          console.log(
            `[PartyServer] Room recovered after deferral: room=${this.roomName}`
          );
          return true;
        }

        this.loadDeferredUntil = nextRetryAt;
        return false;
      } catch (error) {
        console.error(
          `[PartyServer] Deferred reload failed for room=${this.roomName}:`,
          error
        );
        this.loadDeferredUntil = await this.getFailureRetryAfter("load");
        return false;
      } finally {
        this.inFlightReload = null;
      }
    })();

    this.inFlightReload = attempt;
    return attempt;
  }

  markCompactionTooLarge(documentBytes: number): void {
    this.compactionTooLargeBytes = documentBytes;
  }

  async parkCompactionIfTooLarge(): Promise<boolean> {
    const documentBytes = this.compactionTooLargeBytes;
    this.compactionTooLargeBytes = null;
    if (documentBytes === null) return false;

    const alreadyParked = await this.getCompactionParkedBytes();
    await this.storage.put(STORAGE_KEYS.compactionParked, documentBytes);
    await this.options.clearCompactionSchedule();

    if (alreadyParked === null) {
      console.error(
        formatCompactionSkipLog({
          roomName: this.roomName,
          documentBytes,
          maxBytes: this.getCompactionMaxInDurableObjectBytes(),
        })
      );
    }
    return true;
  }

  async assertCanCompactDocument(documentBytes: number): Promise<void> {
    const maxBytes = this.getCompactionMaxInDurableObjectBytes();
    if (
      !isTooLargeToCompactInDurableObject({
        documentBytes,
        maxBytes,
      })
    ) {
      return;
    }

    this.compactionTooLargeBytes = documentBytes;
    await this.parkCompactionIfTooLarge();
    throw new ExternalCompactionRequiredError(documentBytes, maxBytes);
  }

  assertNotQuarantined(operation: string): void {
    if (!this.isQuarantined()) return;
    throw new Error(
      `Refusing to ${operation} for quarantined room ${this.roomName}: the persisted document was never hydrated, so this would overwrite or reload data that is known to crash the room. Clear quarantine only after shrinking or repairing the document.`
    );
  }

  async clearQuarantine(): Promise<QuarantineResetSummary> {
    const summary = {
      wasQuarantined: this.quarantine !== null,
      loadFailures: await this.getFailureCount("load"),
      alarmFailures: await this.getFailureCount("alarm"),
      wasLoadDeferred: this.loadDeferredUntil !== null,
    };
    const needsGuardedReload =
      summary.wasQuarantined || summary.wasLoadDeferred;

    await this.writeExternalQuarantineFlag(null);

    this.quarantine = null;
    this.hasLoggedQuarantine = false;
    this.options.prepareGuardedReload();
    this.loadDeferredUntil = needsGuardedReload ? Date.now() : null;
    await this.storage.delete(STORAGE_KEYS.quarantine);
    await this.storage.delete(STORAGE_KEYS.quarantineLoadAttempts);
    await this.storage.delete(STORAGE_KEYS.alarmFailureAttempts);
    await this.storage.delete(STORAGE_KEYS.loadRetryAfter);
    await this.storage.delete(STORAGE_KEYS.alarmRetryAfter);
    console.log(
      `[PartyServer] Quarantine cleared for room=${this.roomName}: ` +
        `wasQuarantined=${summary.wasQuarantined}, ` +
        `loadFailuresReset=${summary.loadFailures}, ` +
        `alarmFailuresReset=${summary.alarmFailures}, ` +
        `wasLoadDeferred=${summary.wasLoadDeferred}, ` +
        `recoveryPending=${needsGuardedReload}.`
    );
    return summary;
  }

  async clearCompactionPark(): Promise<void> {
    await this.storage.delete(STORAGE_KEYS.compactionParked);
  }

  async readExternalQuarantineFlag(): Promise<
    { available: true; value: string | null } | { available: false }
  > {
    const kv = this.options.getQuarantineControl();
    if (kv === null) return { available: false };
    try {
      return {
        available: true,
        value: await kv.get(this.getQuarantineControlKey()),
      };
    } catch {
      return { available: false };
    }
  }

  hasQuarantineControlPlane(): boolean {
    return this.options.getQuarantineControl() !== null;
  }

  async getQuarantineStatusBody() {
    return createQuarantineStatusBody({
      roomName: this.roomName,
      quarantine: this.quarantine,
      documentWarningBytes: this.getDocumentWarningBytes(),
      maxInDurableObjectBytes: this.getCompactionMaxInDurableObjectBytes(),
      failureThreshold: this.getFailureThreshold(),
      loadFailures: await this.getFailureCount("load"),
      alarmFailures: await this.getFailureCount("alarm"),
      loadRetryAfter: await this.getFailureRetryAfter("load"),
      alarmRetryAfter: await this.getFailureRetryAfter("alarm"),
      compactionParkedBytes: await this.getCompactionParkedBytes(),
      loadDeferredUntil: this.loadDeferredUntil,
      externalFlag: await this.readExternalQuarantineFlag(),
    });
  }

  async shouldRunAlarm(): Promise<boolean> {
    if (this.isQuarantined()) {
      console.warn(
        `[PartyServer] Alarm skipped for quarantined room=${this.roomName}; canceling pending alarms.`
      );
      await this.cancelAlarm();
      return false;
    }

    const previousFailures = await this.getFailureCount("alarm");
    if (previousFailures === 0) return true;

    const retryAfter = await this.getFailureRetryAfter("alarm");
    if (!isRetryDue({ retryAfter, now: Date.now() })) {
      if (retryAfter === null) {
        throw new Error("Alarm retry was deferred without a retry deadline");
      }
      await this.storage.setAlarm?.(retryAfter);
      return false;
    }

    const outcome = await this.handleRepeatedFailures({
      kind: "alarm",
      failureCount: previousFailures,
      retryFailureCount:
        retryAfter === null ? previousFailures : previousFailures + 1,
    });
    if (outcome.quarantined) return false;

    if (retryAfter === null) {
      await this.storage.setAlarm?.(outcome.retryAt);
      return false;
    }

    return true;
  }
}
