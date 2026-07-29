// ABOUTME: Verifies the load-time quarantine decisions that stop OOM crash loops.
// ABOUTME: Covers the size gate, the crash-loop counter, operator logs, and status payloads.
import { describe, expect, test } from "bun:test";
import {
  createQuarantineStatusBody,
  formatQuarantineLog,
  shouldQuarantineForDocumentSize,
  shouldQuarantineForLoadAttempts,
  DEFAULT_QUARANTINE_LOAD_ATTEMPTS,
} from "../quarantinePolicy";
import { DEFAULT_QUARANTINE_DOCUMENT_BYTES } from "../const";

const SIX_MB = 1024 * 1024 * 6;

describe("shouldQuarantineForDocumentSize", () => {
  test("quarantines documents above the threshold", () => {
    expect(
      shouldQuarantineForDocumentSize({
        documentBytes: SIX_MB + 1,
        thresholdBytes: SIX_MB,
      }),
    ).toBe(true);
  });

  test("leaves documents at or below the threshold alone", () => {
    expect(
      shouldQuarantineForDocumentSize({
        documentBytes: SIX_MB,
        thresholdBytes: SIX_MB,
      }),
    ).toBe(false);
    expect(
      shouldQuarantineForDocumentSize({
        documentBytes: 1024,
        thresholdBytes: SIX_MB,
      }),
    ).toBe(false);
  });

  // The two live rooms that crash-loop sit at 7-8MB, and one observed document
  // reached 13MB. The default threshold must catch all of them.
  test("the default threshold catches the observed lethal document sizes", () => {
    for (const megabytes of [7, 8, 13]) {
      expect(
        shouldQuarantineForDocumentSize({
          documentBytes: 1024 * 1024 * megabytes,
          thresholdBytes: DEFAULT_QUARANTINE_DOCUMENT_BYTES,
        }),
      ).toBe(true);
    }
  });

  test("the default threshold leaves ordinary rooms untouched", () => {
    for (const kilobytes of [1, 64, 512, 4096]) {
      expect(
        shouldQuarantineForDocumentSize({
          documentBytes: 1024 * kilobytes,
          thresholdBytes: DEFAULT_QUARANTINE_DOCUMENT_BYTES,
        }),
      ).toBe(false);
    }
  });
});

describe("shouldQuarantineForLoadAttempts", () => {
  test("allows the first attempts and trips at the configured maximum", () => {
    const maxLoadAttempts = DEFAULT_QUARANTINE_LOAD_ATTEMPTS;
    expect(
      shouldQuarantineForLoadAttempts({ loadAttempts: 0, maxLoadAttempts }),
    ).toBe(false);
    expect(
      shouldQuarantineForLoadAttempts({ loadAttempts: 2, maxLoadAttempts }),
    ).toBe(false);
    expect(
      shouldQuarantineForLoadAttempts({ loadAttempts: 3, maxLoadAttempts }),
    ).toBe(true);
    expect(
      shouldQuarantineForLoadAttempts({ loadAttempts: 9, maxLoadAttempts }),
    ).toBe(true);
  });
});

describe("formatQuarantineLog", () => {
  test("names the room, the size reason, and the recovery procedure", () => {
    const message = formatQuarantineLog({
      roomName: "aliaelkattan.com-music-room",
      reason: "document-size",
      documentBytes: 8_000_000,
      thresholdBytes: SIX_MB,
      loadAttempts: 1,
    });

    expect(message).toContain("ROOM QUARANTINED");
    expect(message).toContain("room=aliaelkattan.com-music-room");
    expect(message).toContain("reason=document-size");
    expect(message).toContain("documentBytes=8000000");
    expect(message).toContain("too large to hydrate");
    expect(message).toContain("will NOT be overwritten");
    expect(message).toContain("admin/quarantine-clear");
  });

  test("explains the crash-loop reason when the size gate did not fire", () => {
    const message = formatQuarantineLog({
      roomName: "kwolanne.github.io-offerings",
      reason: "crash-loop",
      documentBytes: null,
      thresholdBytes: SIX_MB,
      loadAttempts: 3,
    });

    expect(message).toContain("reason=crash-loop");
    expect(message).toContain("documentBytes=unknown");
    expect(message).toContain("hydration failed 3 times");
    expect(message).toContain("TRANSIENT MODE");
  });
});

describe("createQuarantineStatusBody", () => {
  test("reports a healthy room as not quarantined", () => {
    const body = createQuarantineStatusBody({
      roomName: "healthy-room",
      quarantine: null,
      thresholdBytes: SIX_MB,
      maxLoadAttempts: 3,
      loadAttempts: 0,
    });

    expect(body).toEqual({
      roomId: "healthy-room",
      quarantined: false,
      reason: null,
      documentBytes: null,
      quarantinedAt: null,
      loadAttempts: 0,
      thresholdBytes: SIX_MB,
      maxLoadAttempts: 3,
    });
  });

  test("reports the reason and size for a quarantined room", () => {
    const body = createQuarantineStatusBody({
      roomName: "sick-room",
      quarantine: {
        reason: "document-size",
        documentBytes: 8_000_000,
        loadAttempts: 1,
        quarantinedAt: 1779829545000,
      },
      thresholdBytes: SIX_MB,
      maxLoadAttempts: 3,
      loadAttempts: 1,
    });

    expect(body.quarantined).toBe(true);
    expect(body.reason).toBe("document-size");
    expect(body.documentBytes).toBe(8_000_000);
    expect(body.quarantinedAt).toBe("2026-05-26T21:05:45.000Z");
  });
});
