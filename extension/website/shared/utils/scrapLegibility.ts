// ABOUTME: Decides when a scrap's light lettering or icon ink would vanish on the collage paper.
// ABOUTME: Picks a dark backing in the ink's own hue so the piece reads without its page behind it.

type Rgb = [number, number, number];

/** The collage paper that scraps are judged against. */
const PAPER: Rgb = [250, 247, 242];
/** Below this contrast against the paper, ink needs a backing to read. */
const MIN_CONTRAST = 2.5;
/** Near-grey ink gets the warm charcoal the rest of the page uses. */
const NEUTRAL_BACKING = "#2a2622";
const NEUTRAL_SATURATION = 0.12;

function parseRgb(color: string): { rgb: Rgb; alpha: number } | null {
  const value = color.trim().toLowerCase();
  if (value === "white") return { rgb: [255, 255, 255], alpha: 1 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits =
      hex[1]!.length === 3
        ? hex[1]!.split("").map((digit) => digit + digit)
        : hex[1]!.match(/../g)!;
    return { rgb: digits.map((pair) => parseInt(pair, 16)) as Rgb, alpha: 1 };
  }
  const functional = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!functional) return null;
  const parts = functional[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) =>
      part.endsWith("%") ? Number.parseFloat(part) / 100 : Number(part),
    );
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return { rgb: [parts[0]!, parts[1]!, parts[2]!], alpha: parts[3] ?? 1 };
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function hslOf([r, g, b]: Rgb): { hue: number; saturation: number } {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation };
}

/**
 * Whether ink in this color disappears on the collage paper. A color this
 * reader cannot parse, or one mostly see-through, is left as the page drew it.
 */
export function inkNeedsBacking(color: string | undefined): boolean {
  if (!color) return false;
  const parsed = parseRgb(color);
  if (!parsed || parsed.alpha < 0.5) return false;
  return contrastRatio(parsed.rgb, PAPER) < MIN_CONTRAST;
}

/** A deep shade of the ink's own hue for it to sit on. */
export function backingFor(color: string): string {
  const parsed = parseRgb(color);
  if (!parsed) return NEUTRAL_BACKING;
  const { hue, saturation } = hslOf(parsed.rgb);
  if (saturation < NEUTRAL_SATURATION) return NEUTRAL_BACKING;
  return `hsl(${Math.round(hue)} ${Math.round(Math.min(saturation, 0.45) * 100)}% 15%)`;
}

/** Whether a solid, opaque fill of its own already carries the lettering. */
export function hasOwnFill(background: string | undefined): boolean {
  if (!background) return false;
  const parsed = parseRgb(background);
  return parsed !== null && parsed.alpha >= 0.95;
}

const SVG_PAINT_PATTERN =
  /(?:\b(?:fill|stroke)\s*=\s*["']([^"']+)["'])|(?:\b(?:fill|stroke)\s*:\s*([^;"'}]+))/gi;
const UNPAINTED = /^(?:none|transparent|currentcolor|inherit|url\()/i;

/**
 * The light ink an icon is drawn in, when every color it paints with is too
 * light for the paper. Unpainted shapes fall back to black, which reads fine,
 * so an icon naming no paint at all needs no backing.
 */
export function lightIconInk(markup: string): string | null {
  const paints: string[] = [];
  for (const match of markup.matchAll(SVG_PAINT_PATTERN)) {
    const paint = (match[1] ?? match[2] ?? "").trim();
    if (!paint || UNPAINTED.test(paint)) continue;
    paints.push(paint);
  }
  if (paints.length === 0) return null;
  return paints.every(inkNeedsBacking) ? paints[0]! : null;
}
