// ABOUTME: Tests the opt-in scraps debug overlay's address switch and its lifecycle on the page.
// ABOUTME: The overlay's own markup sits in a closed shadow root, so only its host is checked here.

import { afterEach, describe, expect, it } from "vitest";
import { createScrapDebugOverlay, scrapDebugRequested } from "../scrapDebugOverlay";

describe("scrapDebugRequested", () => {
  it("reads the switch alone or among other hash parameters", () => {
    expect(scrapDebugRequested("#wwo-scraps=debug")).toBe(true);
    expect(scrapDebugRequested("#wwo-trails=everyone&wwo-scraps=debug")).toBe(true);
    expect(scrapDebugRequested("#wwo-scraps=debug&wwo-ui=hidden")).toBe(true);
  });

  it("ignores other hashes", () => {
    expect(scrapDebugRequested("")).toBe(false);
    expect(scrapDebugRequested("#wwo-scraps=debugger")).toBe(false);
    expect(scrapDebugRequested("#section-wwo-scraps=debug")).toBe(false);
  });
});

describe("createScrapDebugOverlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adds one host to the page and removes it on destroy", () => {
    const overlay = createScrapDebugOverlay();
    const image = document.createElement("img");
    document.body.appendChild(image);
    overlay.note(image, "skipped", "too small");
    overlay.note(image, "kept", "200x150");
    expect(document.querySelectorAll("#wwo-scraps-debug")).toHaveLength(1);
    overlay.destroy();
    expect(document.querySelector("#wwo-scraps-debug")).toBeNull();
  });
});
