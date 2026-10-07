// ABOUTME: Covers extension-page detection across supported browsers.
// ABOUTME: Keeps ordinary and malformed page URLs outside the extension set.

import { describe, expect, it } from "vitest";
import {
  isExtensionPageUrl,
  isSafariExtensionPageUrl,
} from "./extensionPage";

describe("isExtensionPageUrl", () => {
  it.each([
    "chrome-extension://test/popup.html",
    "moz-extension://test/options.html",
    "safari-web-extension://test/walking-record.html",
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

describe("isSafariExtensionPageUrl", () => {
  it("recognizes Safari extension pages only", () => {
    expect(
      isSafariExtensionPageUrl("safari-web-extension://test/setup.html"),
    ).toBe(true);
    expect(isSafariExtensionPageUrl("chrome-extension://test/setup.html")).toBe(
      false,
    );
    expect(isSafariExtensionPageUrl("not a url")).toBe(false);
  });
});
