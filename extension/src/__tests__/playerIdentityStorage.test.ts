// ABOUTME: Verifies extension identity storage keeps private keys background-only.
// ABOUTME: Covers legacy migration and public profile reads from browser storage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  DISCOVERED_SITES_STORAGE_KEY,
  getPlayerProfile,
  getPublicPlayerIdentity,
  getStoredPlayerIdentity,
  recordDiscoveredSite,
} from "../storage/playerIdentity";

const privateKey = {
  kty: "EC",
  d: "private",
  crv: "P-256",
};

function setupStorage(initial: Record<string, unknown>) {
  const data = { ...initial };
  vi.mocked(browser.storage.local.get).mockImplementation((keys?: any) => {
    if (Array.isArray(keys)) {
      return Promise.resolve(
        Object.fromEntries(keys.map((key) => [key, data[key]])),
      );
    }
    if (typeof keys === "string") {
      return Promise.resolve({ [keys]: data[keys] });
    }
    return Promise.resolve({ ...data });
  });
  vi.mocked(browser.storage.local.set).mockImplementation((items: any) => {
    Object.assign(data, items);
    return Promise.resolve();
  });
  return data;
}

describe("player identity storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("migrates legacy identity into explicit public and private fields", async () => {
    const data = setupStorage({
      playerIdentity: {
        publicKey: "pk_test",
        privateKey,
        playerStyle: {
          colorPalette: ["#4a9a8a", "#c4724e"],
          animationStyle: "gentle",
        },
        discoveredSites: ["example.com"],
        createdAt: 123,
      },
    });

    const stored = await getStoredPlayerIdentity();

    expect(stored).toEqual({
      public: {
        publicKey: "pk_test",
        createdAt: 123,
        playerStyle: {
          colorPalette: ["#4a9a8a", "#c4724e"],
        },
      },
      privateKey,
    });
    expect(data.playerIdentity).toEqual(stored);
    expect(data[DISCOVERED_SITES_STORAGE_KEY]).toEqual(["example.com"]);

    const publicIdentity = await getPublicPlayerIdentity();
    expect(publicIdentity).toEqual(stored?.public);
    expect(JSON.stringify(publicIdentity)).not.toContain("private");
    expect(JSON.stringify(publicIdentity)).not.toContain("example.com");

    const profile = await getPlayerProfile();
    expect(profile).toEqual({
      identity: stored?.public,
      discoveredSites: ["example.com"],
    });
  });

  it("records discovered sites outside playerIdentity", async () => {
    const data = setupStorage({
      playerIdentity: {
        public: {
          publicKey: "pk_test",
          playerStyle: { colorPalette: ["#4a9a8a"] },
        },
        privateKey,
      },
      [DISCOVERED_SITES_STORAGE_KEY]: ["example.com"],
    });

    await recordDiscoveredSite("wikipedia.org");
    await recordDiscoveredSite("example.com");

    expect(data[DISCOVERED_SITES_STORAGE_KEY]).toEqual([
      "example.com",
      "wikipedia.org",
    ]);
    expect(JSON.stringify(data.playerIdentity)).not.toContain("wikipedia.org");
  });
});
