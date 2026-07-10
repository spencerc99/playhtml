// ABOUTME: Hand-drawn ink-stroke icons for each emote, on a shared 24x24 grid (viewBox -12 -12 24 24).
// ABOUTME: Each value is the inner SVG markup (paths only); the wheel/renderer wrap it in a stroked <svg>.

/**
 * Inner SVG for each emote, drawn to a centered 24x24 box so every icon shares
 * the same weight and footprint. Strokes inherit `stroke`/`stroke-width` from
 * the wrapping <svg> (see emoteIconSvg), so paths carry geometry only.
 */
export const EMOTE_ICONS: Record<string, string> = {
  // waving figure — stick person, one arm raised, motion arc by the hand
  wave: '<circle cx="0" cy="-8" r="2.4"/><path d="M0,-5.5 V4 M0,4 l-4,7 M0,4 l4,7 M0,-2 l-6,3 M0,-2 l6,-6"/><path d="M8,-10 q2,2 0,4" stroke-width="1.3"/>',
  // dancer — stick person mid-kick, arms flung
  dance:
    '<circle cx="-1" cy="-8" r="2.4"/><path d="M-1,-5.5 Q0,0 1,2 M-1,-3 l-6,-4 M-1,-3 l7,-3 M1,2 l-4,8 M1,2 l7,3"/>',
  // spin — circular arrow
  spin: '<path d="M8,-6 a10,10 0 1,1 -6,-4 M2,-13 l0,7 l7,0"/>',
  // heart
  heart: '<path d="M0,9 C-13,-2 -8,-13 0,-6 C8,-13 13,-2 0,9 Z"/>',
  // sparkle — four-point star
  sparkle: '<path d="M0,-11 l3,8 l8,3 l-8,3 l-3,8 l-3,-8 l-8,-3 l8,-3 Z"/>',
  // sleepy — zig-zag Z with a small trailing z
  sleepy: '<path d="M-8,-7 h10 l-10,13 h10"/><path d="M6,-1 h4 l-4,5 h4" stroke-width="1.4"/>',
  // musical note
  note: '<path d="M-5,8 a4,3.2 0 1,0 8,0 a4,3.2 0 1,0 -8,0 M3,8 v-16 l7,3"/>',
  // high five — raised open palm (mitt)
  highfive:
    '<path d="M-6,2 v-7 M-2,0 v-10 M2,0 v-10 M6,2 v-6 M-6,2 a6,7 0 0,0 12,0" stroke-width="1.8"/>',
  // nuzzle — two heads close together, a small heart floating between
  nuzzle:
    '<circle cx="-4.5" cy="2" r="4.2"/><circle cx="5" cy="0.5" r="3.4"/><path d="M0.5,-6 C-2.5,-8.5 -1,-11.5 0.5,-9.5 C2,-11.5 3.5,-8.5 0.5,-6 Z" stroke-width="1.4"/>',
  // poke — jab arrow
  poke: '<path d="M-7,-9 l11,9 l-11,9 M-9,0 h9" stroke-width="1.6"/>',
};

/**
 * Wrap an emote's inner icon markup in a stroked 24x24 <svg>. `size` sets the
 * rendered px box; color/weight come from the passed args so callers can theme.
 */
export function emoteIconSvg(
  id: string,
  size: number,
  color: string,
  strokeWidth = 2,
): string {
  const inner = EMOTE_ICONS[id] ?? "";
  return `<svg viewBox="-12 -12 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
