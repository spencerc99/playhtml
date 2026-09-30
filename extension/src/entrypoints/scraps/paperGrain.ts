// ABOUTME: The speckled grain the scraps page is printed on, as collage paper.
// ABOUTME: One recipe, so the studio, the history thumbnail and the bake agree.

/**
 * The same two turbulence passes the scraps page lays over its background: a
 * fine fractal noise, and a coarser grain stepped down to a few alpha levels.
 * They are written once here so what the studio shows is what the bake draws.
 */
const NOISE_FILTER = `
  <filter id="g-noise">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"/>
  </filter>
  <filter id="g-grain">
    <feTurbulence type="turbulence" baseFrequency="0.5" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer>
      <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4"/>
    </feComponentTransfer>
  </filter>`;

/** How strongly the grain sits over the paper, matching the page. */
const NOISE_OPACITY = 0.7;
const GRAIN_OPACITY = 0.3;

/**
 * The grain as a standalone SVG document of a given size. It multiplies onto
 * whatever is beneath, so the paper tone shows through it.
 */
export function grainSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${NOISE_FILTER}</defs>
  <rect width="100%" height="100%" filter="url(#g-noise)" opacity="${NOISE_OPACITY}"/>
  <rect width="100%" height="100%" filter="url(#g-grain)" opacity="${GRAIN_OPACITY * NOISE_OPACITY}"/>
</svg>`;
}

/** The grain as a data URL, for a CSS background or an image to draw. */
export function grainDataUrl(width: number, height: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    grainSvg(width, height),
  )}`;
}

/**
 * The CSS that paints a grained paper: the grain image multiplied over the
 * tone, which is exactly how the bake composes the two.
 */
export function paperBackground(
  color: string,
  grain: boolean,
  width: number,
  height: number,
): {
  background: string;
  backgroundBlendMode?: string;
  backgroundSize?: string;
} {
  if (!grain) return { background: color };
  return {
    background: `url("${grainDataUrl(width, height)}") ${color}`,
    backgroundBlendMode: "multiply",
    backgroundSize: "100% 100%",
  };
}

/**
 * Draws the grain over a canvas that already carries the paper tone. It is
 * multiplied on, the same composite the studio uses, so a baked corner matches
 * what was on screen.
 */
export async function drawGrain(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): Promise<void> {
  const image = new Image();
  image.src = grainDataUrl(Math.round(width), Math.round(height));
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("the paper grain would not draw"));
  });
  context.save();
  context.globalCompositeOperation = "multiply";
  context.drawImage(image, 0, 0, width, height);
  context.restore();
}
