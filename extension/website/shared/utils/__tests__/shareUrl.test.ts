// ABOUTME: Tests route-specific defaults in movement share URLs.
// ABOUTME: Keeps clean live portrait URLs free of default-setting blobs.

import { describe, expect, it } from "vitest";
import { DEFAULT_ACTIVE_VISUALIZATIONS } from "../../components/registry";
import { DEFAULT_SETTINGS } from "../../components/settingsDefaults";
import { parseSpec } from "../settingsSpec";
import { buildShareUrl } from "../shareUrl";

describe("buildShareUrl", () => {
  it("omits settings that match route-specific defaults", () => {
    const settingsDefaults = { ...DEFAULT_SETTINGS, clickMaxRadius: 30 };

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
    const settingsDefaults = { ...DEFAULT_SETTINGS, clickMaxRadius: 30 };
    const url = buildShareUrl({
      settings: { ...settingsDefaults, clickMaxRadius: 40 },
      settingsDefaults,
      activeVisualizations: DEFAULT_ACTIVE_VISUALIZATIONS,
      selectedTimeRange: null,
      baseUrl: "https://wewere.online/portrait/",
    });

    expect(new URL(url).searchParams.has("s")).toBe(true);
  });

  it("preserves live installation screen identity across URL rewrites", () => {
    const originalUrl = window.location.href;
    window.history.replaceState(
      null,
      "",
      "/installation/live/?screen=follower-c&view=follow&slot=2&slots=4",
    );

    try {
      const url = new URL(
        buildShareUrl({
          settings: DEFAULT_SETTINGS,
          activeVisualizations: DEFAULT_ACTIVE_VISUALIZATIONS,
          selectedTimeRange: null,
        }),
      );
      expect(url.searchParams.get("view")).toBe("follow");
      expect(url.searchParams.get("slot")).toBe("2");
      expect(url.searchParams.get("slots")).toBe("4");
      expect(url.searchParams.get("screen")).toBe("follower-c");
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });
});

describe("scroll timeline speed URLs", () => {
  it.each([0.1, 0.5, 1, 4, 10])(
    "round-trips %sx independently of window density",
    (scrollSpeed) => {
      const url = new URL(
        buildShareUrl({
          settings: {
            ...DEFAULT_SETTINGS,
            scrollSpeed,
            maxConcurrentScrolls: 12,
          },
          activeVisualizations: ["scrolling"],
          selectedTimeRange: null,
          baseUrl: "https://wewere.online/installation/live/",
        }),
      );
      expect({
        ...DEFAULT_SETTINGS,
        ...parseSpec(url.searchParams),
      }).toMatchObject({ scrollSpeed, maxConcurrentScrolls: 12 });
      if (scrollSpeed !== 1)
        expect(url.searchParams.get("scrollSpeed")).toBe(String(scrollSpeed));
    },
  );
  it.each(["0", "-1", "NaN", "Infinity", "11", ""])(
    "ignores invalid speed %s",
    (value) => {
      expect(
        parseSpec(new URLSearchParams({ scrollSpeed: value })).scrollSpeed,
      ).toBeUndefined();
    },
  );
});
