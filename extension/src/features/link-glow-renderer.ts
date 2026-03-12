// ABOUTME: Generates CSS for the nebula glow effect applied to Wikipedia links.
// ABOUTME: Port of the SmearLink rendering logic from components-preview.tsx for vanilla DOM.

export interface GlowStyle {
  baseFill: string;
  baseFilter: string;
  blobLayers: string[];
  blobFilter: string;
  vSpread: number;
  hInsetPct: number;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

function averageHex(colors: string[]): string {
  let rSum = 0,
    gSum = 0,
    bSum = 0;
  for (const hex of colors) {
    rSum += parseInt(hex.slice(1, 3), 16);
    gSum += parseInt(hex.slice(3, 5), 16);
    bSum += parseInt(hex.slice(5, 7), 16);
  }
  const n = colors.length;
  const r = Math.round(rSum / n)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(gSum / n)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(bSum / n)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
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
  const avg = averageHex(colors);
  const baseFill = hexToRgba(avg, baseOpacity);
  if (colors.length === 1) return [baseFill];

  const pairs = pairColors(colors);
  const layers: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [c1, c2] = pairs[i];
    const xPct =
      pairs.length === 1 ? 50 : 15 + (i / (pairs.length - 1)) * 70;
    const yPct = 45 + (i % 2 === 0 ? -8 : 8);
    const rPct = Math.max(15, 20 + t * 18 - pairs.length * 3);
    const inner = hexToRgba(c1, blobOpacity);
    const mid = hexToRgba(c2, blobOpacity * 0.5);
    layers.push(
      `radial-gradient(ellipse ${rPct}% 70% at ${xPct.toFixed(0)}% ${yPct}%, ${inner} 0%, ${mid} 50%, transparent 100%)`,
    );
  }
  return [baseFill, ...layers];
}

export function computeGlowStyle(
  colors: string[],
  count: number,
  pageMax: number,
): GlowStyle | null {
  if (colors.length === 0 || count === 0) return null;

  const t = Math.min(1, count / Math.max(pageMax, 1));
  const blur = 1.5 + t * 4;
  const baseOpacity = 0.15 + t * 0.2;
  const blobOpacity = 0.2 + t * 0.3;
  const vSpread = t * 3;
  const hInsetPct = Math.round((1 - t) * 15);

  const layers = smearNebulaLayers(colors, baseOpacity, blobOpacity, t);
  const baseFill = layers[0];
  const blobLayers = layers.slice(1);

  return {
    baseFill,
    baseFilter: `blur(${blur.toFixed(1)}px)`,
    blobLayers,
    blobFilter: `blur(${(blur * 0.7).toFixed(1)}px)`,
    vSpread,
    hInsetPct,
  };
}
