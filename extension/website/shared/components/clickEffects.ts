// ABOUTME: Creates one-shot click effects for archive and live cursor trails.
// ABOUTME: Tracks live emitted keys so growing trails do not replay prior clicks.

import type { ClickEffect, TrailState } from "../types";

export interface LiveClickEffect extends ClickEffect {
  trailId: string;
}

export function createClickEffect(params: {
  id: string;
  x: number;
  y: number;
  color: string;
  startTime: number;
  trailIndex: number;
  holdDuration?: number;
}): ClickEffect {
  return {
    ...params,
    radiusFactor: Math.random(),
    durationFactor: Math.random(),
  };
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
      ...createClickEffect({
        id: key,
        x: position.x,
        y: position.y,
        color,
        startTime,
        trailIndex: 0,
        holdDuration: click.duration,
      }),
      trailId: trailState.trail.id,
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
