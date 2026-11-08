import { describe, expect, it } from "vitest";
import { vividColors } from "../coverPalette";

function pixels(...runs: Array<[number, number, number, number]>) {
  const out: number[] = [];
  for (const [r, g, b, n] of runs) {
    for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  }
  return new Uint8ClampedArray(out);
}

describe("vividColors", () => {
  it("skips paper, greys and black, and ranks colours by how much they fill", () => {
    const colors = vividColors(
      pixels(
        [245, 240, 232, 500], // paper
        [128, 128, 128, 200], // grey
        [10, 10, 10, 200], // black
        [31, 75, 255, 40], // blue
        [232, 40, 30, 120], // red
      ),
    );
    expect(colors).toEqual(["#e8281e", "#1f4bff"]);
  });

  it("treats near shades as one colour", () => {
    const colors = vividColors(
      pixels([232, 40, 30, 50], [236, 44, 33, 50], [31, 75, 255, 20]),
    );
    expect(colors).toHaveLength(2);
    expect(colors[1]).toBe("#1f4bff");
  });

  it("returns nothing for a collage with no vivid colour", () => {
    expect(vividColors(pixels([245, 240, 232, 100]))).toEqual([]);
  });
});
