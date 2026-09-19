// ABOUTME: Covers carrying the old forced new tab takeover into the opt-in preference.
// ABOUTME: Guards against updates silently removing a new tab people already had.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  compareVersions,
  grandfatherNewTabTakeover,
  hadForcedNewTab,
  FIRST_FORCED_NEWTAB_VERSION,
} from "../features/newtab/grandfather";

const KEY = "newtab_takeover_enabled";
const CURRENT = "0.1.23";

beforeEach(() => {
  vi.mocked(browser.storage.local.get).mockReset();
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  vi.mocked(browser.storage.local.set).mockReset();
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
});

describe("compareVersions", () => {
  it("orders by numeric component, not string order", () => {
    expect(compareVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("0.1.22", "0.1.3")).toBeGreaterThan(0);
    expect(compareVersions("0.1.21", "0.1.21")).toBe(0);
  });

  it("treats missing components as zero", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("0.2", "0.1.99")).toBeGreaterThan(0);
  });
});

describe("hadForcedNewTab", () => {
  it("covers the versions that shipped the manifest override", () => {
    expect(hadForcedNewTab(FIRST_FORCED_NEWTAB_VERSION, CURRENT)).toBe(true);
    expect(hadForcedNewTab("0.1.22", CURRENT)).toBe(true);
  });

  it("excludes versions from before the override shipped", () => {
    expect(hadForcedNewTab("0.1.20", CURRENT)).toBe(false);
    expect(hadForcedNewTab("0.1.9", CURRENT)).toBe(false);
  });

  it("excludes the opt-in versions and anything past them", () => {
    expect(hadForcedNewTab(CURRENT, CURRENT)).toBe(false);
    expect(hadForcedNewTab("0.2.0", CURRENT)).toBe(false);
  });

  it("holds when this release is a minor or major bump", () => {
    expect(hadForcedNewTab("0.1.22", "0.2.0")).toBe(true);
    expect(hadForcedNewTab("0.1.22", "1.0.0")).toBe(true);
  });

  it("ignores a missing previous version", () => {
    expect(hadForcedNewTab(undefined, CURRENT)).toBe(false);
  });
});

describe("grandfatherNewTabTakeover", () => {
  it("keeps the history new tab when updating from an override version", async () => {
    await grandfatherNewTabTakeover("0.1.22", CURRENT);

    expect(browser.storage.local.set).toHaveBeenCalledWith({ [KEY]: true });
  });

  it("never overwrites a preference the user already set", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [KEY]: false });

    await grandfatherNewTabTakeover("0.1.22", CURRENT);

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("leaves an existing opt-in alone rather than rewriting it", async () => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [KEY]: true });

    await grandfatherNewTabTakeover("0.1.22", CURRENT);

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("does not grandfather updates from before the override shipped", async () => {
    await grandfatherNewTabTakeover("0.1.20", CURRENT);

    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("does nothing on a fresh install, which reports no previous version", async () => {
    await grandfatherNewTabTakeover(undefined, CURRENT);

    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.local.get).not.toHaveBeenCalled();
  });
});
