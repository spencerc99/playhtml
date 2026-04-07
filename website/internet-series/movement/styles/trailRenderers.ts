// ABOUTME: Trail visual style renderers -- encapsulate all per-frame styling logic.
// ABOUTME: Each renderer is a plain object with init and update methods called by the animation loop.

export interface TrailStyleParams {
  pathEl: SVGPathElement;
  pathData: string;
  trailOpacity: number;
  strokeWidth: number;
  cursorType?: string;
  trailProgress: number;
  trailColor: string;
  fixedMonoStrokeWidth: number;
}

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
      return { fill: "#000", stroke: "none", strokeWidth: 0, opacity: 0.9 };
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
  updatePath({ pathEl, pathData, trailOpacity, strokeWidth, trailColor }) {
    pathEl.setAttribute("d", pathData);
    pathEl.setAttribute("stroke", trailColor);
    pathEl.setAttribute("opacity", String(trailOpacity));
    pathEl.setAttribute("stroke-width", String(strokeWidth));
    pathEl.removeAttribute("filter");
    pathEl.style.display = "";
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
  updatePath({ pathEl, pathData, trailOpacity, fixedMonoStrokeWidth, cursorType }) {
    pathEl.setAttribute("d", pathData);
    const style = getMonochromeStyle(cursorType);
    pathEl.setAttribute("stroke", style.fill !== "none" ? style.fill : style.stroke);
    pathEl.setAttribute("opacity", String(style.opacity * trailOpacity));
    pathEl.setAttribute("stroke-width", String(fixedMonoStrokeWidth));
    pathEl.setAttribute("filter", "url(#ink-texture)");
    pathEl.style.display = "";
  },
  getCursorColor(_trailColor, cursorType) {
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
