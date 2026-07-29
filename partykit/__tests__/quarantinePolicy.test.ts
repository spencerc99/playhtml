// ABOUTME: Verifies the policy decisions behind compaction skips, backoff, and quarantine.
// ABOUTME: Covers the size-warning boundary, the backoff ladder, and operator-facing logs.
import { describe, expect, test } from "bun:test";
import {
  createQuarantineStatusBody,
  formatCompactionSkipLog,
  formatFailureBackoffLog,
  formatQuarantineLog,
  getFailureBackoffMs,
  getFailureRetryAt,
  isDocumentOversized,
  isRetryDue,
  isTooLargeToCompactInDurableObject,
  shouldQuarantineForFailures,
} from "../quarantinePolicy";
import {
  DEFAULT_COMPACTION_MAX_IN_DO_BYTES,
  DEFAULT_FAILURE_BACKOFF_MAX_MS,
  DEFAULT_FAILURE_BACKOFF_MS,
  DEFAULT_QUARANTINE_DOCUMENT_BYTES,
  DEFAULT_QUARANTINE_FAILURE_THRESHOLD,
} from "../const";

const MB = 1024 * 1024;
const MINUTE = 60 * 1000;

describe("isDocumentOversized", () => {
  test("reports documents above the warning threshold", () => {
    expect(
      isDocumentOversized({
        documentBytes: DEFAULT_QUARANTINE_DOCUMENT_BYTES + 1,
        thresholdBytes: DEFAULT_QUARANTINE_DOCUMENT_BYTES,
      })
    ).toBe(true);
  });

  // Rooms that crash-loop on compaction sit in the 6-8MB band, and so do healthy
  // production rooms. Loading is not what kills them, so this must not fire.
  test("leaves the 6-8MB band alone", () => {
    for (const megabytes of [6, 7, 8]) {
      expect(
        isDocumentOversized({
          documentBytes: MB * megabytes,
          thresholdBytes: DEFAULT_QUARANTINE_DOCUMENT_BYTES,
        })
      ).toBe(false);
    }
  });
});

describe("isTooLargeToCompactInDurableObject", () => {
  // Compaction holds the live doc, its JSON projection, and the rebuild at once,
  // so rooms that survive loading still cannot be compacted in place.
  test("catches the 6-8MB band that OOMs during compaction", () => {
    for (const megabytes of [6, 7, 8, 13]) {
      expect(
        isTooLargeToCompactInDurableObject({
          documentBytes: MB * megabytes,
          maxBytes: DEFAULT_COMPACTION_MAX_IN_DO_BYTES,
        })
      ).toBe(true);
    }
  });

  test("leaves ordinary rooms compactable", () => {
    for (const kilobytes of [1, 64, 512, 2048]) {
      expect(
        isTooLargeToCompactInDurableObject({
          documentBytes: 1024 * kilobytes,
          maxBytes: DEFAULT_COMPACTION_MAX_IN_DO_BYTES,
        })
      ).toBe(false);
    }
  });

  test("the compaction ceiling sits well below the load warning", () => {
    expect(DEFAULT_COMPACTION_MAX_IN_DO_BYTES).toBeLessThan(
      DEFAULT_QUARANTINE_DOCUMENT_BYTES
    );
  });
});

describe("getFailureBackoffMs", () => {
  test("escalates 1min, 5min, 20min, 1h, 6h on the default base", () => {
    const baseMs = DEFAULT_FAILURE_BACKOFF_MS;
    const maxMs = DEFAULT_FAILURE_BACKOFF_MAX_MS;
    const ladder = [1, 2, 3, 4, 5].map((failureCount) =>
      getFailureBackoffMs({ failureCount, baseMs, maxMs })
    );

    expect(ladder).toEqual([
      1 * MINUTE,
      5 * MINUTE,
      20 * MINUTE,
      60 * MINUTE,
      360 * MINUTE,
    ]);
  });

  test("keeps growing past the ladder but never exceeds the cap", () => {
    const baseMs = DEFAULT_FAILURE_BACKOFF_MS;
    const maxMs = DEFAULT_FAILURE_BACKOFF_MAX_MS;

    for (let failureCount = 6; failureCount <= 20; failureCount += 1) {
      const delay = getFailureBackoffMs({ failureCount, baseMs, maxMs });
      expect(delay).toBeLessThanOrEqual(maxMs);
      expect(delay).toBeGreaterThan(0);
    }
    expect(getFailureBackoffMs({ failureCount: 20, baseMs, maxMs })).toBe(maxMs);
  });

  test("is monotonic, so retries never get more aggressive", () => {
    const baseMs = DEFAULT_FAILURE_BACKOFF_MS;
    const maxMs = DEFAULT_FAILURE_BACKOFF_MAX_MS;
    let previous = 0;
    for (let failureCount = 1; failureCount <= 12; failureCount += 1) {
      const delay = getFailureBackoffMs({ failureCount, baseMs, maxMs });
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  test("a cleared counter means no delay", () => {
    expect(
      getFailureBackoffMs({ failureCount: 0, baseMs: MINUTE, maxMs: MINUTE })
    ).toBe(0);
  });
});

describe("getFailureRetryAt and isRetryDue", () => {
  test("a retry is not due before its backoff elapses", () => {
    const now = 1_000_000;
    const retryAfter = getFailureRetryAt({
      failureCount: 2,
      baseMs: DEFAULT_FAILURE_BACKOFF_MS,
      maxMs: DEFAULT_FAILURE_BACKOFF_MAX_MS,
      now,
    });

    expect(retryAfter).toBe(now + 5 * MINUTE);
    expect(isRetryDue({ retryAfter, now })).toBe(false);
    expect(isRetryDue({ retryAfter, now: retryAfter })).toBe(true);
  });

  test("no recorded backoff means work may proceed", () => {
    expect(isRetryDue({ retryAfter: null, now: 1 })).toBe(true);
  });
});

describe("shouldQuarantineForFailures", () => {
  test("holds off until the high threshold is reached", () => {
    const failureThreshold = DEFAULT_QUARANTINE_FAILURE_THRESHOLD;
    for (const failureCount of [1, 3, 5, 7]) {
      expect(
        shouldQuarantineForFailures({ failureCount, failureThreshold })
      ).toBe(false);
    }
    expect(
      shouldQuarantineForFailures({ failureCount: 8, failureThreshold })
    ).toBe(true);
  });
});

describe("formatCompactionSkipLog", () => {
  test("names the room and points at the external compaction runbook", () => {
    const message = formatCompactionSkipLog({
      roomName: "kwolanne.github.io-offerings",
      documentBytes: 7 * MB,
      maxBytes: DEFAULT_COMPACTION_MAX_IN_DO_BYTES,
    });

    expect(message).toContain("REQUIRES EXTERNAL COMPACTION");
    expect(message).toContain("room=kwolanne.github.io-offerings");
    expect(message).toContain("admin/raw-data");
    expect(message).toContain("admin/restore-raw-document");
    // The room is explicitly NOT broken, which matters for triage.
    expect(message).toContain("loads and runs normally");
  });
});

describe("formatFailureBackoffLog", () => {
  test("reports the failing operation, the retry time, and self-healing", () => {
    const message = formatFailureBackoffLog({
      roomName: "example-room",
      failureKind: "alarm",
      failureCount: 2,
      retryAt: 1779829545000,
      failureThreshold: 8,
    });

    expect(message).toContain("ROOM WORK FAILING");
    expect(message).toContain("operation=alarm");
    expect(message).toContain("consecutiveFailures=2");
    expect(message).toContain("2026-05-26T21:05:45.000Z");
    expect(message).toContain("quarantineAfter=8");
    expect(message).toContain("clears itself");
  });
});

describe("formatQuarantineLog", () => {
  test("explains an operator-initiated quarantine", () => {
    const message = formatQuarantineLog({
      roomName: "example-room",
      reason: "manual",
      detail: "investigating runaway growth",
      failureKind: null,
      failureCount: 0,
    });

    expect(message).toContain("ROOM QUARANTINED");
    expect(message).toContain("reason=manual");
    expect(message).toContain("investigating runaway growth");
    expect(message).toContain("admin/quarantine-clear");
  });

  test("explains a last-resort automatic quarantine", () => {
    const message = formatQuarantineLog({
      roomName: "example-room",
      reason: "repeated-failures",
      detail: "alarm work failed 8 times in a row",
      failureKind: "alarm",
      failureCount: 8,
    });

    expect(message).toContain("reason=repeated-failures");
    expect(message).toContain("exhausted the retry backoff");
    expect(message).toContain("will NOT be overwritten");
    expect(message).toContain("TRANSIENT MODE");
  });
});

describe("createQuarantineStatusBody", () => {
  test("reports a healthy room with no failures and no parking", () => {
    const body = createQuarantineStatusBody({
      roomName: "healthy-room",
      quarantine: null,
      documentWarningBytes: DEFAULT_QUARANTINE_DOCUMENT_BYTES,
      maxInDurableObjectBytes: DEFAULT_COMPACTION_MAX_IN_DO_BYTES,
      failureThreshold: 8,
      loadFailures: 0,
      alarmFailures: 0,
      loadRetryAfter: null,
      alarmRetryAfter: null,
      compactionParkedBytes: null,
    });

    expect(body.quarantined).toBe(false);
    expect(body.failures).toEqual({
      load: 0,
      alarm: 0,
      quarantineAfter: 8,
      loadRetryAfter: null,
      alarmRetryAfter: null,
    });
    expect(body.compaction.parked).toBe(false);
  });

  test("surfaces backoff state and compaction parking for triage", () => {
    const body = createQuarantineStatusBody({
      roomName: "sick-room",
      quarantine: {
        reason: "repeated-failures",
        detail: "alarm work failed 8 times in a row",
        failureKind: "alarm",
        failureCount: 8,
        quarantinedAt: 1779829545000,
      },
      documentWarningBytes: DEFAULT_QUARANTINE_DOCUMENT_BYTES,
      maxInDurableObjectBytes: DEFAULT_COMPACTION_MAX_IN_DO_BYTES,
      failureThreshold: 8,
      loadFailures: 0,
      alarmFailures: 8,
      loadRetryAfter: null,
      alarmRetryAfter: 1779829545000,
      compactionParkedBytes: 7 * MB,
    });

    expect(body.quarantined).toBe(true);
    expect(body.reason).toBe("repeated-failures");
    expect(body.quarantinedAt).toBe("2026-05-26T21:05:45.000Z");
    expect(body.failures.alarm).toBe(8);
    expect(body.failures.alarmRetryAfter).toBe("2026-05-26T21:05:45.000Z");
    // A load that never failed keeps a null deadline of its own.
    expect(body.failures.loadRetryAfter).toBeNull();
    expect(body.compaction).toEqual({
      parked: true,
      documentBytes: 7 * MB,
      maxInDurableObjectBytes: DEFAULT_COMPACTION_MAX_IN_DO_BYTES,
    });
  });
});
