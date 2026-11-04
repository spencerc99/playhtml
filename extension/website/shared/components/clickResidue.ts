// ABOUTME: Bounds retained click marks and computes their age-based opacity.
// ABOUTME: Shares residue behavior between click playback and raster drawing.
import type { ClickEffect } from "../types";

export const MAX_VISIBLE_CLICK_EFFECTS = 4000;

const MINIMUM_RESIDUE_OPACITY = 0.03;

export function getClickResidueOpacity(
  index: number,
  total: number,
  completed: boolean,
): number {
  if (!completed) return 1;

  const distanceFromNewest = total - index - 1;
  const fadeProgress = Math.min(
    1,
    distanceFromNewest / Math.max(1, MAX_VISIBLE_CLICK_EFFECTS - 1),
  );
  return 1 - (1 - MINIMUM_RESIDUE_OPACITY) * fadeProgress;
}

export type VisibleClickEffect = ClickEffect & {
  sourceId: string;
  completed: boolean;
};

export function mergeClickEffects(
  current: VisibleClickEffect[],
  incoming: VisibleClickEffect[],
): VisibleClickEffect[] {
  return [...current, ...incoming].slice(-MAX_VISIBLE_CLICK_EFFECTS);
}
