// ABOUTME: Verifies experiment access requests are signed with the participant's identity key.
// ABOUTME: The signature covers the public id, email, and requested features exactly as sent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { submitAccessRequest } from "../storage/accessRequest";
import { PLAYER_IDENTITY_STORAGE_KEY } from "../storage/playerIdentity";
import {
  ECDSA_SIGN_ALGORITHM,
  bytesToHex,
  hexToBytes,
} from "../utils/restoreRequest";
import { accessRequestSigningMessage } from "../utils/accessRequest";

async function makeIdentity() {
  const keypair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keypair.publicKey));
  return {
    publicKey: `pk_${bytesToHex(raw)}`,
    privateKey: await crypto.subtle.exportKey("jwk", keypair.privateKey),
    verifyKey: keypair.publicKey,
  };
}

function setupStorage(initial: Record<string, unknown>) {
  const data = { ...initial };
  vi.mocked(browser.storage.local.get).mockImplementation((keys?: any) => {
    const list = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(Object.fromEntries(list.map((key) => [key, data[key]])));
  });
  vi.mocked(browser.storage.local.set).mockImplementation((items: any) => {
    Object.assign(data, items);
    return Promise.resolve();
  });
}

describe("experiment access requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs the request with the stored identity key", async () => {
    const identity = await makeIdentity();
    setupStorage({
      [PLAYER_IDENTITY_STORAGE_KEY]: {
        public: {
          publicKey: identity.publicKey,
          createdAt: 1,
          playerStyle: { colorPalette: ["#111111"] },
        },
        privateKey: identity.privateKey,
      },
      playerDiscoveredSites: [],
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitAccessRequest({
      email: "tester@example.com",
      requestedFeatures: ["COMMUTE", "SCRAPS"],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/access-requests$/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      publicId: identity.publicKey,
      email: "tester@example.com",
      requestedFeatures: ["COMMUTE", "SCRAPS"],
    });
    const verified = await crypto.subtle.verify(
      ECDSA_SIGN_ALGORITHM,
      identity.verifyKey,
      hexToBytes(body.signature),
      new TextEncoder().encode(accessRequestSigningMessage(body)),
    );
    expect(verified).toBe(true);
  });

  it("throws when the Worker refuses the request", async () => {
    const identity = await makeIdentity();
    setupStorage({
      [PLAYER_IDENTITY_STORAGE_KEY]: {
        public: {
          publicKey: identity.publicKey,
          createdAt: 1,
          playerStyle: { colorPalette: ["#111111"] },
        },
        privateKey: identity.privateKey,
      },
      playerDiscoveredSites: [],
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));

    await expect(
      submitAccessRequest({ email: null, requestedFeatures: ["COMMUTE"] }),
    ).rejects.toThrow("Access request failed with 401");
  });

  it("throws without an identity instead of sending an unsigned request", async () => {
    setupStorage({});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitAccessRequest({ email: null, requestedFeatures: ["COMMUTE"] }),
    ).rejects.toThrow("Access request needs a player identity");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
