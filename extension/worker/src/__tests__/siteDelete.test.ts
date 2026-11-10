// ABOUTME: Tests the signed delete-site request contract with real WebCrypto keys.
// ABOUTME: Verifies only the identity key's holder can delete a participant's events from a site.

import { describe, expect, it } from "vitest";
import {
  parseSiteDeleteRequest,
  verifySiteDeleteSignature,
} from "../routes/siteDelete";
import { bytesToHex } from "../../../src/utils/restoreRequest";
import {
  SITE_DELETE_SIGNATURE_MAX_AGE_MS,
  signSiteDeleteRequest,
} from "../../../src/utils/siteDeleteRequest";

async function makeIdentity() {
  const keypair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keypair.publicKey),
  );
  return {
    pid: `pk_${bytesToHex(raw)}`,
    privateKey: await crypto.subtle.exportKey("jwk", keypair.privateKey),
  };
}

const NOW = Date.UTC(2026, 10, 8, 12);

describe("delete-site request signatures", () => {
  it("accepts a request signed by the participant", async () => {
    const me = await makeIdentity();
    const request = await signSiteDeleteRequest(me.privateKey, {
      pid: me.pid,
      host: "chase.com",
      signedAt: NOW,
    });
    expect(parseSiteDeleteRequest(JSON.parse(JSON.stringify(request)))).toEqual(
      request,
    );
    expect(await verifySiteDeleteSignature(request, NOW + 1_000)).toBe(true);
  });

  it("rejects a request signed by someone else", async () => {
    const me = await makeIdentity();
    const other = await makeIdentity();
    const request = await signSiteDeleteRequest(other.privateKey, {
      pid: me.pid,
      host: "chase.com",
      signedAt: NOW,
    });
    expect(await verifySiteDeleteSignature(request, NOW)).toBe(false);
  });

  it("rejects a signed request whose site was changed", async () => {
    const me = await makeIdentity();
    const request = await signSiteDeleteRequest(me.privateKey, {
      pid: me.pid,
      host: "chase.com",
      signedAt: NOW,
    });
    expect(
      await verifySiteDeleteSignature({ ...request, host: "google.com" }, NOW),
    ).toBe(false);
  });

  it("rejects stale signatures", async () => {
    const me = await makeIdentity();
    const request = await signSiteDeleteRequest(me.privateKey, {
      pid: me.pid,
      host: "chase.com",
      signedAt: NOW,
    });
    expect(
      await verifySiteDeleteSignature(
        request,
        NOW + SITE_DELETE_SIGNATURE_MAX_AGE_MS + 1,
      ),
    ).toBe(false);
  });

  it("rejects hosts that are not normalized sites", async () => {
    const me = await makeIdentity();
    for (const host of [
      "",
      "localhost",
      "Chase.com",
      "%.com",
      "chase.com/x",
      "a_b.com",
    ]) {
      expect(
        parseSiteDeleteRequest({
          pid: me.pid,
          host,
          signedAt: NOW,
          signature: "a".repeat(128),
        }),
      ).toBeNull();
    }
  });
});
