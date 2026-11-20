// ABOUTME: Tests the pure scrap helpers for color alpha and whether a control paints a button face.
// ABOUTME: Covers the CSS Color 4 syntaxes and each chrome signal that keeps a control.

import { describe, expect, it } from "vitest";
import {
  colorAlpha,
  hasButtonFace,
  hasPrivateUseCharacter,
  hasVisibleShadow,
  isIconFontFamily,
} from "../scrapUtils";

/** A control with no face reads as words or a bare icon, not a button. */
function isBare(styles: Record<string, string>, backdrop?: string): boolean {
  return !hasButtonFace(styles, backdrop);
}

/** The styles a plain text control tagged `role="button"` reports. */
const BARE_STYLES: Record<string, string> = {
  backgroundColor: "rgba(0, 0, 0, 0)",
  color: "rgb(6, 6, 6)",
  border: "0px none rgb(6, 6, 6)",
  boxShadow: "none",
  fontFamily: "Roboto, sans-serif",
  fontSize: "12px",
};

describe("colorAlpha", () => {
  it("treats every rgb() form as solid, whatever its channels", () => {
    expect(colorAlpha("rgb(28, 32, 38)")).toBe(1);
    expect(colorAlpha("rgb(0, 0, 0)")).toBe(1);
    expect(colorAlpha("#facade")).toBe(1);
  });

  it("reads the alpha channel of an rgba() color", () => {
    expect(colorAlpha("rgba(0, 0, 0, 0)")).toBe(0);
    expect(colorAlpha("rgba(255, 255, 255, 0.2)")).toBe(0.2);
    expect(colorAlpha("rgba(1, 2, 3, 1)")).toBe(1);
  });

  it("treats the transparent keyword and an empty value as painting nothing", () => {
    expect(colorAlpha("transparent")).toBe(0);
    expect(colorAlpha("  ")).toBe(0);
  });

  it("reads slash alpha out of the space-separated rgb() form", () => {
    expect(colorAlpha("rgb(0 0 0 / 0)")).toBe(0);
    expect(colorAlpha("rgb(0 0 0 / 0.2)")).toBe(0.2);
    expect(colorAlpha("rgb(12 34 56 / 20%)")).toBe(0.2);
    expect(colorAlpha("rgb(12 34 56)")).toBe(1);
  });

  it("reads slash alpha out of the wide-gamut forms Chromium keeps", () => {
    expect(colorAlpha("oklch(0.7 0.1 250 / 0.2)")).toBe(0.2);
    expect(colorAlpha("oklch(0.7 0.1 250)")).toBe(1);
    expect(colorAlpha("color(display-p3 0.1 0.2 0.3 / 0.2)")).toBe(0.2);
    expect(colorAlpha("color(display-p3 0.1 0.2 0.3 / 0%)")).toBe(0);
    expect(colorAlpha("color(srgb 0.1 0.2 0.3)")).toBe(1);
    expect(colorAlpha("lab(50% 40 59.5 / 0.5)")).toBe(0.5);
  });

  it("reads alpha out of both the legacy and the slash hsl forms", () => {
    expect(colorAlpha("hsla(120, 50%, 50%, 0.2)")).toBe(0.2);
    expect(colorAlpha("hsl(120 50% 50% / 20%)")).toBe(0.2);
    expect(colorAlpha("hsl(120, 50%, 50%)")).toBe(1);
  });

  it("reads the alpha byte of the four- and eight-digit hex forms", () => {
    expect(colorAlpha("#facade")).toBe(1);
    expect(colorAlpha("#fca")).toBe(1);
    expect(colorAlpha("#facade00")).toBe(0);
    expect(colorAlpha("#facadeff")).toBe(1);
    expect(colorAlpha("#fca0")).toBe(0);
    expect(colorAlpha("#fcaf")).toBe(1);
  });

  it("clamps alpha values that fall outside the paintable range", () => {
    expect(colorAlpha("rgb(0 0 0 / 1.5)")).toBe(1);
    expect(colorAlpha("rgb(0 0 0 / -0.5)")).toBe(0);
  });

  it("reports an unreadable color as unknown rather than guessing it solid", () => {
    expect(colorAlpha("rgb(0 0 0 / nonsense)")).toBeUndefined();
    expect(colorAlpha("#ff")).toBeUndefined();
    expect(colorAlpha("#gggggg")).toBeUndefined();
    expect(colorAlpha("var(--brand)")).toBeUndefined();
  });

  it("treats a bare color keyword as solid", () => {
    expect(colorAlpha("rebeccapurple")).toBe(1);
    expect(colorAlpha("currentcolor")).toBe(1);
  });
});

describe("hasButtonFace", () => {
  it("skips a control with no background, border, shadow or icon", () => {
    expect(isBare(BARE_STYLES)).toBe(true);
  });

  it("keeps a control with an opaque background", () => {
    expect(isBare({ ...BARE_STYLES, backgroundColor: "rgb(204, 0, 0)" })).toBe(
      false,
    );
  });

  it("keeps a control with a merely tinted background", () => {
    expect(
      isBare({ ...BARE_STYLES, backgroundColor: "rgba(204, 0, 0, 0.08)" }),
    ).toBe(false);
  });

  it("keeps a control with a captured gradient", () => {
    expect(
      isBare({
        ...BARE_STYLES,
        backgroundImage: "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
      }),
    ).toBe(false);
  });

  it("keeps a control with a shadow", () => {
    expect(
      isBare({
        ...BARE_STYLES,
        boxShadow: "rgba(0, 0, 0, 0.2) 0px 2px 6px 0px",
      }),
    ).toBe(false);
  });

  it("keeps a control whose border shorthand draws something", () => {
    expect(
      isBare({ ...BARE_STYLES, border: "1.5px solid rgb(91, 141, 184)" }),
    ).toBe(false);
  });

  it("skips a control bordered on a single side only, like a tab", () => {
    const { border: _border, ...sides } = BARE_STYLES;
    expect(
      isBare({
        ...sides,
        borderTopWidth: "0px",
        borderTopStyle: "none",
        borderRightWidth: "0px",
        borderRightStyle: "none",
        borderBottomWidth: "2px",
        borderBottomStyle: "solid",
        borderBottomColor: "rgb(91, 141, 184)",
        borderLeftWidth: "0px",
        borderLeftStyle: "none",
      }),
    ).toBe(true);
  });

  it("treats a fully transparent border as no border", () => {
    expect(
      isBare({ ...BARE_STYLES, border: "1px solid rgba(0, 0, 0, 0)" }),
    ).toBe(true);
    const { border: _border, ...sides } = BARE_STYLES;
    expect(
      isBare({
        ...sides,
        borderBottomWidth: "2px",
        borderBottomStyle: "solid",
        borderBottomColor: "rgba(0, 0, 0, 0)",
      }),
    ).toBe(true);
  });

  it("treats a styled but zero-width border as no border", () => {
    expect(isBare({ ...BARE_STYLES, border: "0px solid rgb(6, 6, 6)" })).toBe(
      true,
    );
  });

  it("keeps a control bordered on three sides", () => {
    const { border: _border, ...sides } = BARE_STYLES;
    const side = (width: string) => ({
      width,
      style: "solid",
      color: "rgb(0, 0, 0)",
    });
    const styles: Record<string, string> = { ...sides };
    for (const [name, width] of [
      ["Top", "1px"],
      ["Right", "1px"],
      ["Bottom", "1px"],
      ["Left", "0px"],
    ] as const) {
      const { style, color } = side(width);
      styles[`border${name}Width`] = width;
      styles[`border${name}Style`] = style;
      styles[`border${name}Color`] = color;
    }
    expect(isBare(styles)).toBe(false);
  });

  it("skips a fill that matches the color behind it", () => {
    expect(
      isBare(
        { ...BARE_STYLES, backgroundColor: "rgb(255, 255, 255)" },
        "rgb(255, 255, 255)",
      ),
    ).toBe(true);
    expect(
      isBare(
        { ...BARE_STYLES, backgroundColor: "rgb(250, 250, 250)" },
        "rgb(255, 255, 255)",
      ),
    ).toBe(true);
  });

  it("keeps a fill that stands out from the color behind it", () => {
    expect(
      isBare(
        { ...BARE_STYLES, backgroundColor: "rgb(41, 82, 227)" },
        "rgb(255, 255, 255)",
      ),
    ).toBe(false);
    expect(
      isBare(
        { ...BARE_STYLES, backgroundColor: "rgb(255, 255, 255)" },
        "rgb(240, 236, 228)",
      ),
    ).toBe(false);
  });

  it("weighs a tinted fill by what it does to the color behind it", () => {
    // 3% of black on white moves each channel by under 8: invisible.
    expect(
      isBare(
        { ...BARE_STYLES, backgroundColor: "rgba(0, 0, 0, 0.03)" },
        "rgb(255, 255, 255)",
      ),
    ).toBe(true);
    expect(
      isBare(
        { ...BARE_STYLES, backgroundColor: "rgba(0, 0, 0, 0.08)" },
        "rgb(255, 255, 255)",
      ),
    ).toBe(false);
  });

  it("skips the invisible shadow layers utility CSS stacks on everything", () => {
    expect(
      isBare({
        ...BARE_STYLES,
        boxShadow:
          "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px",
      }),
    ).toBe(true);
    expect(
      isBare({ ...BARE_STYLES, boxShadow: "rgb(0, 0, 0) 0px 0px 0px 0px" }),
    ).toBe(true);
  });

  it("skips a control whose modern-syntax background paints nothing", () => {
    for (const backgroundColor of [
      "rgb(0 0 0 / 0)",
      "oklch(0.7 0.1 250 / 0)",
      "color(display-p3 0.1 0.2 0.3 / 0%)",
      "#facade00",
    ]) {
      expect(isBare({ ...BARE_STYLES, backgroundColor })).toBe(true);
    }
  });

  it("keeps a control whose modern-syntax background is merely tinted", () => {
    for (const backgroundColor of [
      "rgb(204 0 0 / 0.08)",
      "oklch(0.7 0.1 250 / 20%)",
      "color(display-p3 0.1 0.2 0.3 / 0.2)",
      "#facade33",
    ]) {
      expect(isBare({ ...BARE_STYLES, backgroundColor })).toBe(false);
    }
  });

  it("keeps a control whose background cannot be read rather than dropping it", () => {
    expect(
      isBare({ ...BARE_STYLES, backgroundColor: "var(--brand-surface)" }),
    ).toBe(false);
  });

  it("treats a modern-syntax transparent border as no border", () => {
    expect(isBare({ ...BARE_STYLES, border: "1px solid rgb(0 0 0 / 0)" })).toBe(
      true,
    );
  });

  it("keeps a control whose modern-syntax border paints something", () => {
    expect(
      isBare({ ...BARE_STYLES, border: "1px solid oklch(0.6 0.1 250 / 0.4)" }),
    ).toBe(false);
  });
});

describe("hasVisibleShadow", () => {
  it("finds the one visible layer in a stack", () => {
    expect(
      hasVisibleShadow(
        "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.18) 0px 2px 8px 0px",
      ),
    ).toBe(true);
  });

  it("reads an inset ring as visible", () => {
    expect(hasVisibleShadow("rgb(209, 213, 219) 0px 0px 0px 1px inset")).toBe(
      true,
    );
  });

  it("reads none as nothing", () => {
    expect(hasVisibleShadow("none")).toBe(false);
    expect(hasVisibleShadow(undefined)).toBe(false);
  });
});

describe("icon glyph detection", () => {
  it("recognizes common icon font families", () => {
    expect(isIconFontFamily('"Material Icons"')).toBe(true);
    expect(isIconFontFamily('"Material Symbols Outlined"')).toBe(true);
    expect(isIconFontFamily('"Font Awesome 6 Free"')).toBe(true);
    expect(isIconFontFamily("Inter, system-ui, sans-serif")).toBe(false);
  });

  it("recognizes private use characters", () => {
    expect(hasPrivateUseCharacter("\uf004")).toBe(true);
    expect(hasPrivateUseCharacter("Like")).toBe(false);
  });
});
