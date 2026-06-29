// ABOUTME: Tests PartyServer connection close diagnostics for noisy WebSocket churn.
// ABOUTME: Keeps close-code logging policy explicit without a Durable Object runtime.
import { describe, expect, it } from "bun:test";
import { getConnectionCloseDiagnostic } from "../connectionDiagnostics";

describe("getConnectionCloseDiagnostic", () => {
  it("stays silent for a clean normal close", () => {
    expect(
      getConnectionCloseDiagnostic({
        roomName: "class.playhtml.fun-/week/1",
        connectionId: "conn-1",
        code: 1000,
        reason: "",
        wasClean: true,
        openedAt: 1_000,
        now: 1_500,
      })
    ).toBe(null);
  });

  it("stays silent for an intentional room reset close", () => {
    expect(
      getConnectionCloseDiagnostic({
        roomName: "class.playhtml.fun-/week/1",
        connectionId: "conn-1",
        code: 4000,
        reason: "Room Reset",
        wasClean: true,
        openedAt: 1_000,
        now: 1_500,
      })
    ).toBe(null);
  });

  it("reports abnormal closes with code, reason, and connection age", () => {
    expect(
      getConnectionCloseDiagnostic({
        roomName: "class.playhtml.fun-/week/1",
        connectionId: "conn-1",
        code: 1006,
        reason: "Connection ended",
        wasClean: false,
        openedAt: 1_000,
        now: 1_750,
      })
    ).toBe(
      '[PartyServer] WebSocket closed abnormally: room=class.playhtml.fun-/week/1 connection=conn-1 code=1006 reason="Connection ended" wasClean=false durationMs=750'
    );
  });
});
