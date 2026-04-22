// ABOUTME: Trail visual style renderers -- encapsulate all per-frame styling logic.
// ABOUTME: Each renderer is a plain object with init and update methods called by the animation loop.

export interface TrailStyleParams {
  pathEl: SVGPathElement;
  haloEl?: SVGPathElement | null;
  pathData: string;
  trailOpacity: number;
  strokeWidth: number;
  cursorType?: string;
  trailProgress: number;
  trailColor: string;
  fixedMonoStrokeWidth: number;
}

function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  if (s === "white") return [1, 1, 1];
  if (s === "black") return [0, 0, 0];

  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length !== 6) return null;
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }

  const hslMatch = s.match(
    /^hsla?\(\s*([\d.]+)(?:deg)?\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%/,
  );
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const sat = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    if (sat === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const hueToRgb = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hueToRgb(h + 1 / 3), hueToRgb(h), hueToRgb(h - 1 / 3)];
  }

  const rgbMatch = s.match(
    /^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)/,
  );
  if (rgbMatch) {
    return [
      parseFloat(rgbMatch[1]) / 255,
      parseFloat(rgbMatch[2]) / 255,
      parseFloat(rgbMatch[3]) / 255,
    ];
  }

  return null;
}

// --bg warm linen. Trails close to this color in RGB space disappear.
const BG_RGB: [number, number, number] = [0xfa / 255, 0xf7 / 255, 0xf2 / 255];

// Weighted RGB distance from the background color. Approximates perceptual
// difference without full Lab conversion. Returns 0 (identical) to ~1+ (far).
function getDistanceFromBg(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 1;
  const dr = rgb[0] - BG_RGB[0];
  const dg = rgb[1] - BG_RGB[1];
  const db = rgb[2] - BG_RGB[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}

// Returns a gently-darkened, hue-preserving plate color. Plate lightness
// scales smoothly with distance from bg: the closer to bg, the darker the
// plate. Saturation is kept close to the user's choice so the plate reads
// as "a slightly deeper version of their color" rather than a separate mark.
function getPlateColor(color: string, distance: number): string | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  // Pure white and near-pure-white trails show up on their own via their
  // cursor icon and don't need a plate regardless of distance.
  if (l > 0.98) return null;
  const t = Math.min(1, distance / PLATE_DISTANCE_THRESHOLD);
  const plateLightness = 0.6 + t * (l - 0.6);
  const plateSaturation = s;
  return `hsl(${(h * 360).toFixed(1)}, ${(plateSaturation * 100).toFixed(1)}%, ${(plateLightness * 100).toFixed(1)}%)`;
}

// Trails within this bg-distance get a plate underneath. Tuned so pale
// pastels (pale blue ~0.125, pale peach ~0.10) trigger, while saturated
// colors and the lilac/teal/gold range do not.
const PLATE_DISTANCE_THRESHOLD = 0.16;
const PLATE_STROKE_MULTIPLIER = 1.3;
const PLATE_OPACITY_FACTOR = 0.35;

export interface TrailRenderer {
  readonly id: string;
  readonly name: string;
  // SVG defs needed by this renderer (filters, gradients, etc.)
  readonly svgDefs?: string;
  // Called per-frame to apply style to the trail path
  updatePath(params: TrailStyleParams): void;
  // Returns the color for the cursor icon
  getCursorColor(trailColor: string, cursorType?: string): string;
  // Returns the color for click/hold ripples
  getClickColor(trailColor: string): string;
}

// Cursor-type-to-monochrome-style mapping for black & white rendering mode
interface MonochromeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

function getMonochromeStyle(cursorType: string | undefined): MonochromeStyle {
  switch (cursorType) {
    case "pointer":
      return { fill: "#fff", stroke: "#000", strokeWidth: 1, opacity: 0.7 };
    case "text":
      return { fill: "none", stroke: "#000", strokeWidth: 1.5, opacity: 0.5 };
    case "grab":
    case "grabbing":
    case "move":
      return { fill: "#fff", stroke: "#000", strokeWidth: 1, opacity: 0.9 };
    case "wait":
    case "progress":
      return { fill: "#888", stroke: "none", strokeWidth: 0, opacity: 0.4 };
    case "crosshair":
      return { fill: "none", stroke: "#000", strokeWidth: 1, opacity: 0.6 };
    default:
      return { fill: "#000", stroke: "none", strokeWidth: 0, opacity: 0.8 };
  }
}

export const colorRenderer: TrailRenderer = {
  id: "color",
  name: "Color",
  updatePath({ pathEl, haloEl, pathData, trailOpacity, strokeWidth, trailColor }) {
    pathEl.setAttribute("d", pathData);
    pathEl.setAttribute("stroke", trailColor);
    pathEl.setAttribute("opacity", String(trailOpacity));
    pathEl.setAttribute("stroke-width", String(strokeWidth));
    pathEl.removeAttribute("filter");
    pathEl.style.display = "";

    if (haloEl) {
      const distance = getDistanceFromBg(trailColor);
      const plateColor =
        distance < PLATE_DISTANCE_THRESHOLD
          ? getPlateColor(trailColor, distance)
          : null;
      if (plateColor) {
        haloEl.setAttribute("d", pathData);
        haloEl.setAttribute("stroke", plateColor);
        haloEl.setAttribute(
          "opacity",
          String(trailOpacity * PLATE_OPACITY_FACTOR),
        );
        haloEl.setAttribute(
          "stroke-width",
          String(strokeWidth * PLATE_STROKE_MULTIPLIER),
        );
        haloEl.style.display = "";
      } else {
        haloEl.style.display = "none";
      }
    }
  },
  getCursorColor(trailColor) {
    return trailColor;
  },
  getClickColor(trailColor) {
    return trailColor;
  },
};

export const monochromeRenderer: TrailRenderer = {
  id: "monochrome",
  name: "Monochrome Ink",
  svgDefs: `<filter id="ink-texture" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" xChannelSelector="R" yChannelSelector="G" />
  </filter>`,
  updatePath({ pathEl, haloEl, pathData, trailOpacity, fixedMonoStrokeWidth }) {
    pathEl.setAttribute("d", pathData);
    pathEl.setAttribute("stroke", "#000");
    pathEl.setAttribute("opacity", String(0.8 * trailOpacity));
    pathEl.setAttribute("stroke-width", String(fixedMonoStrokeWidth));
    pathEl.setAttribute("filter", "url(#ink-texture)");
    pathEl.style.display = "";
    if (haloEl) haloEl.style.display = "none";
  },
  getCursorColor(_trailColor, cursorType) {
    // Cursor icon matches the cursor type — pointer is white, default is black
    const style = getMonochromeStyle(cursorType);
    return style.fill !== "none" ? style.fill : style.stroke;
  },
  getClickColor() {
    return "#000";
  },
};

export const TRAIL_RENDERERS: TrailRenderer[] = [
  colorRenderer,
  monochromeRenderer,
];

export function getTrailRenderer(id: string): TrailRenderer {
  return TRAIL_RENDERERS.find((r) => r.id === id) ?? colorRenderer;
}
