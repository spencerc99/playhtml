// ABOUTME: Tests parsing and persistence of extension feature access and local choices.
// ABOUTME: Ensures malformed policy cannot grant unavailable experiments.

import { afterEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  FEATURE_ACCESS_STORAGE_KEY,
  getFeatureAccess,
  getFeatureOverrides,
  hasExperimentAccess,
  hasPrivateExperimentAccess,
  parseFeatureAccess,
  parseFeatureOverrides,
  refreshFeatureAccess,
} from "../features/featureAccess";

vi.mock("@movement/config", () => ({ WORKER_URL: "https://worker.example" }));

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
  it("keeps valid known policies and ignores unknown or malformed entries", () => {
    const access = parseFeatureAccess({
      features: {
        COMMUTE: { stage: "beta", available: true },
        UNKNOWN: { stage: "lab", available: true },
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

    const access = await refreshFeatureAccess("pk_test");
    expect(access.features.COMMUTE).toEqual({ stage: "beta", available: true });
    expect(fetch).toHaveBeenCalledWith("https://worker.example/feature-access/pk_test");
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [FEATURE_ACCESS_STORAGE_KEY]: expect.objectContaining({ checkedAt: 456 }),
      ["wwoFeatureOverrides"]: {},
    });
  });

  it("clears a local choice when server access is revoked", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      wwoFeatureOverrides: { COMMUTE: true, SCRAPS: true },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      features: {
        COMMUTE: { stage: "beta", available: false },
        SCRAPS: { stage: "beta", available: true },
      },
    }), { status: 200 })));

    await refreshFeatureAccess("pk_test");
    expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      wwoFeatureOverrides: { SCRAPS: true },
    }));
  });

  it("does not overwrite the cache when the server check fails", async () => {
    vi.mocked(browser.storage.local.set).mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(refreshFeatureAccess("pk_test")).rejects.toThrow(
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

  it("keeps closed-beta requests available to people with labs-only access", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({
      [FEATURE_ACCESS_STORAGE_KEY]: {
        features: { EMOTES: { stage: "lab", available: true } },
      },
    });

    await expect(hasExperimentAccess()).resolves.toBe(true);
    await expect(hasPrivateExperimentAccess()).resolves.toBe(false);
  });
});
