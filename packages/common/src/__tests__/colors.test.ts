// ABOUTME: Verifies person colors convert to hex and new identities save hex colors.
// ABOUTME: Native color inputs only accept #rrggbb, so hsl/rgb colors must be normalized.
import { describe, expect, test } from "vitest";
import { generatePlayerIdentity, toHexColor } from "../cursor-types";

describe("toHexColor", () => {
  test("keeps 6-digit hex and expands 3-digit hex, lowercased", () => {
    expect(toHexColor("#AbCdEf")).toBe("#abcdef");
    expect(toHexColor("#0f8")).toBe("#00ff88");
  });

  test("converts hsl in comma, space and alpha forms", () => {
    expect(toHexColor("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(toHexColor("hsl(120 100% 25%)")).toBe("#008000");
    expect(toHexColor("hsla(240, 100%, 50%, 0.5)")).toBe("#0000ff");
    expect(toHexColor("hsl(200deg 70% 60% / 50%)")).toBe("#52b1e0");
    expect(toHexColor("hsl(-120, 100%, 50%)")).toBe("#0000ff");
    expect(toHexColor("hsl(210, 70%, 60%)")).toBe("#5299e0");
  });

  test("converts rgb and clamps out-of-range channels", () => {
    expect(toHexColor("rgb(255, 128, 0)")).toBe("#ff8000");
    expect(toHexColor("rgba(10 20 30 / 0.4)")).toBe("#0a141e");
    expect(toHexColor("rgb(300, -1, 0)")).toBe("rgb(300, -1, 0)");
  });

  test("returns other colors unchanged", () => {
    expect(toHexColor("red")).toBe("red");
    expect(toHexColor("")).toBe("");
  });
});

describe("generatePlayerIdentity", () => {
  test("saves every palette color as hex", () => {
    for (let i = 0; i < 20; i++) {
      const { colorPalette } = generatePlayerIdentity().playerStyle;
      expect(colorPalette).toHaveLength(3);
      for (const color of colorPalette) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
