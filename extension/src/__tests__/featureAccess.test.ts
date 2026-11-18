// ABOUTME: Tests parsing and persistence of extension feature access and local choices.
// ABOUTME: Ensures malformed policy cannot grant unavailable experiments.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  FEATURE_ACCESS_STORAGE_KEY,
  getFeatureAccess,
  getFeatureOverrides,
  getFeatureState,
  hasExperimentAccess,
  hasPrivateExperimentAccess,
  parseFeatureAccess,
  parseFeatureOverrides,
  refreshFeatureAccess,
  setFeatureOverride,
} from "../features/featureAccess";
import { ECDSA_SIGN_ALGORITHM, bytesToHex, hexToBytes } from "../utils/restoreRequest";
import { featureAccessSigningMessage } from "../utils/featureAccessRequest";

vi.mock("@movement/config", () => ({ WORKER_URL: "https://worker.example" }));

const storedIdentity = vi.hoisted(() => ({
  current: null as null | { public: { publicKey: string }; privateKey: JsonWebKey },
}));
vi.mock("../storage/playerIdentity", () => ({
  getStoredPlayerIdentity: async () => storedIdentity.current,
}));

let PUBLIC_ID: string;
let VERIFY_KEY: CryptoKey;

beforeAll(async () => {
  const keypair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keypair.publicKey));
  PUBLIC_ID = `pk_${bytesToHex(raw)}`;
  VERIFY_KEY = keypair.publicKey;
  storedIdentity.current = {
    public: { publicKey: PUBLIC_ID },
    privateKey: await crypto.subtle.exportKey("jwk", keypair.privateKey),
  };
});

describe("parseFeatureOverrides", () => {
  it("keeps only known features with boolean values", () => {
    expect(parseFeatureOverrides({
      COMMUTE: true,
      INVENTORY: false,
      UNKNOWN: true,
      SCRAPS: "yes",
    })).toEqual({ COMMUTE: true, INVENTORY: false });
  });
});

describe("parseFeatureAccess", () => {
  it("reads internal membership and treats older snapshots as non-internal", () => {
    expect(parseFeatureAccess({ features: {}, internal: true })?.internal).toBe(true);
    expect(parseFeatureAccess({ features: {} })?.internal).toBe(false);
  });

  it("keeps valid known policies and ignores unknown or malformed entries", () => {
    const access = parseFeatureAccess({
      features: {
        COMMUTE: { stage: "beta", available: true },
        UNKNOWN: { stage: "released", available: true },
        SCRAPS: { stage: "beta", available: "yes" },
      },
      checkedAt: 123,
    });
    expect(access?.features.COMMUTE).toEqual({ stage: "beta", available: true });
    expect(access?.features.SCRAPS).toEqual({ stage: "beta", available: false });
    expect(access?.checkedAt).toBe(123);
  });

  it("rejects values without a feature policy object", () => {
    expect(parseFeatureAccess(null)).toBeNull();
    expect(parseFeatureAccess({ features: [] })).toBeNull();
  });
});

describe("refreshFeatureAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores a successful server entitlement snapshot", async () => {
    vi.spyOn(Date, "now").mockReturnValue(456);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      features: { COMMUTE: { stage: "beta", available: true } },
    }), { status: 200 })));

    const access = await refreshFeatureAccess(PUBLIC_ID);
    expect(access.features.COMMUTE).toEqual({ stage: "beta", available: true });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://worker.example/feature-access/${PUBLIC_ID}`);
    expect(init.cache).toBe("no-store");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-WWO-Signed-At"]).toBe("456");
    const verified = await crypto.subtle.verify(
      ECDSA_SIGN_ALGORITHM,
      VERIFY_KEY,
      hexToBytes(headers["X-WWO-Signature"]),
      new TextEncoder().encode(
        featureAccessSigningMessage({ publicId: PUBLIC_ID, signedAt: 456 }),
      ),
    );
    expect(verified).toBe(true);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [FEATURE_ACCESS_STORAGE_KEY]: expect.objectContaining({ checkedAt: 456 }),
    });
  });

  it("keeps local choices when server access is revoked", async () => {
    vi.mocked(browser.storage.local.set).mockClear();
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      wwoFeatureOverrides: { COMMUTE: false, SCRAPS: true },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      features: {
        COMMUTE: { stage: "beta", available: false },
        SCRAPS: { stage: "beta", available: true },
      },
    }), { status: 200 })));

    await refreshFeatureAccess(PUBLIC_ID);
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1);
    expect(vi.mocked(browser.storage.local.set).mock.calls[0][0]).not.toHaveProperty(
      "wwoFeatureOverrides",
    );
  });

  it("keeps an opt-out through a revoke and re-grant of access", async () => {
    const store: Record<string, unknown> = {};
    vi.mocked(browser.storage.local.get).mockImplementation(async (key) => (
      typeof key === "string" && key in store ? { [key]: store[key] } : {}
    ));
    vi.mocked(browser.storage.local.set).mockImplementation(async (items) => {
      Object.assign(store, items);
    });
    const serveAccess = (available: boolean) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
        features: { COMMUTE: { stage: "beta", available } },
      }), { status: 200 })));
    };

    serveAccess(true);
    await refreshFeatureAccess(PUBLIC_ID);
    expect(await getFeatureState("COMMUTE")).toMatchObject({ enabled: true, source: "available" });

    await setFeatureOverride("COMMUTE", false);
    expect(await getFeatureState("COMMUTE")).toMatchObject({ enabled: false, source: "choice" });

    serveAccess(false);
    await refreshFeatureAccess(PUBLIC_ID);
    expect(await getFeatureState("COMMUTE")).toMatchObject({ enabled: false, source: "unavailable" });

    serveAccess(true);
    await refreshFeatureAccess(PUBLIC_ID);
    expect(await getFeatureOverrides()).toEqual({ COMMUTE: false });
    expect(await getFeatureState("COMMUTE")).toMatchObject({ enabled: false, source: "choice" });
  });

  it("refuses to ask about an id whose key is not stored here", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(refreshFeatureAccess(`pk_04${"b".repeat(128)}`)).rejects.toThrow(
      "Feature access check is for a different identity than the stored one",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not overwrite the cache when the server check fails", async () => {
    vi.mocked(browser.storage.local.set).mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(refreshFeatureAccess(PUBLIC_ID)).rejects.toThrow(
      "Feature access check failed with 503",
    );
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("storage failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails closed for experiments when extension storage is unavailable", async () => {
    vi.mocked(browser.storage.local.get).mockRejectedValueOnce(
      new Error("extension context invalidated"),
    );
    const access = await getFeatureAccess();
    expect(access.features.COMMUTE.available).toBe(false);
    expect(access.features.INVENTORY.available).toBe(false);

    vi.mocked(browser.storage.local.get).mockRejectedValueOnce(
      new Error("extension context invalidated"),
    );
    await expect(getFeatureOverrides()).resolves.toEqual({});
  });
});

describe("experiment access checks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not treat released features as private experiment access", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [FEATURE_ACCESS_STORAGE_KEY]: {
        features: { EMOTES: { stage: "released", available: true } },
      },
    });

    await expect(hasExperimentAccess()).resolves.toBe(false);
    await expect(hasPrivateExperimentAccess()).resolves.toBe(false);
  });
});
