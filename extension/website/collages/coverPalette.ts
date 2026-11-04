// ABOUTME: Picks the few loud colours a collage is made of from its cover's pixels.
// ABOUTME: The gallery tints each collage's detail card with them, so the card echoes its collage.

/** How finely colours are grouped: 4 bits per channel, so near shades count as one. */
const STEP = 16;
/**
 * Paper, white space, greys and near-black say little about a collage. A
 * colour needs this much chroma (the spread between its strongest and weakest
 * channel, 0 to 1) to count; chroma, unlike HSL saturation, stays low for
 * pale paper.
 */
const MIN_CHROMA = 0.2;

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function chroma(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/**
 * The collage's most present vivid colours, strongest first, from RGBA pixels.
 * A colour counts by how much of the cover it fills, and louder colours count
 * for more than muted ones (by the square of their chroma); colours
 * too close to one already picked are passed over.
 */
export function vividColors(pixels: Uint8ClampedArray, count = 3): string[] {
  const buckets = new Map<
    number,
    { r: number; g: number; b: number; n: number; weight: number }
  >();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const vividness = chroma(r, g, b);
    if (vividness < MIN_CHROMA) continue;
    const key =
      (Math.floor(r / STEP) << 8) |
      (Math.floor(g / STEP) << 4) |
      Math.floor(b / STEP);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, weight: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    bucket.weight += vividness * vividness;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()]
    .map((bucket) => ({
      r: Math.round(bucket.r / bucket.n),
      g: Math.round(bucket.g / bucket.n),
      b: Math.round(bucket.b / bucket.n),
      weight: bucket.weight,
    }))
    .sort((a, b) => b.weight - a.weight);
  const picked: typeof ranked = [];
  for (const color of ranked) {
    const distinct = picked.every(
      (other) =>
        Math.abs(other.r - color.r) +
          Math.abs(other.g - color.g) +
          Math.abs(other.b - color.b) >
        90,
    );
    if (distinct) picked.push(color);
    if (picked.length === count) break;
  }
  return picked.map(({ r, g, b }) => hex(r, g, b));
}

/** The vivid colours of a loaded cover picture, read from a small copy of it. */
export function coverColors(image: HTMLImageElement): string[] {
  const side = 48;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, side, side);
  try {
    return vividColors(context.getImageData(0, 0, side, side).data);
  } catch {
    // A cover served without CORS taints the canvas; the card keeps its plain paper.
    return [];
  }
}
