// ABOUTME: Covers extension-page detection across supported browsers.
// ABOUTME: Keeps ordinary and malformed page URLs outside the extension set.

import { describe, expect, it } from "vitest";
import { isExtensionPageUrl } from "./extensionPage";

describe("isExtensionPageUrl", () => {
  it.each([
    "chrome-extension://test/popup.html",
    "moz-extension://test/options.html",
    "safari-web-extension://test/newtab.html",
  ])("recognizes %s", (url) => {
    expect(isExtensionPageUrl(url)).toBe(true);
  });

  it.each(["https://example.com", "chrome://extensions", "not a url"])(
    "rejects %s",
    (url) => {
      expect(isExtensionPageUrl(url)).toBe(false);
    },
  );
});
