// ABOUTME: Segment style presets for bottle letters — each letter styles its own
// ABOUTME: scroll segment (ground, ink, perforation) from this fixed set.

/** Paints the sealing ceremony's paper texture for a style. Defined alongside
 * each style so a new style (or a future user-made one) supplies its own
 * painter instead of the ceremony hardcoding a look. */
export interface CeremonyPaper {
  /** Ink the message text is drawn in on the ceremony texture. */
  ink: string;
  /** Paints the paper ground (background, borders, decorations) onto the
   * ceremony texture canvas. Text and seal marks are drawn on top. May return
   * a Promise when the ground needs an async asset (e.g. a border image to
   * 9-slice); callers repaint the texture when it resolves. */
  paintGround(ctx: CanvasRenderingContext2D, w: number, h: number): void | Promise<void>;
}

// The seg-web1 broider border, the exact PNG used as the on-sheet border-image
// (see .seg-web1 in MessageBottle.scss). Shared so the ceremony can 9-slice the
// same art onto its canvas and match the on-page sheet.
export const WEB1_BROIDER_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAVCAYAAACpF6WWAAABJ0lEQVR4AaTRQU7DQBBEUfCKI3AS7r/mJByBHeiN8q125CycIH26urqmPY63r8+PP7zd/mhoZ6WjmZ4GHRsDGd8/v+/ghX4iqzen1Xp6LWWEEAxBT3iyPFVPq+Bt/mkMQOel9dDLgEY+HeumhQTQkDaL/LMqU359KCGGeg//jJkzn/26KdOTrjCX0HZU129qWWaDKv8M83B+sl7foQJXq2WdV7Fe3yJD9VXs2Zda5inqqxyWPrvM7ebZ9aGm8ayeb7k+VE9S5/DqAzq/bmpRzEVCj5AzU0Hboa6bZqoToStY6PzhQ2UaQH+G2T1yPJdYr8/QMB9hHvLlaOjN1cNNGQVoIdD80EOvyoDm7b8pYw5ogXx98FAvF/z9pkyGoKqn1YlZ5Msh/x8AAP//9W84CwAAAAZJREFUAwA7SYrgj2UwOAAAAABJRU5ErkJggg==";

// Loads an image from a data URI once, caching the decoded element so repeated
// ceremonies don't re-decode. Resolves null if decoding fails.
const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(uri: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(uri);
  if (cached) return cached;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = uri;
  });
  imageCache.set(uri, p);
  return p;
}

// 9-slice a border image around the canvas perimeter: corners drawn at native
// slice size × scale, edges stretched between them. `slice` is the source inset
// (px) that separates corner from edge, matching the CSS border-image slice.
function drawBorderImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  slice: number,
  scale: number,
): void {
  const iw = img.width;
  const ih = img.height;
  const d = slice * scale; // destination corner/edge thickness
  const midSrcW = Math.max(iw - slice * 2, 1);
  const midSrcH = Math.max(ih - slice * 2, 1);
  ctx.imageSmoothingEnabled = false;

  // corners
  ctx.drawImage(img, 0, 0, slice, slice, 0, 0, d, d);
  ctx.drawImage(img, iw - slice, 0, slice, slice, w - d, 0, d, d);
  ctx.drawImage(img, 0, ih - slice, slice, slice, 0, h - d, d, d);
  ctx.drawImage(img, iw - slice, ih - slice, slice, slice, w - d, h - d, d, d);
  // edges (stretched)
  ctx.drawImage(img, slice, 0, midSrcW, slice, d, 0, w - d * 2, d);
  ctx.drawImage(img, slice, ih - slice, midSrcW, slice, d, h - d, w - d * 2, d);
  ctx.drawImage(img, 0, slice, slice, midSrcH, 0, d, d, h - d * 2);
  ctx.drawImage(img, iw - slice, slice, slice, midSrcH, w - d, d, d, h - d * 2);

  ctx.imageSmoothingEnabled = true;
}

export interface SegmentStyle {
  /** Persisted in BottleNote.styleId. Never rename existing ids. */
  id: string;
  /** Shown in the swatch row tooltip. */
  label: string;
  /** Class applied to the segment root; styles live in MessageBottle.scss. */
  className: string;
  /** Ink color for letter text, signature, and tick-rail accents. */
  ink: string;
  /** Painter for the sealing ceremony's Three.js paper texture. */
  ceremony: CeremonyPaper;
}

// Warm linen ground + speckle grain + a soft grey border — the ceremony
// texture's original look, now the linen style's painter.
function paintLinenGround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#faf7f2";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.012)";
  for (let i = 0; i < 800; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  ctx.strokeStyle = "#767676";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(6, 6, w - 12, 6);
}

// White ground wearing the REAL broider border — the same PNG the on-page
// seg-web1 sheet uses as its border-image, 9-sliced around the canvas so the
// ceremony matches the sheet. The border loads async; the ground paints white
// immediately and the caller repaints once the image resolves.
async function paintWeb1Ground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): Promise<void> {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const img = await loadImage(WEB1_BROIDER_URI);
  if (!img) return;
  // The border-image slice is 7px (see the SCSS `7 / 7px` border-image). Scale
  // it up for the 1024×1280 ceremony canvas so the border reads at roll size.
  drawBorderImage(ctx, img, w, h, 7, 3.5);
}

// Warm paper ground + fibre flecks + a soft vignette + the faint rust left
// margin rule — matching seg-stationery's on-sheet look (base #f5efe4, margin
// rule ~54px from the left at rgba(196,114,78,0.28), gentle centre vignette).
function paintStationeryGround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#f5efe4";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(90,70,50,0.03)";
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  // Gentle vignette, echoing the CSS radial at 50% 42%.
  const vg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, w * 0.72);
  vg.addColorStop(0.58, "rgba(120,96,66,0)");
  vg.addColorStop(1, "rgba(120,96,66,0.14)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // Rust left margin rule. The sheet's rule sits ~54px into a ~560px sheet, so
  // scale that fraction onto the canvas width (thin, ~0.28 alpha like the CSS).
  const marginX = w * (54 / 560);
  ctx.strokeStyle = "rgba(196,114,78,0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(marginX, 24);
  ctx.lineTo(marginX, h - 24);
  ctx.stroke();
}

// The seg-webnative collage on canvas: same off-white ground, the same five
// gradient splotches (positions/palette from the CSS radial-gradients), the
// same bright bars/square, and the two ascii ornaments the CSS ::before/::after
// place. Ellipse radii and hard bar sizes are scaled up ~1.8× from the sheet's
// px to read at the ceremony canvas's larger size.
function paintWebnativeGround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#fdfdfb";
  ctx.fillRect(0, 0, w, h);

  const S = 1.8; // sheet-px → canvas-px scale for shapes
  // [fx, fy, radiusX(px), radiusY(px), color] — mirrors the CSS radial ellipses.
  const splotches: [number, number, number, number, string][] = [
    [0.1, 0.06, 130, 90, "rgba(255,94,196,0.28)"],
    [0.94, 0.24, 90, 140, "rgba(34,204,255,0.3)"],
    [0.2, 0.92, 150, 90, "rgba(255,212,0,0.34)"],
    [0.76, 0.74, 80, 80, "rgba(0,236,120,0.2)"],
    [0.55, 0.03, 60, 46, "rgba(151,71,255,0.24)"],
  ];
  for (const [fx, fy, rx, ry, color] of splotches) {
    const cx = fx * w;
    const cy = fy * h;
    const rX = rx * S;
    const rY = ry * S;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, rY / rX);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rX);
    grad.addColorStop(0, color);
    // CSS radial-gradients fade to transparent around 66–72%.
    grad.addColorStop(0.7, color.replace(/[\d.]+\)$/, "0)"));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(-rX, -rX, rX * 2, rX * 2);
    ctx.restore();
  }

  // Bright bars/square, positioned + sized like the CSS hard-stop layers.
  ctx.fillStyle = "#ff5ec4";
  ctx.fillRect(w * 0.82, h * 0.1, 88 * S, 5 * S);
  ctx.fillStyle = "#22ccff";
  ctx.fillRect(w * 0.06, h * 0.6, 4 * S, 64 * S);
  // yellow→orange 45deg square
  {
    const sq = 26 * S;
    const x = w * 0.58;
    const y = h * 0.96;
    const g = ctx.createLinearGradient(x, y, x + sq, y + sq);
    g.addColorStop(0, "#ffd400");
    g.addColorStop(1, "#ff8a00");
    ctx.fillStyle = g;
    ctx.fillRect(x, y - sq, sq, sq);
  }
  ctx.fillStyle = "#9747ff";
  ctx.fillRect(w * 0.12, h * 0.3, 52 * S, 4 * S);

  // Ascii ornaments — teal top-right, pink bottom-left, matching the CSS.
  ctx.textBaseline = "top";
  ctx.font = `24px ui-monospace, "SFMono-Regular", Menlo, monospace`;
  ctx.fillStyle = "rgba(74,154,138,0.75)";
  const topText = "*~ · :-) · ~*";
  ctx.fillText(topText, w - 30 - ctx.measureText(topText).width, 22);
  ctx.fillStyle = "rgba(232,62,140,0.6)";
  ctx.fillText("~ <3 ~", 36, h - 52);
}

/** Warm linen — the default preset, and the fallback for unknown/missing ids. */
export const LINEN: SegmentStyle = {
  id: "linen",
  label: "linen",
  className: "seg-linen",
  ink: "#3d3833",
  ceremony: { ink: "#3d3833", paintGround: paintLinenGround },
};

/** The pickable presets, deliberately spanning physical → digital. */
export const SEGMENT_STYLES: SegmentStyle[] = [
  LINEN,
  {
    id: "web1",
    label: "bordered",
    className: "seg-web1",
    ink: "#1a1a8c",
    ceremony: { ink: "#1a1a8c", paintGround: paintWeb1Ground },
  },
  {
    id: "stationery",
    label: "stationery",
    className: "seg-stationery",
    ink: "#3d3833",
    ceremony: { ink: "#3d3833", paintGround: paintStationeryGround },
  },
  {
    id: "webnative",
    label: "gradient",
    className: "seg-webnative",
    ink: "#1f2937",
    ceremony: { ink: "#223142", paintGround: paintWebnativeGround },
  },
];

export function segmentStyle(id?: string): SegmentStyle {
  return SEGMENT_STYLES.find((s) => s.id === id) ?? LINEN;
}
