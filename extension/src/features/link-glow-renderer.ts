// ABOUTME: Generates CSS for the nebula glow effect applied to Wikipedia links.
// ABOUTME: Port of the SmearLink rendering logic from components-preview.tsx for vanilla DOM.

export interface GlowStyle {
  // Background layers for inline path (radial gradients on top, base fill last)
  bgLayers: string[];
  // Radial gradient blob layers only (for pseudo-element path)
  blobLayers: string[];
  // Base fill color for drop-shadow and ::before background
  baseFill: string;
  blur: number;
  vSpread: number;
  hInsetPct: number;
}

function parseToRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ];
  }
  const hslMatch = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  return [128, 128, 128];
}

function colorToRgba(color: string, alpha: number): string {
  const [r, g, b] = parseToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

function averageColors(colors: string[]): [number, number, number] {
  let rSum = 0, gSum = 0, bSum = 0;
  for (const c of colors) {
    const [r, g, b] = parseToRgb(c);
    rSum += r;
    gSum += g;
    bSum += b;
  }
  const n = colors.length;
  return [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)];
}

function pairColors(colors: string[]): [string, string][] {
  if (colors.length <= 2) {
    return [
      colors.length === 1
        ? [colors[0], colors[0]]
        : [colors[0], colors[1]],
    ];
  }
  const pairs: [string, string][] = [];
  for (let i = 0; i < colors.length - 1; i += 2) {
    pairs.push([colors[i], colors[i + 1]]);
  }
  if (colors.length % 2 === 1) {
    pairs.push([colors[colors.length - 2], colors[colors.length - 1]]);
  }
  return pairs;
}

function smearNebulaLayers(
  colors: string[],
  baseOpacity: number,
  blobOpacity: number,
  t: number,
): string[] {
  if (colors.length === 0) return ["transparent"];
  const [ar, ag, ab] = averageColors(colors);
  const baseFill = `rgba(${ar}, ${ag}, ${ab}, ${baseOpacity.toFixed(2)})`;
  if (colors.length === 1) return [baseFill];

  const pairs = pairColors(colors);
  const layers: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [c1, c2] = pairs[i];
    const xPct =
      pairs.length === 1 ? 50 : 15 + (i / (pairs.length - 1)) * 70;
    const yPct = 45 + (i % 2 === 0 ? -8 : 8);
    const rPct = Math.max(15, 20 + t * 18 - pairs.length * 3);
    const inner = colorToRgba(c1, blobOpacity);
    const mid = colorToRgba(c2, blobOpacity * 0.5);
    layers.push(
      `radial-gradient(ellipse ${rPct}% 70% at ${xPct.toFixed(0)}% ${yPct}%, ${inner} 0%, ${mid} 50%, transparent 100%)`,
    );
  }
  return [baseFill, ...layers];
}

// Controls how flat the curve is at low counts.
// Lower k = more clicks needed before glow becomes visible.
const INTENSITY_K = 0.1;
// Controls how many absolute clicks before the effect reaches full strength.
const ABSOLUTE_RATE = 50;
// Opacity reduction for inline rendering (no blur available)
const INLINE_OPACITY_MUL = 0.4;

export function computeIntensity(count: number, maxCount: number): number {
  if (count <= 0 || maxCount <= 0) return 0;
  const denom = Math.log(1 + maxCount * INTENSITY_K);
  if (denom === 0) return 0;
  const relative = Math.min(1, Math.log(1 + count * INTENSITY_K) / denom);
  const absolute = 1 - Math.exp(-count / ABSOLUTE_RATE);
  return absolute * (0.3 + 0.7 * relative);
}

// Apply glow styles to a link element. For single-line links, adds a CSS class
// (pseudo-element rules must be injected separately via buildGlowCssRules).
// For multi-line links, applies inline backgrounds + drop-shadow.
export function applyGlowToLink(
  link: HTMLAnchorElement,
  style: GlowStyle,
  wraps: boolean,
  className?: string,
): void {
  const hPad = Math.round(1 + style.vSpread * 0.7);

  if (wraps) {
    Object.assign(link.style, {
      background: style.bgLayers.length > 0 ? style.bgLayers.join(", ") : undefined,
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
      filter: [
        `drop-shadow(0 0 ${style.blur.toFixed(1)}px ${style.baseFill})`,
        `drop-shadow(0 0 ${(style.blur * 0.5).toFixed(1)}px ${style.baseFill})`,
      ].join(" "),
      padding: `0.5px ${hPad}px`,
      margin: `-0.5px ${-hPad}px`,
      borderRadius: "2px",
    });
  } else {
    if (className) link.classList.add(className);
    Object.assign(link.style, {
      position: "relative",
      zIndex: "1",
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    });
  }
}

// Generate CSS rules for pseudo-element blur on a single-line link.
export function buildGlowCssRules(className: string, style: GlowStyle): string[] {
  const rules: string[] = [];
  const { hInsetPct: hInset, vSpread, baseFill, blur, blobLayers } = style;

  rules.push(`
    .${className}::before {
      content: "";
      position: absolute;
      left: ${hInset}%;
      right: ${hInset}%;
      top: ${-vSpread}px;
      bottom: ${-vSpread}px;
      background: ${baseFill};
      filter: blur(${blur.toFixed(1)}px);
      border-radius: 2px;
      pointer-events: none;
      z-index: 0;
    }
  `);

  if (blobLayers.length > 0) {
    rules.push(`
      .${className}::after {
        content: "";
        position: absolute;
        left: ${hInset}%;
        right: ${hInset}%;
        top: ${-vSpread}px;
        bottom: ${-vSpread}px;
        background: ${blobLayers.join(", ")};
        filter: blur(${(blur * 0.7).toFixed(1)}px);
        border-radius: 2px;
        pointer-events: none;
        z-index: 0;
      }
    `);
  }

  return rules;
}

export function computeGlowStyle(
  colors: string[],
  count: number,
  pageMax: number,
): GlowStyle | null {
  if (colors.length === 0 || count === 0) return null;

  const t = computeIntensity(count, pageMax);
  if (t < 0.01) return null;
  const blur = 1.5 + t * 4;
  const baseOpacity = 0.15 + t * 0.2;
  const blobOpacity = 0.2 + t * 0.3;
  const vSpread = t * 1.5;
  const hInsetPct = Math.round((1 - t) * 15);

  // Full-opacity layers for pseudo-element blur path
  const layers = smearNebulaLayers(colors, baseOpacity, blobOpacity, t);
  const baseFill = layers[0];
  const blobLayers = layers.slice(1);

  // Reduced-opacity layers for inline background path (no blur available)
  const inlineLayers = smearNebulaLayers(colors, baseOpacity * INLINE_OPACITY_MUL, blobOpacity * INLINE_OPACITY_MUL, t);
  const filtered = inlineLayers.filter((l) => l !== "transparent");
  const bgLayers = [...filtered.slice(1), filtered[0]].filter(Boolean);

  return {
    bgLayers,
    blobLayers,
    baseFill,
    blur,
    vSpread,
    hInsetPct,
  };
}
