// ABOUTME: Offline fallback data — wandering cursor paths and clicks shaped like real trails.
// ABOUTME: Used only when the worker archive is unreachable, and always labeled as such on the page.

import { Trail } from "../shared/types";
import { seededRandom } from "../shared/utils/styleUtils";

const ACCENTS = ["#4a9a8a", "#c4724e", "#5b8db8", "#d4b85c"];

/** Roughly the cadence of real captured cursor samples. */
const SAMPLE_MS = 45;
const POINTS_PER_TRAIL = 220;
/** Chance per sample that a synthetic cursor clicks. */
const CLICK_CHANCE = 0.012;

/**
 * Generate trails that wander the viewport with drifting heading and speed, so
 * the replay exercises the same code path as archive data when offline.
 */
export function generateSyntheticTrails(
  count: number,
  width: number,
  height: number,
  seed = 7,
): Trail[] {
  const trails: Trail[] = [];
  const now = Date.now();

  for (let t = 0; t < count; t++) {
    const rand = (offset: number) => seededRandom(seed + t * 1013, offset);

    let x = rand(1) * width;
    let y = rand(2) * height;
    let heading = rand(3) * Math.PI * 2;
    let speed = 1.5 + rand(4) * 3;

    const points: Trail["points"] = [];
    const clicks: Trail["clicks"] = [];
    const startTime = now - (count - t) * 4000;

    for (let i = 0; i < POINTS_PER_TRAIL; i++) {
      const ts = startTime + i * SAMPLE_MS;
      points.push({ x, y, ts });

      if (seededRandom(seed + t * 1013, 500 + i) < CLICK_CHANCE) {
        clicks.push({ x, y, ts });
      }

      // Drift the heading and speed so the path curves instead of zigzagging,
      // and mix in occasional near-pauses to give speed-pressure something to
      // respond to.
      heading += (seededRandom(seed + t * 1013, 1000 + i) - 0.5) * 0.55;
      speed += (seededRandom(seed + t * 1013, 2000 + i) - 0.5) * 1.1;
      speed = Math.max(0.15, Math.min(9, speed));

      x += Math.cos(heading) * speed * 3;
      y += Math.sin(heading) * speed * 3;

      // Bounce off the edges rather than drifting off-canvas forever.
      if (x < 0 || x > width) {
        heading = Math.PI - heading;
        x = Math.max(0, Math.min(width, x));
      }
      if (y < 0 || y > height) {
        heading = -heading;
        y = Math.max(0, Math.min(height, y));
      }
    }

    trails.push({
      id: `synthetic-${t}`,
      points,
      clicks,
      color: ACCENTS[t % ACCENTS.length],
      opacity: 1,
      startTime: points[0].ts,
      endTime: points[points.length - 1].ts,
    });
  }

  return trails;
}
