// ABOUTME: Verifies extension identity signing produces P-256 signatures for stored key material.
// ABOUTME: Covers the private-key operation used by signed participant color updates.

import { describe, expect, it } from "vitest";
import { signPlayerIdentityPayload } from "../storage/playerIdentity";

describe("player identity signing", () => {
  it("signs payloads that verify with the matching public key", async () => {
    const keypair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const privateKey = await crypto.subtle.exportKey("jwk", keypair.privateKey);
    const payload = "participant-color-v1\npk_test\n#4a9a8a\n1";
    const signature = await signPlayerIdentityPayload(privateKey, payload);
    const signatureBytes = Uint8Array.from(atob(signature), (character) =>
      character.charCodeAt(0),
    );

    await expect(crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keypair.publicKey,
      signatureBytes,
      new TextEncoder().encode(payload),
    )).resolves.toBe(true);
  });
});
