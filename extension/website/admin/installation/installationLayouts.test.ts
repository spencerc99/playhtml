// ABOUTME: Checks the Ars screen assignments and window placement calculations.
// ABOUTME: Verifies the opener requests distinct production windows with safe features.

import { describe, expect, it, vi } from "vitest";
import { buildLiveInstallationScreens } from "../../shared/utils/installationUrls";
import { ARS_LAYOUT, openInstallationLayout, positionInstallationWindows } from "./installationLayouts";

describe("installation layouts", () => {
  it("assigns every named screen to its Ars position", () => {
    const screens = buildLiveInstallationScreens("https://wewere.online");
    const names = screens.map((screen) => new URL(screen.url).searchParams.get("screen"));
    expect(ARS_LAYOUT.windows.map((slot) => slot.screen).sort()).toEqual(names.sort());
    expect(new Set(ARS_LAYOUT.windows.map((slot) => slot.number)).size).toBe(9);
  });

  it("keeps all windows on the available display and preserves their relative centers", () => {
    const positions = positionInstallationWindows(ARS_LAYOUT, {
      left: 1920,
      top: 24,
      width: 1600,
      height: 900,
    });
    for (const position of positions.values()) {
      expect(position.left).toBeGreaterThanOrEqual(1920);
      expect(position.top).toBeGreaterThanOrEqual(24);
      expect(position.left + position.width).toBeLessThanOrEqual(3520);
      expect(position.top + position.height).toBeLessThanOrEqual(924);
    }
    expect(positions.get("typing")!.left).toBeLessThan(positions.get("cursors")!.left);
    expect(positions.get("cursors")!.left).toBeLessThan(positions.get("scrolling")!.left);
    expect(positions.get("follower-c")!.top).toBeLessThan(positions.get("clicks")!.top);
  });

  it("requests a separate positioned production window for each screen", () => {
    const open = vi.fn();
    const browserWindow = {
      screen: { availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 900 },
      open,
    } as unknown as Window;
    const screens = buildLiveInstallationScreens("https://wewere.online");

    openInstallationLayout(ARS_LAYOUT, screens, browserWindow);

    expect(open).toHaveBeenCalledTimes(9);
    expect(open.mock.calls.map(([url]) => url)).toEqual(screens.map((screen) => screen.url));
    for (const [, target, features] of open.mock.calls) {
      expect(target).toBe("_blank");
      expect(features).toMatch(/^popup=yes,noopener,left=\d+,top=\d+,width=\d+,height=\d+$/);
    }
  });
});
