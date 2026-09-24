// ABOUTME: Stores the screen positions for named installation window layouts.
// ABOUTME: Fits each layout to the current display when opening its production URLs.

import type { LiveInstallationProfileName } from "../../shared/utils/liveInstallationProfiles";
import type { InstallationScreen } from "../../shared/utils/installationUrls";

interface WindowPosition {
  screen: LiveInstallationProfileName;
  number: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InstallationLayout {
  name: string;
  width: number;
  height: number;
  windows: readonly WindowPosition[];
}

export const ARS_LAYOUT: InstallationLayout = {
  name: "Ars Electronica",
  width: 1100,
  height: 750,
  windows: [
    { screen: "typing", number: 1, x: 30, y: 5, width: 135, height: 190 },
    { screen: "follower-a", number: 2, x: 204, y: 5, width: 195, height: 108 },
    { screen: "follower-b", number: 6, x: 424, y: 90, width: 195, height: 108 },
    { screen: "cursors", number: 7, x: 318, y: 230, width: 427, height: 235 },
    { screen: "follower-c", number: 8, x: 642, y: 0, width: 120, height: 210 },
    { screen: "touches", number: 9, x: 520, y: 587, width: 165, height: 136 },
    { screen: "scrolling", number: 10, x: 818, y: 0, width: 210, height: 120 },
    { screen: "follower-d", number: 12, x: 780, y: 318, width: 220, height: 130 },
    { screen: "clicks", number: 13, x: 722, y: 508, width: 185, height: 137 },
  ],
};

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function positionInstallationWindows(
  layout: InstallationLayout,
  bounds: WindowBounds,
): Map<LiveInstallationProfileName, WindowBounds> {
  const margin = 20;
  const scale = Math.min(
    (bounds.width - margin * 2) / layout.width,
    (bounds.height - margin * 2) / layout.height,
  );
  const layoutLeft = bounds.left + (bounds.width - layout.width * scale) / 2;
  const layoutTop = bounds.top + (bounds.height - layout.height * scale) / 2;

  return new Map(layout.windows.map((slot) => {
    const sizeScale = Math.max(scale, 240 / slot.width, 200 / slot.height);
    const width = Math.min(bounds.width, Math.round(slot.width * sizeScale));
    const height = Math.min(bounds.height, Math.round(slot.height * sizeScale));
    const centerX = layoutLeft + (slot.x + slot.width / 2) * scale;
    const centerY = layoutTop + (slot.y + slot.height / 2) * scale;
    return [slot.screen, {
      left: Math.round(Math.max(bounds.left, Math.min(centerX - width / 2, bounds.left + bounds.width - width))),
      top: Math.round(Math.max(bounds.top, Math.min(centerY - height / 2, bounds.top + bounds.height - height))),
      width,
      height,
    }];
  }));
}

export function openInstallationLayout(
  layout: InstallationLayout,
  screens: InstallationScreen[],
  browserWindow: Window,
): void {
  const positions = positionsOnCurrentDisplay(layout, browserWindow);
  for (const screen of screens) {
    openScreen(screen, positions, browserWindow);
  }
}

export function openInstallationScreen(
  layout: InstallationLayout,
  screen: InstallationScreen,
  browserWindow: Window,
): void {
  openScreen(screen, positionsOnCurrentDisplay(layout, browserWindow), browserWindow);
}

function positionsOnCurrentDisplay(
  layout: InstallationLayout,
  browserWindow: Window,
): Map<LiveInstallationProfileName, WindowBounds> {
  const display = browserWindow.screen as Screen & { availLeft?: number; availTop?: number };
  return positionInstallationWindows(layout, {
    left: display.availLeft ?? 0,
    top: display.availTop ?? 0,
    width: display.availWidth,
    height: display.availHeight,
  });
}

function openScreen(
  screen: InstallationScreen,
  positions: Map<LiveInstallationProfileName, WindowBounds>,
  browserWindow: Window,
): void {
  const name = new URL(screen.url).searchParams.get("screen") as LiveInstallationProfileName;
  const position = positions.get(name);
  if (!position) throw new Error(`No position for installation screen ${name}`);
  browserWindow.open(
    screen.url,
    "_blank",
    `popup=yes,noopener,left=${position.left},top=${position.top},width=${position.width},height=${position.height}`,
  );
}
