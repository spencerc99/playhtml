// ABOUTME: Detects the host page's apparent theme and provides injected UI color tokens.
// ABOUTME: Keeps Shadow DOM surfaces visually aligned with the page beneath them.

export type InjectedUiTheme = "light" | "dark";

type ThemeTokens = Readonly<Record<`--${string}`, string>>;

// Keep the shared values in sync with extension/src/styles/_variables.scss.
export const LIGHT_INJECTED_UI_TOKENS: ThemeTokens = {
  "--bg": "#faf7f2",
  "--surface": "#f5f0e8",
  "--surface-hover": "#efe9df",
  "--text": "#3d3833",
  "--text-muted": "#8a8279",
  "--text-faint": "#b5aea5",
  "--border": "rgba(90, 78, 65, 0.12)",
  "--border-strong": "rgba(90, 78, 65, 0.25)",
  "--shadow": "rgba(90, 78, 65, 0.08)",
  "--shadow-strong": "rgba(90, 78, 65, 0.16)",
  "--accent-teal": "#4a9a8a",
  "--accent-rust": "#c4724e",
  "--accent-blue": "#5b8db8",
  "--accent-gold": "#d4b85c",
  "--accent-plum": "#8b6b7f",
  "--active-bg": "rgba(74, 154, 138, 0.08)",
  "--active-border": "rgba(74, 154, 138, 0.25)",
  "--shared-bg": "rgba(91, 141, 184, 0.08)",
  "--error-bg": "rgba(196, 114, 78, 0.08)",
  "--error-text": "#9a5a3a",
  "--gold-bg": "rgba(212, 184, 92, 0.12)",
  "--gold-text": "#7a6020",
  "--btn-fg": "#ffffff",
  "--gold-btn-fg": "#3d3833",
  "--canvas-paper": "#faf9f6",
  "--leather-start": "#fbf2df",
  "--leather-end": "#f0e2c6",
  "--leather-border": "#b98a4e",
  "--leather-rim": "#e8cd97",
  "--leather-text": "#7a5a2e",
  "--leather-muted": "#a98d5c",
  "--leather-slot-start": "#fffaf0",
  "--leather-slot-end": "#f2e6cf",
  "--leather-empty-start": "#efe5d0",
  "--leather-empty-end": "#e6d8bd",
  "--leather-mark": "rgba(120, 85, 40, 0.1)",
};

export const DARK_INJECTED_UI_TOKENS: ThemeTokens = {
  "--bg": "#1f1b17",
  "--surface": "#292420",
  "--surface-hover": "#332d27",
  "--text": "#ece5da",
  "--text-muted": "#a1978a",
  "--text-faint": "#6f655b",
  "--border": "rgba(236, 229, 218, 0.14)",
  "--border-strong": "rgba(236, 229, 218, 0.28)",
  "--shadow": "rgba(0, 0, 0, 0.3)",
  "--shadow-strong": "rgba(0, 0, 0, 0.5)",
  "--accent-teal": "#63b3a1",
  "--accent-rust": "#d68a66",
  "--accent-blue": "#7fa9cf",
  "--accent-gold": "#d9c274",
  "--accent-plum": "#a98a9d",
  "--active-bg": "rgba(99, 179, 161, 0.14)",
  "--active-border": "rgba(99, 179, 161, 0.35)",
  "--shared-bg": "rgba(127, 169, 207, 0.14)",
  "--error-bg": "rgba(214, 138, 102, 0.14)",
  "--error-text": "#e0a184",
  "--gold-bg": "rgba(217, 194, 116, 0.16)",
  "--gold-text": "#dcc98a",
  "--btn-fg": "#1f1b17",
  "--gold-btn-fg": "#1f1b17",
  "--canvas-paper": "#faf9f6",
  "--leather-start": "#3a2c20",
  "--leather-end": "#241a13",
  "--leather-border": "#8f6538",
  "--leather-rim": "#6f4d2c",
  "--leather-text": "#e0c18c",
  "--leather-muted": "#b29168",
  "--leather-slot-start": "#3b2d21",
  "--leather-slot-end": "#2a2018",
  "--leather-empty-start": "#30251c",
  "--leather-empty-end": "#211913",
  "--leather-mark": "rgba(236, 229, 218, 0.06)",
};

export const INJECTED_UI_THEME_TOKENS = {
  light: LIGHT_INJECTED_UI_TOKENS,
  dark: DARK_INJECTED_UI_TOKENS,
} satisfies Record<InjectedUiTheme, ThemeTokens>;

interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function parseComputedColor(color: string | undefined): RgbaColor | null {
  if (!color) return null;
  if (color === "transparent") {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  const match = color.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/,
  );
  if (!match) return null;

  const alphaValue = match[4];
  const alpha = alphaValue?.endsWith("%")
    ? Number.parseFloat(alphaValue) / 100
    : Number.parseFloat(alphaValue ?? "1");

  return {
    red: Number.parseFloat(match[1]),
    green: Number.parseFloat(match[2]),
    blue: Number.parseFloat(match[3]),
    alpha,
  };
}

function compositeColor(
  foreground: RgbaColor,
  background: RgbaColor,
): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };

  return {
    red:
      (foreground.red * foreground.alpha +
        background.red * background.alpha * (1 - foreground.alpha)) /
      alpha,
    green:
      (foreground.green * foreground.alpha +
        background.green * background.alpha * (1 - foreground.alpha)) /
      alpha,
    blue:
      (foreground.blue * foreground.alpha +
        background.blue * background.alpha * (1 - foreground.alpha)) /
      alpha,
    alpha,
  };
}

function relativeLuminance(color: RgbaColor): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(color.red) +
    0.7152 * linearize(color.green) +
    0.0722 * linearize(color.blue)
  );
}

function preferredColorScheme(): InjectedUiTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getHostPageTheme(): InjectedUiTheme {
  if (!document.body) return preferredColorScheme();

  const bodyColor = parseComputedColor(
    getComputedStyle(document.body).backgroundColor,
  );
  const rootColor = parseComputedColor(
    getComputedStyle(document.documentElement).backgroundColor,
  );
  if (
    !bodyColor ||
    !rootColor ||
    (bodyColor.alpha === 0 && rootColor.alpha === 0)
  ) {
    return preferredColorScheme();
  }

  const white = { red: 255, green: 255, blue: 255, alpha: 1 };
  const pageColor = compositeColor(bodyColor, compositeColor(rootColor, white));
  return relativeLuminance(pageColor) < 0.4 ? "dark" : "light";
}
