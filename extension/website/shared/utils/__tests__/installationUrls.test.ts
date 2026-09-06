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
          viz: url.searchParams.get("viz"),
          view: url.searchParams.get("view"),
          clean: url.searchParams.get("clean"),
        };
      }),
    ).toEqual([
      {
        path: "/installation/live/",
        viz: "scrolling",
        view: "field",
        clean: "2",
      },
      { path: "/installation/live/", viz: "typing", view: "field", clean: "2" },
      { path: "/touches/", viz: null, view: null, clean: "2" },
      { path: "/installation/live/", viz: "clicks", view: "field", clean: "2" },
      { path: "/installation/live/", viz: "trails", view: "field", clean: "2" },
    ]);

    expect(
      screens.slice(5).map((screen) => {
        const url = new URL(screen.url);
        return {
          path: url.pathname,
          viz: url.searchParams.get("viz"),
          view: url.searchParams.get("view"),
          slot: url.searchParams.get("slot"),
          slots: url.searchParams.get("slots"),
          cinematic: url.searchParams.get("cinematic"),
          clean: url.searchParams.get("clean"),
        };
      }),
    ).toEqual(
      ["0", "1", "2", "3"].map((slot) => ({
        path: "/installation/live/",
        viz: "trails",
        view: "follow",
        slot,
        slots: "4",
        cinematic: "follow",
        clean: "2",
      })),
    );
  });

  it("updates the follower partition across every cursor URL", () => {
    const screens = buildLiveInstallationScreens("https://wewere.online", 2);

    expect(screens).toHaveLength(7);
    expect(
      screens.map((screen) => new URL(screen.url).searchParams.get("slots")),
    ).toEqual(["2", "2", null, "2", "2", "2", "2"]);
    expect(
      screens
        .slice(5)
        .map((screen) => new URL(screen.url).searchParams.get("slot")),
    ).toEqual(["0", "1"]);
  });

  it("caps generated followers at the runtime slot limit", () => {
    expect(
      buildLiveInstallationScreens("https://wewere.online", 40),
    ).toHaveLength(37);
  });
});
