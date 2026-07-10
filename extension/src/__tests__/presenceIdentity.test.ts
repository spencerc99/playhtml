// ABOUTME: Verifies the extension publishes only public identity fields to PlayHTML presence.
// ABOUTME: Keeps local profile/storage details out of realtime cursor payloads.

import { describe, expect, it } from "vitest";
import {
  toPublicPlayerIdentity,
  validatePresenceClientMessage,
} from "@playhtml/common";

describe("toPublicPlayerIdentity", () => {
  it("keeps private and profile fields out of presence payloads", () => {
    const colorPalette = Array.from(
      { length: 20 },
      (_, index) => `hsl(${index}, 70%, 60%)`,
    );
    const rawIdentity = {
      publicKey: "pk_" + "a".repeat(130),
      privateKey: {
        d: "x".repeat(5000),
        kty: "EC",
      },
      playerStyle: {
        colorPalette,
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

    const identity = toPublicPlayerIdentity(rawIdentity);

    expect(identity).toEqual({
      publicKey: rawIdentity.publicKey,
      name: "Test player",
      createdAt: rawIdentity.createdAt,
      playerStyle: {
        colorPalette: colorPalette.slice(0, 16),
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
  });
});
