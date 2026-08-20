// ABOUTME: Verifies the DOM marker shared between the extension and public pages.
// ABOUTME: Covers both writing and detecting the installed-extension signal.

import { describe, expect, it } from "vitest";
import {
  EXTENSION_INSTALL_ATTRIBUTE,
  isExtensionInstalled,
  markExtensionInstalled,
} from "./extensionInstallMarker";

describe("extension install marker", () => {
  it("marks the page when the extension content script is running", () => {
    const root = document.createElement("html");

    markExtensionInstalled(root);

    expect(root.getAttribute(EXTENSION_INSTALL_ATTRIBUTE)).toBe("installed");
    expect(isExtensionInstalled(root)).toBe(true);
  });

  it("does not treat unrelated attribute values as installed", () => {
    const root = document.createElement("html");
    root.setAttribute(EXTENSION_INSTALL_ATTRIBUTE, "unknown");

    expect(isExtensionInstalled(root)).toBe(false);
  });
});
