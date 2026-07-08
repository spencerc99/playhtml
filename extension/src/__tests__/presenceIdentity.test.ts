// ABOUTME: Verifies the extension publishes only public identity fields to PlayHTML presence.
// ABOUTME: Keeps local profile/storage details out of realtime cursor payloads.

import { describe, expect, it } from "vitest";
import {
  MAX_PRESENCE_VALUE_BYTES,
  toPublicPlayerIdentity,
  validatePresenceClientMessage,
} from "@playhtml/common";

describe("toPublicPlayerIdentity", () => {
  it("keeps oversized extension identity fields out of presence payloads", () => {
    const rawIdentity = {
      publicKey: "pk_" + "a".repeat(130),
      privateKey: {
        d: "x".repeat(5000),
        kty: "EC",
      },
      playerStyle: {
        colorPalette: ["#4a9a8a", "#c4724e"],
        cursorStyle: "default",
        animationStyle: "gentle",
        interactionPatterns: ["hover", "click"],
      },
      name: "Test player",
      discoveredSites: Array.from(
        { length: 300 },
        (_, index) => `example-${index}.com`,
      ),
      createdAt: Date.now(),
    };

    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity: rawIdentity,
        page: "/wiki/Octopus",
      }),
    ).toThrow("Presence value must be 4096 bytes or less");

    const identity = toPublicPlayerIdentity(rawIdentity);

    expect(identity).toEqual({
      publicKey: rawIdentity.publicKey,
      name: "Test player",
      createdAt: rawIdentity.createdAt,
      playerStyle: {
        colorPalette: ["#4a9a8a", "#c4724e"],
        cursorStyle: "default",
      },
    });
    expect(JSON.stringify(identity)).not.toContain("privateKey");
    expect(JSON.stringify(identity)).not.toContain("discoveredSites");
    expect(() =>
      validatePresenceClientMessage({
        type: "presence-join",
        identity,
        page: "/wiki/Octopus",
      }),
    ).not.toThrow();
    expect(
      new TextEncoder().encode(
        JSON.stringify({
          type: "presence-join",
          identity,
          page: "/wiki/Octopus",
        }),
      ).byteLength,
    ).toBeLessThanOrEqual(MAX_PRESENCE_VALUE_BYTES);
  });
});
