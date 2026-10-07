/**
 * Glyph vocabulary.
 *
 * MEKMode Text has no box-drawing and no block elements, so labels and marks
 * are plain ASCII. Terrain and roads come from MEKMode Dings, whose ASCII slots
 * are pictorial. Both faces share 800/1000 metrics, so they sit on one grid.
 *
 * The face gives us exactly two usable road pieces — banded asphalt and twin
 * verticals. Its crossroads lattice and diagonal are retired: the lattice is
 * not metrically compatible with the straights (3 bands at the cell edge
 * against asphalt's 13, and rails 1-2px off), and the diagonal has no mirrored
 * partner, so half of them leaned against the direction of travel.
 */

/** Terrain ramp, sparse -> dense. Index 0 means "nothing here". */
export const TERRAIN = [
  " ",   // empty
  "q",   // three scattered dots — open country
  "w",   // scattered
  "C",   // loose dot grid — hamlet     (22.8% ink)
  "v",   // regular dot grid — village   (30.4% ink)
  "b",   // checker — suburb
  "B",   // brick with windows — town
  "n",   // solid block — city
];

/** Road glyphs (Dings). */
/**
 * Road glyphs, from MEKMode Dings. Overridable at runtime via ?roadh= / ?roadv=.
 *
 * U+0054 both ways: this is a medieval map, not a modern one. Banded asphalt
 * and twin carriageways are the wrong idiom — a track here is a worn line
 * through the ground, so the same irregular mark serves in either direction and
 * a route reads as trodden rather than paved.
 */
export const ROAD = { h: "T", v: "T" };

/** Landmarks and scenery (Dings). */
export const LANDMARK = {
  tower: "L",
  block: "D",
  gate: "G",
  tree: "i",
  grass: "u",
  mount: "y",
  conifer: "~",
};

/** Direction bits recorded while rasterising a road across the grid. */
export const N = 1, E = 2, S = 4, W = 8;

/**
 * Roads are drawn as up to two overdrawn pieces rather than one glyph.
 *
 * The face has no corner or tee pieces, and its crossroads glyph `m` is not
 * metrically compatible with the straights — `F` meets a cell edge with 13
 * bands and `m` with 3, and their rails sit 1-2px apart, so the texture thins
 * and jogs at every junction. Overdrawing `F` then `l` in the same cell keeps
 * both sets of rails continuous.
 *
 * Corners and tees still show stubs into the empty neighbours; with two
 * pieces for eleven cases there is no way around that short of new glyphs.
 */
export function setRoadGlyphs(h?: string | null, v?: string | null) {
  if (h) ROAD.h = h;
  if (v) ROAD.v = v;
}

export function roadHV(bits: number): [boolean, boolean] {
  return [!!(bits & (E | W)), !!(bits & (N | S))];
}



/**
 * Colour palette, indexed per cell in the baked grid.
 *
 * Index 0 means "use whatever colour the layer is drawn in" — this only tints
 * the things that earn it. Runs are batched on (glyph, tint) together, so a
 * palette entry costs nothing extra unless it actually varies from cell to
 * cell.
 *
 * The values live in theme.ts and are pushed in here whenever the theme
 * changes; the bake indexes into this array by slot, and the slot layout is
 * fixed, so a colour change never needs a rebake.
 *
 * Colour carries the hierarchy. The family is the DOMAIN, the step is the
 * subdomain, and opacity is the page's own traffic — so one site is one hue
 * however many parts it has. Keying the family on the neighbourhood instead
 * shredded youtube.com into 1,237 unrelated colours, because most of those
 * "neighbourhoods" are just chunks of youtube.com/watch left over from the
 * 400-page split rather than anything a reader would recognise.
 */
export const PALETTE: string[] = [];
export const TINT_WOOD = 1, TINT_WOOD_N = 5;
export const TINT_FIELD = 6, TINT_FIELD_N = 2;
export const TINT_PASTEL = 8, TINT_FAMILIES = 12, TINT_STEPS = 3;

/**
 * Per-building opacity, by traffic.
 *
 * Every building was drawn at one alpha, so a page nobody visits sat as
 * brightly on the map as a page everybody does. Varying it gives a city the
 * unevenness of lit and unlit windows, and carries real information doing it.
 */
export const BUILD_ALPHA: number[] = [];

/** Replace the palette and alpha ramp in place, so every importer sees it. */
export function setPalette(colours: string[], alpha: number[]) {
  PALETTE.length = 0;
  PALETTE.push(...colours);
  BUILD_ALPHA.length = 0;
  BUILD_ALPHA.push(...alpha);
}
