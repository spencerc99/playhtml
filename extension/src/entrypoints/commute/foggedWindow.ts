// ABOUTME: Shared-state shape and fade maths for the commute's fogged windows.
// ABOUTME: Strokes are keyed per pane so concurrent riders never clobber each other.

/** A single wipe: normalized 0-1 points across the pane. */
export interface FoggedStroke {
  id: string;
  /** Author's playhtml colour, so old wipes still read as somebody's hand. */
  color: string;
  drawnAt: number;
  points: number[];
}

/** Keyed by stroke id — a map, so concurrent writers merge instead of append. */
export type FoggedPaneStrokes = Record<string, FoggedStroke>;

/** Keyed by bay id, then by stroke id. */
export type FoggedWindowData = Record<string, FoggedPaneStrokes>;

/** Condensation reclaims a wipe over roughly three days. */
export const FOG_FADE_MS = 3 * 24 * 60 * 60 * 1000;
/** A wipe stays crisp for its first hour. */
export const FOG_SHARP_MS = 60 * 60 * 1000;
/** Per-pane cap, so a busy line stays legible and the doc stays small. */
export const FOG_MAX_STROKES_PER_PANE = 60;

/**
 * Opacity of a stroke at render time: full while fresh, easing to nothing as
 * fresh condensation settles back over it.
 */
export function getStrokeOpacity(
  stroke: FoggedStroke,
  now: number,
  fadeMs: number = FOG_FADE_MS,
): number {
  const age = now - stroke.drawnAt;
  if (age <= FOG_SHARP_MS) return 1;
  if (age >= fadeMs) return 0;

  const softening = (age - FOG_SHARP_MS) / (fadeMs - FOG_SHARP_MS);
  return Math.max(0, 1 - softening);
}

export function isStrokeVisible(stroke: FoggedStroke, now: number): boolean {
  return getStrokeOpacity(stroke, now) > 0.02;
}

/** Newest-first, dropping wipes the fog has fully reclaimed. */
export function getVisibleStrokes(
  pane: FoggedPaneStrokes | undefined,
  now: number,
): FoggedStroke[] {
  if (!pane) return [];
  return Object.values(pane)
    .filter((stroke) => isStrokeVisible(stroke, now))
    .sort((a, b) => a.drawnAt - b.drawnAt);
}

/** Stroke ids the pane can shed: fully fogged first, then the oldest. */
export function getExpiredStrokeIds(
  pane: FoggedPaneStrokes | undefined,
  now: number,
  maxStrokes: number = FOG_MAX_STROKES_PER_PANE,
): string[] {
  if (!pane) return [];

  const strokes = Object.values(pane);
  const expired = strokes.filter((stroke) => !isStrokeVisible(stroke, now));
  const surviving = strokes
    .filter((stroke) => isStrokeVisible(stroke, now))
    .sort((a, b) => a.drawnAt - b.drawnAt);
  const overflow = Math.max(0, surviving.length - maxStrokes);

  return [
    ...expired.map((stroke) => stroke.id),
    ...surviving.slice(0, overflow).map((stroke) => stroke.id),
  ];
}

/** Flat [x, y, x, y, ...] to an SVG polyline points attribute. */
export function toPolylinePoints(
  points: number[],
  width: number,
  height: number,
): string {
  const pairs: string[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    pairs.push(`${points[index] * width},${points[index + 1] * height}`);
  }
  return pairs.join(" ");
}

/**
 * Drops points closer than `minDistance` (in normalized units) so a drag
 * becomes a handful of stored points rather than hundreds.
 */
export function simplifyStrokePoints(
  points: number[],
  minDistance = 0.012,
): number[] {
  if (points.length < 4) return points;

  const simplified = [points[0], points[1]];
  for (let index = 2; index + 1 < points.length; index += 2) {
    const lastX = simplified[simplified.length - 2];
    const lastY = simplified[simplified.length - 1];
    const distance = Math.hypot(points[index] - lastX, points[index + 1] - lastY);
    if (distance >= minDistance) {
      simplified.push(points[index], points[index + 1]);
    }
  }

  const finalX = points[points.length - 2];
  const finalY = points[points.length - 1];
  if (
    simplified[simplified.length - 2] !== finalX ||
    simplified[simplified.length - 1] !== finalY
  ) {
    simplified.push(finalX, finalY);
  }

  return simplified;
}
