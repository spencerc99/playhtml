// ABOUTME: Tests the pure scrap helpers for color alpha and bare-text button detection.
// ABOUTME: Covers each chrome signal that keeps a control worth collecting.

import { describe, expect, it } from "vitest";
import { colorAlpha, isBareTextButton } from "../scrapUtils";

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
});

describe("isBareTextButton", () => {
  it("skips a control with no background, border, shadow or icon", () => {
    expect(isBareTextButton(BARE_STYLES, false)).toBe(true);
  });

  it("keeps a control with an opaque background", () => {
    expect(
      isBareTextButton(
        { ...BARE_STYLES, backgroundColor: "rgb(204, 0, 0)" },
        false,
      ),
    ).toBe(false);
  });

  it("keeps a control with a merely tinted background", () => {
    expect(
      isBareTextButton(
        { ...BARE_STYLES, backgroundColor: "rgba(204, 0, 0, 0.08)" },
        false,
      ),
    ).toBe(false);
  });

  it("keeps a control with a captured gradient", () => {
    expect(
      isBareTextButton(
        {
          ...BARE_STYLES,
          backgroundImage: "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
        },
        false,
      ),
    ).toBe(false);
  });

  it("keeps a control with a shadow", () => {
    expect(
      isBareTextButton(
        { ...BARE_STYLES, boxShadow: "rgba(0, 0, 0, 0.2) 0px 2px 6px 0px" },
        false,
      ),
    ).toBe(false);
  });

  it("keeps a control whose border shorthand draws something", () => {
    expect(
      isBareTextButton(
        { ...BARE_STYLES, border: "1.5px solid rgb(91, 141, 184)" },
        false,
      ),
    ).toBe(false);
  });

  it("keeps a control bordered on a single side only", () => {
    const { border: _border, ...sides } = BARE_STYLES;
    expect(
      isBareTextButton(
        {
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
        },
        false,
      ),
    ).toBe(false);
  });

  it("treats a fully transparent border as no border", () => {
    expect(
      isBareTextButton(
        { ...BARE_STYLES, border: "1px solid rgba(0, 0, 0, 0)" },
        false,
      ),
    ).toBe(true);
    const { border: _border, ...sides } = BARE_STYLES;
    expect(
      isBareTextButton(
        {
          ...sides,
          borderBottomWidth: "2px",
          borderBottomStyle: "solid",
          borderBottomColor: "rgba(0, 0, 0, 0)",
        },
        false,
      ),
    ).toBe(true);
  });

  it("treats a styled but zero-width border as no border", () => {
    expect(
      isBareTextButton(
        { ...BARE_STYLES, border: "0px solid rgb(6, 6, 6)" },
        false,
      ),
    ).toBe(true);
  });

  it("keeps an icon-only control that has no other chrome", () => {
    expect(isBareTextButton(BARE_STYLES, true)).toBe(false);
  });
});
