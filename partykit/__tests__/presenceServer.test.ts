// ABOUTME: Verifies generic presence server lifecycle diagnostics.
// ABOUTME: Keeps expected WebSocket closes from polluting Worker logs.
import { describe, expect, it } from "bun:test";
import { getConnectionCloseDiagnostic } from "../connectionDiagnostics";
import {
  assertPresenceMessageSize,
  persistPresenceConnectionState,
} from "../presenceMessage";

describe("presence server message size", () => {
  it("accepts a 1 MiB message", () => {
    expect(() =>
      assertPresenceMessageSize("x".repeat(1024 * 1024)),
    ).not.toThrow();
  });

  it("rejects a message larger than 1 MiB", () => {
    expect(() => assertPresenceMessageSize("x".repeat(1024 * 1024 + 1))).toThrow(
      "Presence messages must be 1 MiB or less",
    );
  });
});

describe("presence connection state persistence", () => {
  it("restores the previous state after a rejected attachment write", () => {
    const previous = { channels: { status: "away" } };
    const next = { channels: { status: "x".repeat(20_000) } };
    let stored = previous;

    expect(() =>
      persistPresenceConnectionState(previous, next, (state) => {
        stored = state;
        if (state === next) throw new Error("attachment too large");
      }),
    ).toThrow("Presence state exceeds server storage limit");

    expect(stored).toBe(previous);
  });
});

describe("presence server diagnostics", () => {
  it("treats normal and clean no-code closes as expected", () => {
    const base = {
      roomName: "presence-room",
      connectionId: "conn-1",
      reason: "",
      wasClean: true,
      quietCloseCodes: [1000, 1005],
      label: "PresenceServer",
    };

    expect(getConnectionCloseDiagnostic({ ...base, code: 1000 })).toBe(null);
    expect(getConnectionCloseDiagnostic({ ...base, code: 1005 })).toBe(null);
  });

  it("keeps unclean and error closes diagnosable", () => {
    expect(
      getConnectionCloseDiagnostic({
        roomName: "presence-room",
        connectionId: "conn-1",
        code: 1005,
        reason: "",
        wasClean: false,
        openedAt: 1_000,
        now: 1_500,
        quietCloseCodes: [1000, 1005],
        label: "PresenceServer",
      }),
    ).toBe(
      '[PresenceServer] WebSocket closed abnormally: room=presence-room connection=conn-1 code=1005 reason="" wasClean=false durationMs=500',
    );
  });
});
