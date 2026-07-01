// ABOUTME: Verifies generic presence server lifecycle diagnostics.
// ABOUTME: Keeps expected WebSocket closes from polluting Worker logs.
import { describe, expect, it } from "bun:test";
import { getConnectionCloseDiagnostic } from "../connectionDiagnostics";

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
