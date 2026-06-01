// ABOUTME: Verifies when the extension is allowed to create PlayHTML presence rooms.
// ABOUTME: Guards high-traffic sites from extension-owned rooms unless explicitly supported.

import { afterEach, describe, expect, it, vi } from "vitest";
import { initCustomSite, shouldEnableCursorsForHostname } from "../custom-sites";
import { initWikipedia } from "../custom-sites/wikipedia";
import { shouldStartExtensionPresence } from "../entrypoints/content/presencePolicy";

vi.mock("../custom-sites/wikipedia", () => ({
  initWikipedia: vi.fn(() => null),
}));

const customSiteDeps = {
  createPageData: vi.fn(),
  createPresenceRoom: vi.fn(),
  presence: {} as any,
  cursorClient: {},
  playerColor: "#4a9a8a",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("shouldStartExtensionPresence", () => {
  it("does not start an extension-owned room when native PlayHTML exists", () => {
    expect(
      shouldStartExtensionPresence({
        nativePlayhtmlDetected: true,
        cursorsEnabled: true,
      }),
    ).toBe(false);
  });

  it("does not start an extension-owned room on pages without explicit cursor support", () => {
    expect(
      shouldStartExtensionPresence({
        nativePlayhtmlDetected: false,
        cursorsEnabled: false,
      }),
    ).toBe(false);
  });

  it("starts an extension-owned room only for explicit cursor sites", () => {
    expect(
      shouldStartExtensionPresence({
        nativePlayhtmlDetected: false,
        cursorsEnabled: true,
      }),
    ).toBe(true);
  });
});

describe("shouldEnableCursors", () => {
  it("leaves high-traffic domains disabled unless they get explicit support", () => {
    const highTrafficPages = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.google.com/search?q=playhtml",
      "https://x.com/home",
      "https://www.reddit.com/r/webdev/",
      "https://www.tiktok.com/@example/video/123",
    ];

    for (const url of highTrafficPages) {
      expect(shouldEnableCursorsForHostname(new URL(url).hostname)).toBe(false);
    }
  });

  it("enables cursors for Wikipedia", () => {
    expect(shouldEnableCursorsForHostname("en.wikipedia.org")).toBe(true);
    expect(shouldEnableCursorsForHostname("wikipedia.org")).toBe(true);
  });

  it("does not enable cursors for Wikipedia lookalike domains", () => {
    expect(shouldEnableCursorsForHostname("fakewikipedia.org")).toBe(false);
    expect(shouldEnableCursorsForHostname("wikipedia.org.example.com")).toBe(
      false,
    );
  });
});

describe("initCustomSite", () => {
  it("initializes Wikipedia site modules for supported Wikipedia hosts", async () => {
    vi.stubGlobal("location", { hostname: "en.wikipedia.org" });

    await initCustomSite(customSiteDeps);

    expect(initWikipedia).toHaveBeenCalledWith(customSiteDeps);
  });

  it("does not initialize site modules for Wikipedia lookalike domains", async () => {
    vi.stubGlobal("location", { hostname: "fakewikipedia.org" });

    await expect(initCustomSite(customSiteDeps)).resolves.toBeNull();

    expect(initWikipedia).not.toHaveBeenCalled();
  });
});
