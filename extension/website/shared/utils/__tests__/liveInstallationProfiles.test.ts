// ABOUTME: Tests named live-installation profile resolution and current machine settings.
// ABOUTME: Protects stable screen identities while allowing explicit URL overrides elsewhere.

import { describe, expect, it } from "vitest";
import {
  parseCinematicFromUrl,
  parseFollowerIdFromUrl,
  parseInstallationRoleFromUrl,
} from "../../config";
import { parseLiveInstallationScreen } from "../liveInstallation";
import {
  LIVE_INSTALLATION_PROFILES,
  resolveLiveInstallationProfile,
} from "../liveInstallationProfiles";

describe("live installation profiles", () => {
  it("resolves every named machine profile", () => {
    for (const [name, profile] of Object.entries(LIVE_INSTALLATION_PROFILES)) {
      expect(resolveLiveInstallationProfile(`?screen=${name}`)).toBe(profile);
    }
    expect(resolveLiveInstallationProfile("?screen=unknown")).toBeNull();
    expect(resolveLiveInstallationProfile("")).toBeNull();
  });

  it("keeps the current installation settings in centrally deployed profiles", () => {
    expect(LIVE_INSTALLATION_PROFILES.scrolling.settings.scrollSpeed).toBe(0.35);
    expect(
      LIVE_INSTALLATION_PROFILES.scrolling.settings.maxConcurrentScrolls,
    ).toBe(30);
    expect(LIVE_INSTALLATION_PROFILES.typing.settings).toMatchObject({
      textboxOpacity: 0.85,
      keyboardAnimationSpeed: 0.4,
      maxConcurrentTyping: 30,
    });
    expect(LIVE_INSTALLATION_PROFILES.clicks.settings).toMatchObject({
      clickMaxRadius: 55,
      clickNumRings: 6,
      clickMaxGapMs: 850,
    });
    expect(LIVE_INSTALLATION_PROFILES.cursors.settings).toMatchObject({
      trailAnimationMode: "natural",
      strokeWidth: 6,
      trailOpacity: 0.9,
      maxConcurrentTrails: 24,
    });
  });

  it("uses recorded participant colors on every installation screen", () => {
    for (const profile of Object.values(LIVE_INSTALLATION_PROFILES)) {
      expect(profile.settings.randomizeColors).toBe(false);
    }
  });

  it("enables sound only on the main cursor field", () => {
    expect(LIVE_INSTALLATION_PROFILES.cursors.defaultSoundEnabled).toBe(true);

    for (const [name, profile] of Object.entries(LIVE_INSTALLATION_PROFILES)) {
      if (name === "cursors") continue;
      expect(profile.defaultSoundEnabled).not.toBe(true);
    }
  });

  it("uses continuous live trails on the cursor field and every follower", () => {
    expect(LIVE_INSTALLATION_PROFILES.cursors.continuousLiveTrails).toBe(true);

    for (const [name, profile] of Object.entries(LIVE_INSTALLATION_PROFILES)) {
      expect(profile.continuousLiveTrails === true).toBe(
        name === "cursors" || name.startsWith("follower-"),
      );
    }
  });

  it("uses explicit follower query parameters over profile defaults", () => {
    const profile = LIVE_INSTALLATION_PROFILES["follower-c"];
    expect(parseLiveInstallationScreen("", profile.screen)).toEqual({
      view: "follow",
      slot: 2,
      slots: 4,
    });
    expect(
      parseLiveInstallationScreen("?view=field&slot=0&slots=2", profile.screen),
    ).toEqual({ view: "field", slot: 0, slots: 2 });
  });

  it("provides a complete follower runtime without redundant query parameters", () => {
    const profile = LIVE_INSTALLATION_PROFILES["follower-c"];

    expect(profile.screen).toEqual({ view: "follow", slot: 2, slots: 4 });
    expect(profile.role).toBe("follower");
    expect(profile.followerId).toBe("c");
    expect(profile.cinematic?.mode).toBe("follow");
  });

  it("lets explicit runtime query parameters override follower defaults", () => {
    const originalUrl = window.location.href;
    const profile = LIVE_INSTALLATION_PROFILES["follower-c"];
    window.history.replaceState(
      null,
      "",
      "/installation/live/?screen=follower-c&role=master&follower=z&cinematic=reveal&cinemaZoom=0.5",
    );

    try {
      expect(parseInstallationRoleFromUrl(profile.role)).toBe("master");
      expect(parseFollowerIdFromUrl(profile.followerId)).toBe("z");
      expect(parseCinematicFromUrl(profile.cinematic)).toMatchObject({
        mode: "reveal",
        zoom: 0.5,
      });
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });
});
