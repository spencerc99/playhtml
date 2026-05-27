// ABOUTME: Verifies when the extension is allowed to create PlayHTML presence rooms.
// ABOUTME: Guards high-traffic sites from extension-owned rooms unless explicitly supported.

import { describe, expect, it } from "vitest";
import { shouldEnableCursorsForHostname } from "../custom-sites";
import { shouldStartExtensionPresence } from "../entrypoints/content/presencePolicy";

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
  });
});
