// ABOUTME: Removes a scrap image's backdrop by flooding inward from its border.
// ABOUTME: Pure mask math plus a canvas pipeline that recomputes from stored parameters.

/**
 * How a piece's background was removed. Adding another way of cutting out
 * means adding a member here, so a stored collage always says which one made
 * it rather than leaving the reader to guess.
 */
export type PieceCutout = {
  method: "edge-color";
  /** How far a pixel may stray from the border color and still be backdrop. */
  tolerance: number;
};

export const DEFAULT_CUTOUT_TOLERANCE = 0.12;

/** Longest side the mask is computed at, then scaled back up. */
export const CUTOUT_WORKING_SIDE = 1024;

/** Width in working pixels over which the cut edge fades out. */
const FEATHER_RADIUS = 2;

/** Share of the border one tone must hold to count as the backdrop. */
const BACKDROP_BORDER_SHARE = 1 / 3;

export function isCutoutMethod(value: unknown): value is PieceCutout["method"] {
  return value === "edge-color";
}

export function parseCutout(value: unknown): PieceCutout | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") {
    throw new Error("Piece cutout is not an object");
  }
  const cutout = value as Record<string, unknown>;
  if (!isCutoutMethod(cutout.method)) {
    throw new Error(
      `Piece cutout uses an unknown method: ${String(cutout.method)}`,
    );
  }
  if (
    typeof cutout.tolerance !== "number" ||
    !Number.isFinite(cutout.tolerance)
  ) {
    throw new Error("Piece cutout is missing a numeric tolerance");
  }
  return { method: cutout.method, tolerance: cutout.tolerance };
}

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, as a canvas hands it over. */
  data: Uint8ClampedArray;
}

/** Squared RGB distance, normalized so 1 is the far corner of the color cube. */
function colorDistance(
  data: Uint8ClampedArray,
  a: number,
  b: number,
): number {
  const dr = data[a] - data[b];
  const dg = data[a + 1] - data[b + 1];
  const db = data[a + 2] - data[b + 2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.6729559300637;
}

/** Every pixel offset along the image's outermost ring. */
function borderRing(bitmap: Bitmap): number[] {
  const { width, height } = bitmap;
  const offsets: number[] = [];
  for (let x = 0; x < width; x += 1) {
    offsets.push(x * 4);
    offsets.push(((height - 1) * width + x) * 4);
  }
  for (let y = 1; y < height - 1; y += 1) {
    offsets.push(y * width * 4);
    offsets.push((y * width + width - 1) * 4);
  }
  return offsets;
}

/**
 * The colors the backdrop is made of, taken from the image's border.
 *
 * The border is grouped into clusters of similar color and only the clusters
 * covering enough of the ring are kept. A subject that reaches an edge shows
 * up as a small cluster and is left out, so it survives the fill, while a
 * backdrop that is two-tone or slightly graded still contributes both of its
 * tones.
 */
export function borderSamples(bitmap: Bitmap, tolerance = 0.1): number[] {
  const ring = borderRing(bitmap);
  if (ring.length === 0) return [];

  const clusters: { offset: number; count: number }[] = [];
  for (const offset of ring) {
    const existing = clusters.find(
      (cluster) => colorDistance(bitmap.data, offset, cluster.offset) <= tolerance,
    );
    if (existing) existing.count += 1;
    else clusters.push({ offset, count: 1 });
  }

  // A tone has to hold a third of the border to count as backdrop. Below that
  // it is something the picture pushed up against an edge, not the backdrop.
  const floor = ring.length * BACKDROP_BORDER_SHARE;
  const backdrop = clusters.filter((cluster) => cluster.count >= floor);
  if (backdrop.length > 0) return backdrop.map((cluster) => cluster.offset);

  // Nothing dominates, so fall back to the single most common tone rather
  // than treating every edge color as backdrop.
  const largest = clusters.reduce((best, cluster) =>
    cluster.count > best.count ? cluster : best,
  );
  return [largest.offset];
}

/**
 * Marks every pixel reachable from the border through pixels close in color
 * to one of the border samples. Only regions connected to the border are
 * removed, so a white shirt enclosed by the subject survives.
 *
 * Returns coverage per pixel: 0 where the backdrop was removed, 1 where the
 * subject stays.
 */
export function edgeColorMask(
  bitmap: Bitmap,
  tolerance: number,
): Uint8ClampedArray {
  const { width, height, data } = bitmap;
  const count = width * height;
  const mask = new Uint8ClampedArray(count).fill(255);
  if (count === 0) return mask;

  const samples = borderSamples(bitmap, tolerance);
  const visited = new Uint8Array(count);
  // A plain array used as a stack; a scanline fill over a typed array is fast
  // enough at the working resolution that no worker is needed.
  const stack: number[] = [];

  const matchesBackdrop = (index: number): boolean => {
    const offset = index * 4;
    for (const sample of samples) {
      if (colorDistance(data, offset, sample) <= tolerance) return true;
    }
    return false;
  };

  const push = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    if (!matchesBackdrop(index)) return;
    mask[index] = 0;
    stack.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  return mask;
}

/**
 * Softens the cut so the subject does not end in a hard staircase. Coverage
 * ramps across `radius` pixels measured from the nearest removed pixel.
 */
export function featherMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  radius = FEATHER_RADIUS,
): Uint8ClampedArray {
  if (radius <= 0) return mask;
  const softened = new Uint8ClampedArray(mask);
  const window = radius * 2 + 1;
  const area = window * window;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) continue;
      let total = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          total += 255 * window;
          continue;
        }
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          total += nx < 0 || nx >= width ? 255 : mask[ny * width + nx];
        }
      }
      softened[index] = Math.round(total / area);
    }
  }
  return softened;
}

/**
 * Resamples a coverage mask to another size with bilinear sampling, so a mask
 * computed at the working resolution still has a smooth edge at full size.
 */
export function scaleMask(
  mask: Uint8ClampedArray,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): Uint8ClampedArray {
  if (fromWidth === toWidth && fromHeight === toHeight) {
    return new Uint8ClampedArray(mask);
  }
  if (toWidth <= 0 || toHeight <= 0) {
    throw new Error("scaleMask requires a positive target size");
  }
  const out = new Uint8ClampedArray(toWidth * toHeight);
  const stepX = fromWidth / toWidth;
  const stepY = fromHeight / toHeight;
  for (let y = 0; y < toHeight; y += 1) {
    const sy = Math.min(fromHeight - 1, (y + 0.5) * stepY - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(fromHeight - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < toWidth; x += 1) {
      const sx = Math.min(fromWidth - 1, (x + 0.5) * stepX - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(fromWidth - 1, x0 + 1);
      const fx = sx - x0;
      const top =
        mask[y0 * fromWidth + x0] * (1 - fx) + mask[y0 * fromWidth + x1] * fx;
      const bottom =
        mask[y1 * fromWidth + x0] * (1 - fx) + mask[y1 * fromWidth + x1] * fx;
      out[y * toWidth + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return out;
}

/** The size the mask is computed at, capped so a huge photo stays quick. */
export function workingSize(
  width: number,
  height: number,
  cap = CUTOUT_WORKING_SIDE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    throw new Error("workingSize requires a positive source size");
  }
  const longest = Math.max(width, height);
  if (longest <= cap) return { width, height };
  const scale = cap / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Writes a coverage mask into a bitmap's alpha channel, in place. */
export function applyMaskAlpha(
  bitmap: Bitmap,
  mask: Uint8ClampedArray,
): Bitmap {
  const { data, width, height } = bitmap;
  if (mask.length !== width * height) {
    throw new Error("The cutout mask does not match the image it came from");
  }
  for (let index = 0; index < mask.length; index += 1) {
    data[index * 4 + 3] = Math.round((data[index * 4 + 3] * mask[index]) / 255);
  }
  return bitmap;
}
