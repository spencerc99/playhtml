// ABOUTME: Tests parsing of locally persisted extension feature overrides.
// ABOUTME: Ensures stale and malformed feature ids cannot enter runtime access state.

import { afterEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  INTERNAL_ACCESS_STORAGE_KEY,
  getFeatureOverrides,
  getInternalAccess,
  parseFeatureOverrides,
  refreshInternalAccess,
} from "../features/featureAccess";

vi.mock("@movement/config", () => ({
  WORKER_URL: "https://worker.example",
}));

describe("parseFeatureOverrides", () => {
  it("keeps only known features with boolean values", () => {
    expect(
      parseFeatureOverrides({
        COMMUTE: true,
        INVENTORY: false,
        UNKNOWN: true,
        SCRAPS: "yes",
      }),
    ).toEqual({ COMMUTE: true, INVENTORY: false });
  });

  it("returns no overrides for invalid storage values", () => {
    expect(parseFeatureOverrides(null)).toEqual({});
    expect(parseFeatureOverrides([])).toEqual({});
    expect(parseFeatureOverrides("COMMUTE")).toEqual({});
  });
});

describe("refreshInternalAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores a successful server eligibility check", async () => {
    vi.spyOn(Date, "now").mockReturnValue(456);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ enabled: true }), { status: 200 }),
      ),
    );

    await expect(refreshInternalAccess("pk_test")).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://worker.example/internal-access/pk_test",
    );
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      [INTERNAL_ACCESS_STORAGE_KEY]: { enabled: true, checkedAt: 456 },
    });
  });

  it("does not overwrite the cache when the server check fails", async () => {
    vi.mocked(browser.storage.local.set).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );

    await expect(refreshInternalAccess("pk_test")).rejects.toThrow(
      "Internal access check failed with 503",
    );
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("storage failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails closed when extension storage is unavailable", async () => {
    vi.mocked(browser.storage.local.get).mockRejectedValueOnce(
      new Error("extension context invalidated"),
    );
    await expect(getInternalAccess()).resolves.toBe(false);

    vi.mocked(browser.storage.local.get).mockRejectedValueOnce(
      new Error("extension context invalidated"),
    );
    await expect(getFeatureOverrides()).resolves.toEqual({});
  });
});
