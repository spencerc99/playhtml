// ABOUTME: Tests the background cutout mask over small synthetic bitmaps.
// ABOUTME: Guards that only border-connected backdrop is removed and edges soften.

import { describe, expect, it } from "vitest";
import {
  applyMaskAlpha,
  borderSamples,
  cropPixelRegion,
  edgeColorMask,
  featherMask,
  maskPositionPercent,
  parseCutout,
  regionPlacement,
  scaleMask,
  workingSize,
  type Bitmap,
  type PixelRegion,
} from "../entrypoints/scraps/backgroundCutout";

type Rgb = [number, number, number];

/** Builds a bitmap from a character grid and a palette, for legible fixtures. */
function bitmapOf(rows: string[], palette: Record<string, Rgb>): Bitmap {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = palette[rows[y][x]];
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function maskRows(mask: Uint8ClampedArray, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < mask.length / width; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += mask[y * width + x] === 0 ? "." : "#";
    }
    rows.push(row);
  }
  return rows;
}

const PALETTE: Record<string, Rgb> = {
  W: [255, 255, 255],
  K: [20, 20, 20],
  R: [200, 40, 40],
  G: [240, 240, 240],
};

describe("edgeColorMask", () => {
  it("removes a flat backdrop and keeps the subject", () => {
    const bitmap = bitmapOf(
      [
        "WWWWWW",
        "WWKKWW",
        "WWKKWW",
        "WWKKWW",
        "WWWWWW",
      ],
      PALETTE,
    );
    expect(maskRows(edgeColorMask(bitmap, 0.1), bitmap.width)).toEqual([
      "......",
      "..##..",
      "..##..",
      "..##..",
      "......",
    ]);
  });

  it("keeps a backdrop-colored region enclosed by the subject", () => {
    // The white pocket in the middle is not reachable from the border, so it
    // survives the way a white shirt inside a subject must.
    const bitmap = bitmapOf(
      [
        "WWWWWWW",
        "WKKKKKW",
        "WKKWKKW",
        "WKKKKKW",
        "WWWWWWW",
      ],
      PALETTE,
    );
    const rows = maskRows(edgeColorMask(bitmap, 0.1), bitmap.width);
    expect(rows).toEqual([
      ".......",
      ".#####.",
      ".#####.",
      ".#####.",
      ".......",
    ]);
  });

  it("treats a two-tone backdrop as one backdrop", () => {
    // Left half white, right half near-white: both are sampled at the border.
    const bitmap = bitmapOf(
      [
        "WWWGGG",
        "WWKKGG",
        "WWKKGG",
        "WWWGGG",
      ],
      PALETTE,
    );
    expect(maskRows(edgeColorMask(bitmap, 0.1), bitmap.width)).toEqual([
      "......",
      "..##..",
      "..##..",
      "......",
    ]);
  });

  it("keeps a subject that reaches the border when its color differs", () => {
    // The red block touches the bottom edge, so it is reachable from the
    // border, but it is not backdrop-colored and must survive.
    const bitmap = bitmapOf(
      [
        "WWWWWWW",
        "WWRRRWW",
        "WWRRRWW",
        "WWRRRWW",
      ],
      PALETTE,
    );
    expect(maskRows(edgeColorMask(bitmap, 0.1), bitmap.width)).toEqual([
      ".......",
      "..###..",
      "..###..",
      "..###..",
    ]);
  });

  it("keeps a stripe that crosses the whole picture", () => {
    // The stripe reaches both side edges, but it is a minority of the border,
    // so the white backdrop is what gets removed and the stripe stays.
    const bitmap = bitmapOf(["WWWWW", "RRRRR", "WWWWW"], PALETTE);
    expect(maskRows(edgeColorMask(bitmap, 0.1), bitmap.width)).toEqual([
      ".....",
      "#####",
      ".....",
    ]);
  });

  it("removes a backdrop that holds most of the border", () => {
    // When the picture leaves only a sliver of a second tone at one edge, the
    // dominant tone is still the backdrop and the sliver is kept.
    const bitmap = bitmapOf(
      ["WWWWWWWW", "WWWWWWWW", "WWWWWWWW", "RRWWWWWW"],
      PALETTE,
    );
    const rows = maskRows(edgeColorMask(bitmap, 0.1), bitmap.width);
    expect(rows[3].startsWith("##")).toBe(true);
    expect(rows[0]).toBe("........");
  });

  it("removes nothing when the tolerance is below every difference", () => {
    const bitmap = bitmapOf(["WK", "KW"], PALETTE);
    const mask = edgeColorMask(bitmap, 0);
    // The white corners still match their own sampled color exactly.
    expect(mask.length).toBe(4);
  });

  it("removes everything when the tolerance covers the whole cube", () => {
    const bitmap = bitmapOf(["WK", "KW"], PALETTE);
    expect([...edgeColorMask(bitmap, 1)]).toEqual([0, 0, 0, 0]);
  });
});

/** Copies out the pixels of a region, the way the cutout draws only its crop. */
function regionBitmap(bitmap: Bitmap, region: PixelRegion): Bitmap {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const from = ((region.y + y) * bitmap.width + region.x) * 4;
    data.set(
      bitmap.data.subarray(from, from + region.width * 4),
      y * region.width * 4,
    );
  }
  return { width: region.width, height: region.height, data };
}

describe("cutting out a cropped piece", () => {
  // A busy red surround, with a subject on a small white backdrop in the
  // middle: the crop keeps only the white backdrop and the subject.
  const picture = bitmapOf(
    [
      "RRRRRRRR",
      "RWWWWWWR",
      "RWWKKWWR",
      "RWWKKWWR",
      "RWWWWWWR",
      "RRRRRRRR",
    ],
    PALETTE,
  );
  const crop = { x: 1 / 8, y: 1 / 6, width: 6 / 8, height: 4 / 6 };

  it("keeps the small backdrop when the whole picture's border seeds the flood", () => {
    expect(maskRows(edgeColorMask(picture, 0.1), 8)).toEqual([
      "........",
      ".######.",
      ".######.",
      ".######.",
      ".######.",
      "........",
    ]);
  });

  it("removes the small backdrop when the crop's own border seeds the flood", () => {
    const region = cropPixelRegion(crop, picture.width, picture.height);
    expect(region).toEqual({ x: 1, y: 1, width: 6, height: 4 });
    expect(maskRows(edgeColorMask(regionBitmap(picture, region), 0.1), 6)).toEqual([
      "......",
      "..##..",
      "..##..",
      "......",
    ]);
  });
});

describe("cropPixelRegion", () => {
  it("covers the whole image for a full crop", () => {
    expect(
      cropPixelRegion({ x: 0, y: 0, width: 1, height: 1 }, 640, 480),
    ).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });

  it("snaps edges that land a hair off a pixel boundary", () => {
    expect(
      cropPixelRegion({ x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, 10, 10),
    ).toEqual({ x: 1, y: 2, width: 7, height: 6 });
  });

  it("grows outward to whole pixels so nothing the crop shows is left out", () => {
    expect(
      cropPixelRegion({ x: 0.15, y: 0, width: 0.5, height: 1 }, 10, 4),
    ).toEqual({ x: 1, y: 0, width: 6, height: 4 });
  });

  it("keeps at least one pixel for a sliver of a crop", () => {
    expect(
      cropPixelRegion({ x: 0.5, y: 0.5, width: 0.001, height: 0.001 }, 10, 10),
    ).toEqual({ x: 5, y: 5, width: 1, height: 1 });
  });

  it("refuses a crop with no area", () => {
    expect(() =>
      cropPixelRegion({ x: 0, y: 0, width: 0, height: 1 }, 10, 10),
    ).toThrow(/no area/);
  });
});

describe("regionPlacement", () => {
  it("reports the region as fractions of its source", () => {
    expect(regionPlacement({ x: 1, y: 2, width: 7, height: 6 }, 10, 8)).toEqual({
      x: 0.1,
      y: 0.25,
      width: 0.7,
      height: 0.75,
    });
  });
});

describe("maskPositionPercent", () => {
  it("is zero for a mask that fills the element", () => {
    expect(maskPositionPercent(0, 1)).toBe(0);
  });

  it("puts a half-size mask flush right at 100%", () => {
    expect(maskPositionPercent(0.5, 0.5)).toBeCloseTo(100);
  });

  it("resolves against the space left over once the mask is sized", () => {
    // A quarter-size mask starting a quarter in: 0.25 / 0.75 of the slack.
    expect(maskPositionPercent(0.25, 0.25)).toBeCloseTo(100 / 3);
  });
});

describe("borderSamples", () => {
  it("reports one color for a flat backdrop", () => {
    const bitmap = bitmapOf(["WWW", "WKW", "WWW"], PALETTE);
    const offsets = borderSamples(bitmap, 0.1);
    expect(offsets).toHaveLength(1);
    // The enclosed center pixel is not on the border at all.
    expect(offsets).not.toContain((1 * 3 + 1) * 4);
  });

  it("reports both tones of a two-tone backdrop", () => {
    const bitmap = bitmapOf(["WWWGGG", "WWWGGG", "WWWGGG"], PALETTE);
    expect(borderSamples(bitmap, 0.01)).toHaveLength(2);
  });

  it("leaves out a subject that only touches one edge", () => {
    const bitmap = bitmapOf(
      ["WWWWWWW", "WWWWWWW", "WWRRRWW"],
      PALETTE,
    );
    // Every sampled tone must be the white backdrop, never the red block.
    for (const offset of borderSamples(bitmap, 0.1)) {
      expect([...bitmap.data.slice(offset, offset + 3)]).toEqual([
        255, 255, 255,
      ]);
    }
  });
});

describe("featherMask", () => {
  it("softens the step between kept and removed", () => {
    const width = 7;
    const height = 1;
    const mask = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255]);
    const soft = featherMask(mask, width, height, 1);
    // The pixel beside the cut is no longer fully opaque.
    expect(soft[3]).toBeGreaterThan(0);
    expect(soft[3]).toBeLessThan(255);
    // Removed pixels stay removed, and far-from-the-cut stays solid.
    expect(soft[0]).toBe(0);
    expect(soft[6]).toBe(255);
  });

  it("returns the mask untouched at zero radius", () => {
    const mask = new Uint8ClampedArray([0, 255, 255, 0]);
    expect(featherMask(mask, 2, 2, 0)).toBe(mask);
  });
});

describe("scaleMask", () => {
  it("returns a copy when the size is unchanged", () => {
    const mask = new Uint8ClampedArray([0, 255, 255, 0]);
    const same = scaleMask(mask, 2, 2, 2, 2);
    expect([...same]).toEqual([...mask]);
    expect(same).not.toBe(mask);
  });

  it("keeps solid regions solid when enlarging", () => {
    const mask = new Uint8ClampedArray([255, 255, 255, 255]);
    expect([...scaleMask(mask, 2, 2, 4, 4)].every((v) => v === 255)).toBe(true);
  });

  it("interpolates between kept and removed rather than stepping", () => {
    const mask = new Uint8ClampedArray([0, 255]);
    const wide = scaleMask(mask, 2, 1, 6, 1);
    const middle = [...wide].slice(1, 5);
    expect(middle.some((value) => value > 0 && value < 255)).toBe(true);
  });

  it("refuses a target with no area", () => {
    expect(() => scaleMask(new Uint8ClampedArray(4), 2, 2, 0, 2)).toThrow(
      /positive target size/,
    );
  });
});

describe("workingSize", () => {
  it("leaves a small image at its own size", () => {
    expect(workingSize(400, 300, 1024)).toEqual({ width: 400, height: 300 });
  });

  it("caps the longest side of a large image", () => {
    expect(workingSize(4000, 2000, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("refuses a source with no size", () => {
    expect(() => workingSize(0, 10)).toThrow(/positive source size/);
  });
});

describe("applyMaskAlpha", () => {
  it("clears alpha where the mask removed the backdrop", () => {
    const bitmap = bitmapOf(["WK"], PALETTE);
    applyMaskAlpha(bitmap, new Uint8ClampedArray([0, 255]));
    expect(bitmap.data[3]).toBe(0);
    expect(bitmap.data[7]).toBe(255);
  });

  it("scales alpha partway through a feathered edge", () => {
    const bitmap = bitmapOf(["WW"], PALETTE);
    applyMaskAlpha(bitmap, new Uint8ClampedArray([128, 255]));
    expect(bitmap.data[3]).toBe(128);
  });

  it("refuses a mask that does not match the image", () => {
    const bitmap = bitmapOf(["WW"], PALETTE);
    expect(() => applyMaskAlpha(bitmap, new Uint8ClampedArray([255]))).toThrow(
      /does not match/,
    );
  });
});

describe("parseCutout", () => {
  it("reads a stored edge-color cutout", () => {
    expect(parseCutout({ method: "edge-color", tolerance: 0.2 })).toEqual({
      method: "edge-color",
      tolerance: 0.2,
    });
  });

  it("treats an absent cutout as a piece left alone", () => {
    expect(parseCutout(undefined)).toBeUndefined();
    expect(parseCutout(null)).toBeUndefined();
  });

  it("rejects an unknown method loudly", () => {
    expect(() => parseCutout({ method: "magic-wand", tolerance: 0.2 })).toThrow(
      /unknown method: magic-wand/,
    );
  });

  it("rejects a cutout with no tolerance", () => {
    expect(() => parseCutout({ method: "edge-color" })).toThrow(
      /numeric tolerance/,
    );
  });
});
