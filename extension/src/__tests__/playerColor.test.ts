// ABOUTME: Verifies cursor color sync signs each update with the participant's identity key.
// ABOUTME: A rejected or failed sync only warns; the color is still saved locally.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { savePlayerColor, syncStoredPlayerColor } from "../storage/playerColor";
import { PLAYER_IDENTITY_STORAGE_KEY } from "../storage/playerIdentity";
import {
  ECDSA_SIGN_ALGORITHM,
  bytesToHex,
  hexToBytes,
} from "../utils/restoreRequest";
import { participantColorSigningMessage } from "../utils/participantColorRequest";

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
  return data;
}

async function storeIdentity() {
  const identity = await makeIdentity();
  const data = setupStorage({
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
  return { identity, data };
}

describe("player color sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a color update the participant's key verifiably signed", async () => {
    const { identity } = await storeIdentity();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await savePlayerColor("#4a9a8a");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/participants/${identity.publicKey}$`));
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.cursor_color).toBe("#4a9a8a");
    expect(Math.abs(Date.now() - body.signedAt)).toBeLessThan(60_000);
    const verified = await crypto.subtle.verify(
      ECDSA_SIGN_ALGORITHM,
      identity.verifyKey,
      hexToBytes(body.signature),
      new TextEncoder().encode(
        participantColorSigningMessage({
          pid: identity.publicKey,
          color: "#4a9a8a",
          signedAt: body.signedAt,
        }),
      ),
    );
    expect(verified).toBe(true);
  });

  it("keeps the local color and only warns when the Worker rejects the update", async () => {
    const { data } = await storeIdentity();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));

    const updated = await savePlayerColor("#c4724e");

    expect(updated?.playerStyle.colorPalette[0]).toBe("#c4724e");
    expect(
      (data[PLAYER_IDENTITY_STORAGE_KEY] as { public: { playerStyle: { colorPalette: string[] } } })
        .public.playerStyle.colorPalette[0],
    ).toBe("#c4724e");
    expect(warn).toHaveBeenCalledWith("[Sync] Failed to sync participant color:", 401);
    warn.mockRestore();
  });

  it("resolves the startup sync when the network fails", async () => {
    await storeIdentity();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));

    await expect(syncStoredPlayerColor()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[Sync] Failed to sync participant color:",
      expect.any(TypeError),
    );
    warn.mockRestore();
  });
});
