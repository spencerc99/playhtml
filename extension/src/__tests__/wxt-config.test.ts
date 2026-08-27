// ABOUTME: Covers browser-specific manifest settings in WXT builds.
// ABOUTME: Keeps Safari manifests free of unsupported permission and options keys.
// @vitest-environment happy-dom

import type { WxtHooks } from "wxt";
import { describe, expect, it } from "vitest";
import config from "../../wxt.config";

function manifestFor(browser: string) {
  if (typeof config.manifest !== "function") {
    throw new Error("WXT manifest must be generated per browser");
  }

  return config.manifest({
    browser,
    command: "build",
    manifestVersion: 3,
    mode: "production",
  });
}

async function generatedManifestFor(browser: string) {
  const manifest = {
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
  };
  const hooks = config.hooks as
    | { "build:manifestGenerated"?: WxtHooks["build:manifestGenerated"] }
    | undefined;
  const hook = hooks?.["build:manifestGenerated"];
  if (!hook) {
    throw new Error("WXT generated-manifest hook must be configured");
  }

  await hook(
    {
      config: {
        browser,
      },
    } as never,
    manifest as never,
  );
  return manifest;
}

describe("WXT manifest", () => {
  it("keeps the idle permission and tabbed options in Chrome", async () => {
    const manifest = await manifestFor("chrome");
    const generatedManifest = await generatedManifestFor("chrome");

    expect(manifest.permissions).toContain("idle");
    expect(generatedManifest.options_ui).toEqual({
      page: "options.html",
      open_in_tab: true,
    });
  });

  it("uses the native history new tab only in Firefox", async () => {
    const chromeManifest = await manifestFor("chrome");
    const firefoxManifest = await manifestFor("firefox");

    expect(chromeManifest.chrome_url_overrides).toBeUndefined();
    expect(firefoxManifest.chrome_url_overrides).toEqual({
      newtab: "walking-record.html",
    });
  });

  it("removes unsupported idle and options tab settings in Safari", async () => {
    const manifest = await manifestFor("safari");
    const generatedManifest = await generatedManifestFor("safari");

    expect(manifest.description?.length).toBeLessThanOrEqual(112);
    expect(manifest.permissions).not.toContain("idle");
    expect(generatedManifest.options_ui).toEqual({
      page: "options.html",
    });
  });
});
