// ABOUTME: The p5.brush tools this experiment offers, and the weight-to-pixels mapping.
// ABOUTME: Keeps one slider value meaning the same on-screen stroke width on every surface.

/**
 * Brushes in the order they read best, coarse to fine. `brush.box()` is the
 * runtime truth; this list drives the UI and the comparison sheet, and any
 * brush the library reports but this list omits still works if selected.
 */
export const TRAIL_BRUSHES = [
  "pen",
  "rotring",
  "2B",
  "HB",
  "2H",
  "cpencil",
  "pastel",
  "crayon",
  "charcoal",
  "spray",
  "marker",
] as const;

/**
 * How p5.brush turns a weight into pixels.
 *
 * Every brush carries a base `weight` and `scatter` in its own definition (see
 * `stroke.js`). A stamp's radius is `brushDef.weight * State.stroke.weight *
 * pressure`, and the tip is jittered sideways by `State.stroke.weight *
 * brushDef.scatter`. `State.stroke.weight` is what `brush.set(name, color, w)`
 * sets, so the visible width is roughly:
 *
 *   width_px ~= w * (brushDef.weight + 2 * brushDef.scatter) * scaleBrushes
 *
 * The scatter term dominates for the soft brushes — pastel's base weight is 0.7
 * but its scatter is 5, so it spreads far wider than its nominal weight.
 *
 * `brush.scaleBrushes(f)` multiplies every registered brush's weight, scatter
 * AND spacing in place, permanently and cumulatively. Because it mutates the
 * shared registry rather than scaling per draw, it must be called exactly once
 * per p5 instance with a factor that does NOT depend on canvas size — otherwise
 * the same slider value produces a different stroke width on a 600px tile than
 * on a full viewport, which is exactly the bug this constant fixes.
 */
export const BRUSH_SCALE = 1;

/**
 * Per-brush multiplier applied on top of the weight slider, chosen so that
 * slider 1.0 lands every brush near {@link REFERENCE_STROKE_PX} on screen.
 * The built-in brushes differ by more than an order of magnitude in how much
 * ink they lay down, mostly through scatter.
 */
const WEIGHT_SCALE: Record<string, number> = {
  pen: 1,
  rotring: 1,
  "2B": 1,
  HB: 1,
  "2H": 1,
  cpencil: 0.9,
  pastel: 0.55,
  crayon: 0.5,
  charcoal: 0.5,
  spray: 0.8,
  marker: 0.8,
};

/**
 * Approximate on-screen width, in CSS pixels, that each brush covers per unit
 * of applied weight. Measured from the brush definitions as
 * `brushDef.weight + 2 * brushDef.scatter`, which is the stamp diameter plus
 * the scatter spread either side. Used only for the readout, so a rough figure
 * is enough to tune against.
 */
const PIXELS_PER_WEIGHT: Record<string, number> = {
  pen: 2,
  rotring: 1.5,
  "2B": 4,
  HB: 3,
  "2H": 2.5,
  cpencil: 4,
  pastel: 10.7,
  crayon: 12,
  charcoal: 13,
  spray: 8,
  marker: 6,
};

/** The stroke width slider 1.0 aims for, matched to the SVG renderer's size 5. */
export const REFERENCE_STROKE_PX = 5;

/** The weight actually handed to `brush.set()` for this brush. */
export function effectiveWeight(brushName: string, sliderWeight: number): number {
  return sliderWeight * (WEIGHT_SCALE[brushName] ?? 1);
}

/** Rough on-screen stroke width in CSS pixels, for the perf readout. */
export function strokeWidthPx(brushName: string, sliderWeight: number): number {
  return (
    effectiveWeight(brushName, sliderWeight) *
    (PIXELS_PER_WEIGHT[brushName] ?? 3)
  );
}
