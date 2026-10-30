// ABOUTME: Color conversion utilities shared across extension UI components
// ABOUTME: Provides HSL to hex conversion for cursor color pickers

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = Math.min(
      1,
      Math.max(0, l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)),
    );
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * A cursor colour as a lowercase hex string, from the hex or `hsl()` forms
 * identities are stored in; null for anything else.
 */
export function cssColorToHex(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) {
    return `#${[...text.slice(1)].map((digit) => digit + digit).join("")}`;
  }
  const hsl = text.match(
    /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/,
  );
  if (!hsl) return null;
  const hue = ((Number(hsl[1]) % 360) + 360) % 360;
  const saturation = Math.min(100, Number(hsl[2]));
  const lightness = Math.min(100, Number(hsl[3]));
  return hslToHex(hue, saturation, lightness);
}
