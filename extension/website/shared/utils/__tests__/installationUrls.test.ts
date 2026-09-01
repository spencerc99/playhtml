// ABOUTME: Tests generated URL contracts for archive and live multi-screen installations.
// ABOUTME: Ensures each cross-computer follower receives one stable participant slot.

import { describe, expect, it } from "vitest";
import { buildLiveInstallationScreens } from "../installationUrls";

describe("buildLiveInstallationScreens", () => {
  it("builds one field and four disjoint follower URLs by default", () => {
    const screens = buildLiveInstallationScreens("https://wewere.online");

    expect(screens).toHaveLength(5);
    expect(new URL(screens[0].url).searchParams.get("view")).toBe("field");
    expect(
      screens.slice(1).map((screen) => {
        const url = new URL(screen.url);
        return {
          path: url.pathname,
          view: url.searchParams.get("view"),
          slot: url.searchParams.get("slot"),
          slots: url.searchParams.get("slots"),
          cinematic: url.searchParams.get("cinematic"),
        };
      }),
    ).toEqual(
      ["0", "1", "2", "3"].map((slot) => ({
        path: "/installation/live/",
        view: "follow",
        slot,
        slots: "4",
        cinematic: "follow",
      })),
    );
  });

  it("caps generated followers at the runtime slot limit", () => {
    expect(
      buildLiveInstallationScreens("https://wewere.online", 40),
    ).toHaveLength(33);
  });
});
