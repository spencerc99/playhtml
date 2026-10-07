// ABOUTME: Tests generated URL contracts for archive and live multi-screen installations.
// ABOUTME: Ensures each cross-computer follower receives one stable participant slot.

import { describe, expect, it } from "vitest";
import { buildLiveInstallationScreens } from "../installationUrls";

describe("buildLiveInstallationScreens", () => {
  it("builds the exact nine-screen installation set by default", () => {
    const screens = buildLiveInstallationScreens("https://wewere.online");

    expect(screens).toHaveLength(9);
    expect(screens.map((screen) => screen.label)).toEqual([
      "scrolling",
      "keypresses",
      "touches",
      "clicks",
      "cursor field",
      "cursor follower 1",
      "cursor follower 2",
      "cursor follower 3",
      "cursor follower 4",
    ]);

    expect(
      screens.slice(0, 5).map((screen) => {
        const url = new URL(screen.url);
        return {
          path: url.pathname,
          screen: url.searchParams.get("screen"),
          clean: url.searchParams.get("clean"),
        };
      }),
    ).toEqual([
      {
        path: "/installation/live/",
        screen: "scrolling",
        clean: "2",
      },
      { path: "/installation/live/", screen: "typing", clean: "2" },
      { path: "/touches/", screen: "touches", clean: "2" },
      { path: "/installation/live/", screen: "clicks", clean: "2" },
      { path: "/installation/live/", screen: "cursors", clean: "2" },
    ]);

    expect(
      screens.slice(5).map((screen) => {
        const url = new URL(screen.url);
        return {
          path: url.pathname,
          screen: url.searchParams.get("screen"),
          clean: url.searchParams.get("clean"),
        };
      }),
    ).toEqual(
      ["a", "b", "c", "d"].map((follower) => ({
        path: "/installation/live/",
        screen: `follower-${follower}`,
        clean: "2",
      })),
    );
  });
});
