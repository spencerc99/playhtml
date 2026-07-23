// ABOUTME: Converts due live-trail clicks into one-shot ripple effects.
// ABOUTME: Tracks emitted keys so growing trails do not replay prior clicks.

import type { ClickEffect, TrailState } from "../types";

export interface LiveClickEffect extends ClickEffect {
  trailId: string;
}

export function collectDueClickEffects(
  trailState: TrailState,
  progress: number,
  spawnedClickKeys: Set<string>,
  position: { x: number; y: number },
  color: string,
  startTime: number,
): LiveClickEffect[] {
  const effects: LiveClickEffect[] = [];

  trailState.clicksWithProgress.forEach((click, index) => {
    if (click.progress > progress) return;

    const key = `${trailState.trail.id}|${click.ts}|${index}`;
    if (spawnedClickKeys.has(key)) return;

    spawnedClickKeys.add(key);
    effects.push({
      id: key,
      trailId: trailState.trail.id,
      x: position.x,
      y: position.y,
      color,
      radiusFactor: Math.random(),
      durationFactor: Math.random(),
      startTime,
      trailIndex: 0,
      holdDuration: click.duration,
    });
  });

  return effects;
}

export function retainClickEffectsForActiveTrails(
  effects: LiveClickEffect[],
  removedTrailIds: Set<string>,
): LiveClickEffect[] {
  const retained = effects.filter(
    (effect) => !removedTrailIds.has(effect.trailId),
  );
  return retained.length === effects.length ? effects : retained;
}
