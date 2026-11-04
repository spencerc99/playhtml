// ABOUTME: Label anchors placed on a group's densest cluster, not its centroid.
// ABOUTME: One pass over the pages at load, into typed arrays the label layer reads.

/**
 * Where a place's name belongs.
 *
 * The bundle gives each subdomain and domain the arithmetic mean of its pages'
 * positions. That is the right answer only when a group is one blob. Plenty of
 * them are not: a domain whose pages settled into two clusters gets a mean
 * that lands in the empty ground between them, and its name then floats over
 * nothing — freesewing.eu is the clearest case in data-small.
 *
 * The fix is a mode rather than a mean. Bin every page into a coarse grid,
 * find each group's heaviest bin, and anchor the name at the weighted centre
 * of that bin's members. A bimodal group snaps to whichever lobe actually
 * holds the pages instead of splitting the difference; a unimodal group lands
 * where the mean already was.
 *
 * Two passes over the pages, all typed arrays. The data format is untouched.
 */

export interface AnchorInput {
  /** page positions, and the weight each page's presence carries */
  pageX: Float32Array;
  pageY: Float32Array;
  pageWeight: ArrayLike<number>;
  /** which subdomain each page belongs to, and which domain each subdomain does */
  pageSub: Uint32Array;
  subDom: Uint32Array;
  /** the centroids from the bundle, kept as the fallback for an empty group */
  subX: Float32Array;
  subY: Float32Array;
  domX: Float32Array;
  domY: Float32Array;
  /** world bounds, so the bin grid has a scale */
  extent: [number, number, number, number];
}

export interface Anchors {
  subX: Float32Array;
  subY: Float32Array;
  domX: Float32Array;
  domY: Float32Array;
}

/**
 * How coarse the bins are, as a fraction of the world's shorter side. Fine
 * enough that two lobes of one domain fall in different bins, coarse enough
 * that a single ordinary district stays in one.
 */
const BIN_FRACTION = 1 / 160;
const BIN_COLS = 4096;
const BIN_SPACE = BIN_COLS * BIN_COLS;

export function computeAnchors(inp: AnchorInput): Anchors {
  const { pageX, pageY, pageWeight, pageSub, subDom } = inp;
  const [x0, y0, x1, y1] = inp.extent;
  const cell = Math.max(Math.min(x1 - x0, y1 - y0) * BIN_FRACTION, 1e-6);
  const nPages = pageX.length;

  const weight = (p: number) => Math.max(1, pageWeight[p] ?? 1);

  const binOf = (x: number, y: number) => {
    const bx = Math.min(BIN_COLS - 1, Math.max(0, Math.floor((x - x0) / cell)));
    const by = Math.min(BIN_COLS - 1, Math.max(0, Math.floor((y - y0) / cell)));
    return by * BIN_COLS + bx;
  };

  /** Pages carry a domain id too, through page -> sub -> dom. */
  const pageDom = new Uint32Array(nPages);
  for (let p = 0; p < nPages; p++) {
    const s = pageSub[p];
    pageDom[p] = s < subDom.length ? subDom[s] : 0;
  }

  /**
   * Anchor every group, given which group each page belongs to.
   *
   * The first pass tallies weight per (group, bin) and remembers each group's
   * heaviest bin; the second averages the positions inside that bin. Bins are
   * hashed into a map rather than allocated densely, because the world is
   * mostly empty ground.
   */
  function anchor(
    n: number, groupOf: Uint32Array, fx: Float32Array, fy: Float32Array,
  ): [Float32Array, Float32Array] {
    const best = new Float64Array(n);
    const bestBin = new Float64Array(n).fill(-1);
    const tally = new Map<number, number>();

    for (let p = 0; p < nPages; p++) {
      const g = groupOf[p];
      if (g >= n) continue;
      const key = g * BIN_SPACE + binOf(pageX[p], pageY[p]);
      const w = (tally.get(key) ?? 0) + weight(p);
      tally.set(key, w);
      if (w > best[g]) { best[g] = w; bestBin[g] = key % BIN_SPACE; }
    }

    const sx = new Float64Array(n), sy = new Float64Array(n), sw = new Float64Array(n);
    for (let p = 0; p < nPages; p++) {
      const g = groupOf[p];
      if (g >= n || binOf(pageX[p], pageY[p]) !== bestBin[g]) continue;
      const w = weight(p);
      sx[g] += pageX[p] * w;
      sy[g] += pageY[p] * w;
      sw[g] += w;
    }

    const ox = new Float32Array(n), oy = new Float32Array(n);
    for (let g = 0; g < n; g++) {
      // A group with no pages of its own keeps the position it shipped with.
      if (sw[g] > 0) { ox[g] = sx[g] / sw[g]; oy[g] = sy[g] / sw[g]; }
      else { ox[g] = fx[g]; oy[g] = fy[g]; }
    }
    return [ox, oy];
  }

  const [subX, subY] = anchor(inp.subX.length, pageSub, inp.subX, inp.subY);
  const [domX, domY] = anchor(inp.domX.length, pageDom, inp.domX, inp.domY);
  return { subX, subY, domX, domY };
}
