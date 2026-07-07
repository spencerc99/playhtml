// ABOUTME: Verifies the extension publishes only public identity fields to PlayHTML presence.
// ABOUTME: Keeps local profile/storage details out of realtime cursor payloads.

import { describe, expect, it } from "vitest";
import {
  MAX_PRESENCE_VALUE_BYTES,
  validatePresenceClientMessage,
} from "@playhtml/common";
import { toPresencePlayerIdentity } from "../utils/presenceIdentity";

describe("toPresencePlayerIdentity", () => {
  it("keeps oversized extension identity fields out of presence payloads", () => {
    const rawIdentity = {
      publicKey: "pk_" + "a".repeat(130),
      privateKey: {
        d: "x".repeat(5000),
        kty: "EC",
      },
      playerStyle: {
        colorPalette: ["#4a9a8a", "#c4724e"],
        animationStyle: "gentle",
        interactionPatterns: ["hover", "click"],
      },
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

    const identity = toPresencePlayerIdentity(rawIdentity);

    expect(identity).toEqual({
      publicKey: rawIdentity.publicKey,
      playerStyle: {
        colorPalette: ["#4a9a8a"],
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
