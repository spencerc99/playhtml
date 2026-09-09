// ABOUTME: Tests typing background tints across dark and pale participant colors.
// ABOUTME: Ensures the lightness curve retains hue, opacity, and a visible tint.
import { describe, expect, it } from "vitest";
import { typingBackgroundColor } from "../colorStyle";

describe("typingBackgroundColor", () => {
  it("retains hue, saturation and opacity without whitening pale colors", () => {
    let previous = 0;
    for (let l = 0; l <= 100; l++) {
      const result = typingBackgroundColor(`hsl(160, 70%, ${l}%)`, 0.85);
      const match = result.match(/^hsla\(160, 70%, ([\d.]+)%, 0.85\)$/);
      expect(match).not.toBeNull();
      const lightness = Number(match![1]);
      expect(lightness).toBeGreaterThan(previous);
      expect(lightness).toBeLessThan(98);
      previous = lightness;
    }
  });
  it("starts tapering at 85% and keeps very pale colors near the ceiling", () => {
    expect(typingBackgroundColor("hsl(160, 70%, 55%)", 0.85)).toBe("hsla(160, 70%, 85%, 0.85)");
    const result = typingBackgroundColor("hsl(160, 70%, 95%)", 0.85);
    const lightness = Number(result.match(/^hsla\(160, 70%, ([\d.]+)%, 0.85\)$/)![1]);
    expect(lightness).toBeCloseTo(97.4, 1);
  });
  it("keeps dark-color lightening and handles unparseable colors", () => {
    expect(typingBackgroundColor("hsl(160, 70%, 20%)", 0.75)).toBe("hsla(160, 70%, 50%, 0.75)");
    expect(typingBackgroundColor("transparent", 0.75)).toBe("rgba(180, 175, 168, 0.75)");
  });
});
