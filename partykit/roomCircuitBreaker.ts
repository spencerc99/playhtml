// ABOUTME: Owns room quarantine and retry state for load, alarm, and compaction work.
// ABOUTME: Keeps failure recovery policy separate from PartyServer synchronization.
import {
  DEFAULT_COMPACTION_DISABLE_AFTER,
  DEFAULT_COMPACTION_RETRY_DELAYS_MS,
  STORAGE_KEYS,
} from "./const";
import { getErrorMessage } from "./persistenceMode";
import {
  createQuarantineStatusBody,
  formatCompactionBackoffLog,
  formatCompactionDisabledLog,
  formatFailureBackoffLog,
  formatQuarantineLog,
  getCompactionRetryDelayMs,
  getFailureRetryAt,
  isRetryDue,
  shouldDisableCompaction,
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
    failureThreshold: number;
    failureBackoffMs: number;
    failureBackoffMaxMs: number;
  };
  activateTransientPersistence: (quarantine: QuarantineState) => void;
  startRealtimeSync: () => Promise<void>;
  reloadRoom: () => Promise<boolean>;
  prepareGuardedReload: () => void;
  clearCompactionSchedule: () => Promise<void>;
  scheduleRoomWork: () => Promise<void>;
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

export type CompactionAdmission =
  | { kind: "run" }
  | { kind: "defer"; retryAt: number }
  | { kind: "disabled"; disabledAt: number };

export type CompactionResetSummary = {
  failures: number;
  retryAfter: number | null;
  disabledAt: number | null;
};

export class RoomCircuitBreaker {
  private quarantine: QuarantineState | null = null;
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

  private async requestPersistenceRecovery(): Promise<void> {
    await this.storage.put(STORAGE_KEYS.persistenceRecoveryPending, true);
    await this.storage.put(STORAGE_KEYS.loadRetryAfter, Date.now());
  }

  async getCompactionFailureCount(): Promise<number> {
    const value = await this.storage.get(STORAGE_KEYS.compactionAttempts);
    return typeof value === "number" ? value : 0;
  }

  async getCompactionRetryAfter(): Promise<number | null> {
    const value = await this.storage.get(STORAGE_KEYS.compactionRetryAfter);
    return typeof value === "number" ? value : null;
  }

  async getCompactionDisabledAt(): Promise<number | null> {
    const value = await this.storage.get(STORAGE_KEYS.compactionDisabledAt);
    return typeof value === "number" ? value : null;
  }

  async beginCompactionAttempt(): Promise<number> {
    const attempt = (await this.getCompactionFailureCount()) + 1;
    await this.storage.put(STORAGE_KEYS.compactionAttempts, attempt);
    return attempt;
  }

  async completeCompactionAttempt(): Promise<void> {
    await this.storage.delete(STORAGE_KEYS.compactionAttempts);
    await this.storage.delete(STORAGE_KEYS.compactionRetryAfter);
    await this.storage.delete(STORAGE_KEYS.compactionDisabledAt);
  }

  async getCompactionAdmission(): Promise<CompactionAdmission> {
    const disabledAt = await this.getCompactionDisabledAt();
    if (disabledAt !== null) {
      return { kind: "disabled", disabledAt };
    }

    const failures = await this.getCompactionFailureCount();
    if (
      shouldDisableCompaction({
        failureCount: failures,
        disableAfter: DEFAULT_COMPACTION_DISABLE_AFTER,
      })
    ) {
      const now = Date.now();
      await this.storage.put(STORAGE_KEYS.compactionDisabledAt, now);
      await this.storage.delete(STORAGE_KEYS.compactionRetryAfter);
      await this.options.clearCompactionSchedule();
      console.error(
        formatCompactionDisabledLog({
          roomName: this.roomName,
          failureCount: failures,
        })
      );
      return { kind: "disabled", disabledAt: now };
    }

    if (failures === 0) return { kind: "run" };

    const retryAfter = await this.getCompactionRetryAfter();
    if (retryAfter !== null && !isRetryDue({ retryAfter, now: Date.now() })) {
      return { kind: "defer", retryAt: retryAfter };
    }

    if (retryAfter === null) {
      const delayMs = getCompactionRetryDelayMs({
        failureCount: failures,
        retryDelaysMs: DEFAULT_COMPACTION_RETRY_DELAYS_MS,
      });
      if (delayMs === null) {
        throw new Error(
          `Missing compaction retry delay for failure ${failures}`
        );
      }
      const firstRetryAt = Date.now() + delayMs;
      await this.storage.put(STORAGE_KEYS.compactionRetryAfter, firstRetryAt);
      console.error(
        formatCompactionBackoffLog({
          roomName: this.roomName,
          failureCount: failures,
          retryAt: firstRetryAt,
        })
      );
      return { kind: "defer", retryAt: firstRetryAt };
    }

    const nextDelayMs = getCompactionRetryDelayMs({
      failureCount: failures + 1,
      retryDelaysMs: DEFAULT_COMPACTION_RETRY_DELAYS_MS,
    });
    if (nextDelayMs === null) {
      await this.storage.delete(STORAGE_KEYS.compactionRetryAfter);
    } else {
      await this.storage.put(
        STORAGE_KEYS.compactionRetryAfter,
        Date.now() + nextDelayMs
      );
    }
    return { kind: "run" };
  }

  async clearCompactionFailure(): Promise<CompactionResetSummary> {
    const summary = {
      failures: await this.getCompactionFailureCount(),
      retryAfter: await this.getCompactionRetryAfter(),
      disabledAt: await this.getCompactionDisabledAt(),
    };
    await this.completeCompactionAttempt();
    console.log(
      `[PartyServer] Automatic compaction re-enabled for room=${this.roomName}: ` +
        `failuresReset=${summary.failures}, ` +
        `retryAfterReset=${summary.retryAfter ?? "none"}, ` +
        `wasDisabled=${summary.disabledAt !== null}.`
    );
    return summary;
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

  async deferFailedLoad(failureCount: number): Promise<void> {
    const result = await this.handleRepeatedFailures({
      kind: "load",
      failureCount,
    });
    this.loadDeferredUntil = result.quarantined ? null : result.retryAt;
  }

  /**
   * A returned load error proves the isolate survived, so it is not evidence
   * of the vanished work this circuit breaker quarantines.
   */
  async deferObservedLoadFailure(): Promise<void> {
    await this.completeRiskyOperation("load");
    const retryAt = getFailureRetryAt({
      failureCount: 1,
      baseMs: this.getFailureBackoffBaseMs(),
      maxMs: this.getFailureBackoffMaxMs(),
      now: Date.now(),
    });
    await this.storage.put(STORAGE_KEYS.loadRetryAfter, retryAt);
    this.loadDeferredUntil = retryAt;
  }

  async shouldDeferLoad(): Promise<boolean> {
    const previousFailures = await this.getFailureCount("load");
    if (previousFailures === 0) {
      const retryAfter = await this.getFailureRetryAfter("load");
      if (retryAfter !== null && !isRetryDue({ retryAfter, now: Date.now() })) {
        this.loadDeferredUntil = retryAfter;
      }
      return false;
    }

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

  /** Provider outages stay transient for clients while the alarm waits to retry. */
  async getClientLoadDeferredResponse(): Promise<Response | null> {
    if ((await this.getFailureCount("load")) === 0) {
      const retryAfter = await this.getFailureRetryAfter("load");
      if (retryAfter !== null && !isRetryDue({ retryAfter, now: Date.now() })) {
        return null;
      }
    }
    return this.getLoadDeferredResponse();
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

  assertNotQuarantined(operation: string): void {
    if (!this.isQuarantined()) return;
    throw new Error(
      `Refusing to ${operation} for quarantined room ${this.roomName}: the persisted document was never hydrated, so this would overwrite or reload data that is known to crash the room. Clear quarantine only after shrinking or repairing the document.`
    );
  }

  async clearQuarantine(options?: {
    recoveryCompleted?: boolean;
  }): Promise<QuarantineResetSummary> {
    const summary = {
      wasQuarantined: this.quarantine !== null,
      loadFailures: await this.getFailureCount("load"),
      alarmFailures: await this.getFailureCount("alarm"),
      wasLoadDeferred: this.loadDeferredUntil !== null,
    };
    const needsGuardedReload =
      !options?.recoveryCompleted &&
      (summary.wasQuarantined || summary.wasLoadDeferred);

    await this.writeExternalQuarantineFlag(null);

    this.quarantine = null;
    this.hasLoggedQuarantine = false;
    this.options.prepareGuardedReload();
    this.loadDeferredUntil = needsGuardedReload ? Date.now() : null;
    await this.storage.delete(STORAGE_KEYS.quarantine);
    if (needsGuardedReload) {
      await this.requestPersistenceRecovery();
    } else {
      await this.storage.delete(STORAGE_KEYS.quarantineLoadAttempts);
      await this.storage.delete(STORAGE_KEYS.loadRetryAfter);
      await this.storage.delete(STORAGE_KEYS.persistenceRecoveryPending);
    }
    await this.storage.delete(STORAGE_KEYS.alarmFailureAttempts);
    await this.storage.delete(STORAGE_KEYS.alarmRetryAfter);
    await this.options.scheduleRoomWork();
    console.log(
      `[PartyServer] Quarantine cleared for room=${this.roomName}: ` +
        `wasQuarantined=${summary.wasQuarantined}, ` +
        `loadFailures=${summary.loadFailures}, ` +
        `alarmFailuresReset=${summary.alarmFailures}, ` +
        `wasLoadDeferred=${summary.wasLoadDeferred}, ` +
        `recoveryPending=${needsGuardedReload}.`
    );
    return summary;
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
      failureThreshold: this.getFailureThreshold(),
      loadFailures: await this.getFailureCount("load"),
      alarmFailures: await this.getFailureCount("alarm"),
      loadRetryAfter: await this.getFailureRetryAfter("load"),
      alarmRetryAfter: await this.getFailureRetryAfter("alarm"),
      compactionFailures: await this.getCompactionFailureCount(),
      compactionRetryAfter: await this.getCompactionRetryAfter(),
      compactionDisabledAt: await this.getCompactionDisabledAt(),
      compactionDisableAfter: DEFAULT_COMPACTION_DISABLE_AFTER,
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
