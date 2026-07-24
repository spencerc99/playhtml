// ABOUTME: Verifies the generic realtime presence wire-message contract.
// ABOUTME: Covers channel cadence selection and runtime message validation.

import { describe, expect, it, vi } from "vitest";
import {
  generatePersistentPlayerIdentity,
  generatePlayerIdentity,
  PLAYER_IDENTITY_STORAGE_KEY,
} from "../cursor-types";
import {
  getPresenceChannelCadence,
  isCursor,
  isPlayerIdentity,
  isPresenceRecord,
  validateIdentityCustom,
  validatePresenceClientMessage,
} from "../presence-protocol";

describe("presence protocol", () => {
  it("treats cursor updates as frame-cadence presence", () => {
    expect(getPresenceChannelCadence("cursor")).toBe("frame");
  });

  it("treats element awareness as interactive presence", () => {
    expect(getPresenceChannelCadence("element:can-mirror:tile-1")).toBe(
      "interactive",
    );
  });

  it("treats custom presence channels as event-cadence presence", () => {
    expect(getPresenceChannelCadence("status")).toBe("event");
  });

  it("accepts finite cursor presence updates", () => {
    const message = validatePresenceClientMessage({
      type: "presence-update",
      channel: "cursor",
      value: {
        cursor: { x: 12, y: 34, pointer: "mouse" },
        page: "/week/1",
        zone: null,
        at: 123,
      },
    });

    expect(message.type).toBe("presence-update");
    expect(message.channel).toBe("cursor");
  });

  it("rejects cursor updates with non-finite coordinates", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-update",
        channel: "cursor",
        value: {
          cursor: { x: Number.POSITIVE_INFINITY, y: 34, pointer: "mouse" },
        },
      }),
    ).toThrow("cursor.x must be a finite number");
  });

  it("accepts custom presence values larger than 4 KiB", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-update",
        channel: "status",
        value: "x".repeat(4097),
      }),
    ).not.toThrow();
  });

  it("rejects presence values that are not JSON-serializable", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(() =>
      validatePresenceClientMessage({
        type: "presence-update",
        channel: "status",
        value,
      }),
    ).toThrow("Presence value must be JSON-serializable");
  });

  it("rejects joins without a stable identity key", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          playerStyle: { colorPalette: ["red"] },
        },
      }),
    ).toThrow("identity.publicKey must be a non-empty string");
  });

  it("rejects joins without a primary identity color", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: [] },
        },
      }),
    ).toThrow("identity.playerStyle.colorPalette[0] must be a non-empty string");
  });

  it("rejects identity palettes with more than 16 colors", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: Array(17).fill("red") },
        },
      }),
    ).toThrow("identity.playerStyle.colorPalette must have 16 colors or less");
  });

  it("rejects identity payloads with private or profile fields", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          privateKey: { kty: "EC", d: "private" },
          playerStyle: { colorPalette: ["red"] },
          discoveredSites: ["example.com"],
        },
      }),
    ).toThrow("identity must only include public presence fields");
  });

  it("accepts public identity creation metadata", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
          createdAt: 123,
        },
      }),
    ).not.toThrow();
  });

  it("rejects nested identity fields outside the public style contract", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: {
            colorPalette: ["red"],
            privateKey: { kty: "EC", d: "private" },
          },
        },
      }),
    ).toThrow("identity.playerStyle must only include public presence fields");
  });

  it("rejects identity updates with private or profile fields", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-update",
        channel: "identity",
        value: {
          publicKey: "pk_1",
          privateKey: { kty: "EC", d: "private" },
          playerStyle: { colorPalette: ["red"] },
          discoveredSites: ["example.com"],
        },
      }),
    ).toThrow("identity must only include public presence fields");
  });

  it("rejects nested identity update fields outside the public style contract", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-update",
        channel: "identity",
        value: {
          publicKey: "pk_1",
          playerStyle: {
            colorPalette: ["red"],
            privateKey: { kty: "EC", d: "private" },
          },
        },
      }),
    ).toThrow("identity.playerStyle must only include public presence fields");
  });

  it("generates public-only player identities", () => {
    const identity = generatePlayerIdentity();

    expect("discoveredSites" in identity).toBe(false);
    expect(typeof identity.createdAt).toBe("number");
    expect("privateKey" in identity).toBe(false);
  });

  it("removes empty colors from persisted player identities", () => {
    const storage = new Map<string, string>([
      [
        PLAYER_IDENTITY_STORAGE_KEY,
        JSON.stringify({
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red", ""] },
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });

    try {
      const identity = generatePersistentPlayerIdentity();

      expect(identity.playerStyle.colorPalette).toEqual(["red"]);
      expect(
        JSON.parse(storage.get(PLAYER_IDENTITY_STORAGE_KEY) ?? "{}").playerStyle
          .colorPalette,
      ).toEqual(["red"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects oversized join pages", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
        },
        page: `/${"x".repeat(512)}`,
      }),
    ).toThrow("page must be 512 characters or less");
  });

  it("exposes boolean predicates that match the protocol shape", () => {
    expect(isPresenceRecord({ channel: "status" })).toBe(true);
    expect(isPresenceRecord(["status"])).toBe(false);

    expect(isCursor({ x: 1, y: 2, pointer: "mouse" })).toBe(true);
    expect(isCursor({ x: Number.NaN, y: 2, pointer: "mouse" })).toBe(false);

    expect(
      isPlayerIdentity({
        publicKey: "pk_1",
        playerStyle: { colorPalette: ["red"] },
      }),
    ).toBe(true);
    expect(
      isPlayerIdentity({
        publicKey: "pk_1",
        playerStyle: { colorPalette: ["red"], cursorStyle: "\u0000" },
      }),
    ).toBe(false);
  });

  it("accepts a join with a valid identity.custom bag", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
          custom: { mood: "curious", streak: 3 },
        },
      }),
    ).not.toThrow();
  });

  it("rejects identity.custom that is an array", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
          custom: ["mood", "curious"],
        },
      }),
    ).toThrow("identity.custom must be an object");
  });

  it("rejects identity.custom that is a string", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
          custom: "curious",
        },
      }),
    ).toThrow("identity.custom must be an object");
  });

  it("rejects identity.custom that is a number", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
          custom: 42,
        },
      }),
    ).toThrow("identity.custom must be an object");
  });

  it("rejects identity.custom exceeding 1024 bytes", () => {
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: {
          publicKey: "pk_1",
          playerStyle: { colorPalette: ["red"] },
          custom: { blob: "x".repeat(1024) },
        },
      }),
    ).toThrow("identity.custom must be 1024 bytes or less");
  });

  it("validateIdentityCustom accepts a small object", () => {
    expect(() =>
      validateIdentityCustom({ mood: "curious", streak: 3 }),
    ).not.toThrow();
  });
});
