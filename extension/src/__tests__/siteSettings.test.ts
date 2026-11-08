// ABOUTME: Tests per-site privacy storage: host normalization, subdomain matching, and saving levels.
// ABOUTME: Uses the shared webextension-polyfill mock with an in-memory storage.local.

import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  SITE_SETTINGS_KEY,
  findSiteSetting,
  getSiteLevel,
  normalizeSiteHost,
  parseSiteSettings,
  setSiteLevel,
  siteLevelFor,
} from "../storage/siteSettings";

describe("normalizeSiteHost", () => {
  it.each([
    ["chase.com", "chase.com"],
    ["https://www.Chase.com/accounts?x=1#y", "chase.com"],
    ["www.chase.com:8443", "chase.com"],
    ["secure.chase.com/login", "secure.chase.com"],
    ["  mail.google.com  ", "mail.google.com"],
    ["user@site.org/path", "site.org"],
    ["localhost", ""],
    ["not a site", ""],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeSiteHost(input)).toBe(expected);
  });
});

describe("site lookup", () => {
  const settings = parseSiteSettings({
    "chase.com": { level: "off", since: 1 },
    "news.chase.com": { level: "just-me", since: 2 },
    "bad.com": { level: "sometimes", since: 3 },
  });

  it("drops entries with unknown levels", () => {
    expect(Object.keys(settings).sort()).toEqual([
      "chase.com",
      "news.chase.com",
    ]);
  });

  it("covers subdomains and lets the most specific entry win", () => {
    expect(siteLevelFor(settings, "secure.chase.com")).toBe("off");
    expect(siteLevelFor(settings, "https://www.chase.com/")).toBe("off");
    expect(siteLevelFor(settings, "a.news.chase.com")).toBe("just-me");
    expect(findSiteSetting(settings, "news.chase.com")?.host).toBe(
      "news.chase.com",
    );
  });

  it("does not match lookalike hosts", () => {
    expect(siteLevelFor(settings, "notchase.com")).toBe("everyone");
    expect(siteLevelFor(settings, "chase.com.evil.net")).toBe("everyone");
  });
});

describe("setSiteLevel", () => {
  let stored: Record<string, unknown>;

  beforeEach(() => {
    stored = {};
    vi.mocked(browser.storage.local.set).mockClear();
    vi.mocked(browser.storage.local.get).mockImplementation(async (key) => ({
      [key as string]: stored[key as string],
    }));
    vi.mocked(browser.storage.local.set).mockImplementation(async (items) => {
      Object.assign(stored, items);
    });
  });

  it("stores a normalized host with the date it changed and clears on everyone", async () => {
    expect(await setSiteLevel("https://www.chase.com/x", "off", 100)).toBe(
      "chase.com",
    );
    expect(stored[SITE_SETTINGS_KEY]).toEqual({
      "chase.com": { level: "off", since: 100 },
    });
    expect(await getSiteLevel("secure.chase.com")).toBe("off");

    await setSiteLevel("chase.com", "off", 200);
    expect(stored[SITE_SETTINGS_KEY]).toEqual({
      "chase.com": { level: "off", since: 100 },
    });

    await setSiteLevel("chase.com", "everyone");
    expect(stored[SITE_SETTINGS_KEY]).toEqual({});
    expect(await getSiteLevel("chase.com")).toBe("everyone");
  });

  it("ignores input that isn't a site", async () => {
    expect(await setSiteLevel("nope", "off")).toBe("");
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
