// ABOUTME: Tests route-specific defaults in movement share URLs.
// ABOUTME: Keeps clean live portrait URLs free of default-setting blobs.

import { describe, expect, it } from "vitest";
import { DEFAULT_ACTIVE_VISUALIZATIONS } from "../../components/registry";
import { DEFAULT_SETTINGS } from "../../components/settingsDefaults";
import { buildShareUrl } from "../shareUrl";

describe("buildShareUrl", () => {
  it("omits settings that match route-specific defaults", () => {
    const settingsDefaults = { ...DEFAULT_SETTINGS, clickMaxRadius: 50 };

    expect(
      buildShareUrl({
        settings: settingsDefaults,
        settingsDefaults,
        activeVisualizations: DEFAULT_ACTIVE_VISUALIZATIONS,
        selectedTimeRange: null,
        baseUrl: "https://wewere.online/portrait/",
      }),
    ).toBe("https://wewere.online/portrait/");
  });

  it("serializes an override of the route-specific default", () => {
    const settingsDefaults = { ...DEFAULT_SETTINGS, clickMaxRadius: 50 };
    const url = buildShareUrl({
      settings: { ...settingsDefaults, clickMaxRadius: 40 },
      settingsDefaults,
      activeVisualizations: DEFAULT_ACTIVE_VISUALIZATIONS,
      selectedTimeRange: null,
      baseUrl: "https://wewere.online/portrait/",
    });

    expect(new URL(url).searchParams.has("s")).toBe(true);
  });
});
