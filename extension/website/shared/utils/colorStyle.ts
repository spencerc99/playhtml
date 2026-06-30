// ABOUTME: Derives washes/shades from a participant color so the window + typing
// ABOUTME: visualizations share the vibrant cursor palette (color vs monochrome).

import { parseColorToHsl } from "./eventUtils";

/** The cursor renderer styles that drive the rest of the canvas. "monochrome"
 * → ink/grayscale; anything else → vibrant participant color. */
export function isMonochromeStyle(trailVisualStyle?: string): boolean {
  return trailVisualStyle === "monochrome";
}

/** A translucent wash of `color` as an `hsla()` string. Falls back to a neutral
 * warm gray wash when the color can't be parsed. `lightnessShift` nudges the
 * base lightness (e.g. lighten a wash so dark cursor colors don't read as muddy
 * panels); clamped to [0,100]. */
export function colorWash(
  color: string,
  alpha: number,
  lightnessShift = 0,
): string {
  const hsl = parseColorToHsl(color);
  if (!hsl) return `rgba(180, 175, 168, ${alpha})`;
  const l = Math.max(0, Math.min(100, hsl.l + lightnessShift));
  return `hsla(${hsl.h}, ${hsl.s}%, ${l}%, ${alpha})`;
}

/** A solid, readable shade of `color` at a target lightness — used for text and
 * borders so the hue reads as the participant's but stays legible on the warm
 * paper background. */
export function colorShade(color: string, lightness: number): string {
  const hsl = parseColorToHsl(color);
  if (!hsl) return `hsl(0, 0%, ${Math.max(0, Math.min(100, lightness))}%)`;
  const l = Math.max(0, Math.min(100, lightness));
  // Keep some saturation so the shade still reads as the hue, but cap it so very
  // saturated cursor colors don't vibrate as text.
  const s = Math.min(hsl.s, 70);
  return `hsl(${hsl.h}, ${s}%, ${l}%)`;
}

/** Re-hues a grayscale value into the participant color, PRESERVING the
 * grayscale's lightness so all the existing texture/contrast (turbulence,
 * speckle, gradient washes) carries through as splotchy color instead of a flat
 * wash. `lum` is the original 0..1 grayscale luminosity; `satScale` (0..1)
 * blends from gray (0) toward the hue's full saturation (1) so highlights can
 * stay paper-pale while mid/shadow tones saturate. */
export function colorizeLuminosity(
  color: string,
  lum: number,
  satScale = 1,
): string {
  const hsl = parseColorToHsl(color);
  const l = Math.max(0, Math.min(100, lum * 100));
  if (!hsl) return `hsl(0, 0%, ${l}%)`;
  const s = Math.max(0, Math.min(100, hsl.s * satScale));
  return `hsl(${hsl.h}, ${s}%, ${l}%)`;
}

/** Readable text lightness for `color` on the warm paper bg: light hues get a
 * darker text shade, already-dark hues get a mid shade. */
export function readableTextLightness(color: string): number {
  const hsl = parseColorToHsl(color);
  if (!hsl) return 25;
  // Aim for enough contrast against the ~95% paper: clamp text to 28–42% L.
  return Math.max(28, Math.min(42, hsl.l - 25));
}
