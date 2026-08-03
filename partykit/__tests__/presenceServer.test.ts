// ABOUTME: Verifies presence message compatibility and server lifecycle behavior.
// ABOUTME: Covers public identity projection, state persistence, and close diagnostics.
import { describe, expect, it } from "bun:test";
import { validatePresenceClientMessage } from "@playhtml/common";
import { getConnectionCloseDiagnostic } from "../connectionDiagnostics";
import {
  persistPresenceConnectionState,
  projectPresenceClientIdentity,
} from "../presenceMessage";

describe("presence message compatibility", () => {
  it("projects legacy join identities to public fields before validation", () => {
    const message = validatePresenceClientMessage(
      projectPresenceClientIdentity({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          name: "Reader",
          playerStyle: {
            colorPalette: ["red"],
            cursorStyle: "default",
            privateStyle: "secret",
          },
          createdAt: 123,
          discoveredSites: ["example.com"],
          privateKey: { d: "secret" },
        },
      }),
    );

    expect(message).toEqual({
      type: "presence-join",
      identity: {
        publicKey: "pk_1",
        name: "Reader",
        playerStyle: {
          colorPalette: ["red"],
          cursorStyle: "default",
        },
        createdAt: 123,
      },
    });
  });

  it("projects legacy identity-channel updates to public fields", () => {
    const message = validatePresenceClientMessage(
      projectPresenceClientIdentity({
        type: "presence-update",
        channel: "identity",
        value: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
          discoveredSites: ["example.com"],
        },
      }),
    );

    expect(message).toEqual({
      type: "presence-update",
      channel: "identity",
      value: {
        publicKey: "pk_1",
        playerStyle: { colorPalette: ["red"] },
      },
    });
  });

  it("preserves invalid public identity fields for strict validation", () => {
    expect(() =>
      validatePresenceClientMessage(
        projectPresenceClientIdentity({
          type: "presence-join",
          identity: {
            publicKey: "pk_1",
            playerStyle: { colorPalette: [] },
            discoveredSites: ["example.com"],
          },
        }),
      ),
    ).toThrow(
      "identity.playerStyle.colorPalette[0] must be a non-empty string",
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
