// ABOUTME: Verifies the Internet Commute uses the extension's durable player identity.
// ABOUTME: Prevents the standalone train page from generating a mismatched cursor color.

import { describe, expect, it } from "vitest";
import type { PlayerIdentity } from "@playhtml/common";
import { createCommuteInitOptions } from "./commuteIdentity";

describe("commute identity", () => {
  it("passes the extension identity into PlayHTML", () => {
    const identity: PlayerIdentity = {
      publicKey: "extension-rider",
      createdAt: 1,
      playerStyle: { colorPalette: ["#c4724e"] },
    };

    expect(createCommuteInitOptions(identity).playerIdentity).toBe(identity);
  });

  it("lets the public commute use its browser-local identity", () => {
    expect(createCommuteInitOptions(null)).not.toHaveProperty("playerIdentity");
  });
});
