// ABOUTME: Resolves the ink color used to render a sheet's scroll frame and cursor trails.
// ABOUTME: Shared by ScrollPlate and TrailsPlate so both plates agree on a sheet's dominant color for a given inkMode.
import { getColorForEvent, RISO_COLORS } from "../../shared/utils/eventUtils";
import type { VellumSettings } from "../settings";
import type { VellumSheet } from "../types";

export function resolveInk(
  sheet: VellumSheet,
  settings: Pick<VellumSettings, "inkMode" | "monoColor">,
): string {
  switch (settings.inkMode) {
    case "mono":
      return settings.monoColor;
    case "riso":
      return RISO_COLORS[sheet.seed % RISO_COLORS.length];
    case "participant":
    default: {
      const firstEvent = sheet.cursorEvents[0] ?? sheet.viewportEvents[0];
      return firstEvent
        ? getColorForEvent(firstEvent)
        : RISO_COLORS[sheet.seed % RISO_COLORS.length];
    }
  }
}
