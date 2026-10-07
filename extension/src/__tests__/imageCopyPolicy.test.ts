// ABOUTME: Tests the rules for local scrap image copies: animation detection, copy form, encode sizes, eviction.
// ABOUTME: Feeds real image byte layouts and plain copy summaries through the pure policy functions.

import { describe, expect, it } from "vitest";
import {
  ANIMATED_ORIGINAL_MAX_BYTES,
  IMAGE_COPY_TARGET_BYTES,
  STILL_COPY_MAX_EDGE,
  STILL_COPY_MIN_EDGE,
  STILL_COPY_QUALITIES,
  STILL_COPY_QUALITY_FLOOR,
  copiesToEvict,
  copyForm,
  encodeAttempts,
  isAnimatedImage,
  pinnedSources,
} from "../storage/imageCopyPolicy";
import { COLLAGE_FORMATS } from "../entrypoints/scraps/collageFormats";

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/** A minimal GIF89a with the given number of 1×1 frames, each behind a control extension. */
function gif(frames: number): Uint8Array {
  const bytes = [
    ...ascii("GIF89a"),
    1, 0, 1, 0, // 1×1 logical screen
    0x80, 0, 0, // a two-entry global colour table follows
    0, 0, 0, 255, 255, 255,
  ];
  for (let frame = 0; frame < frames; frame++) {
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0); // graphic control extension
    bytes.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0); // image descriptor
    bytes.push(2, 2, 0x4c, 0x01, 0); // LZW minimum code size, one data block
  }
  bytes.push(0x3b);
  return new Uint8Array(bytes);
}

function pngChunk(type: string, length: number): number[] {
  return [0, 0, 0, length, ...ascii(type), ...new Array(length).fill(0), 0, 0, 0, 0];
}

function png(animated: boolean): Uint8Array {
  return new Uint8Array([
    0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", 13),
    ...(animated ? pngChunk("acTL", 8) : []),
    ...pngChunk("IDAT", 4),
    ...pngChunk("IEND", 0),
  ]);
}

function webp(animated: boolean): Uint8Array {
  return new Uint8Array([
    ...ascii("RIFF"), 30, 0, 0, 0,
    ...ascii("WEBP"),
    ...ascii("VP8X"), 10, 0, 0, 0,
    animated ? 0x02 : 0x00, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ]);
}

describe("isAnimatedImage", () => {
  it("tells a single-frame GIF from an animated one", () => {
    expect(isAnimatedImage(gif(1))).toBe(false);
    expect(isAnimatedImage(gif(2))).toBe(true);
    expect(isAnimatedImage(gif(12))).toBe(true);
  });

  it("reads the APNG animation chunk", () => {
    expect(isAnimatedImage(png(false))).toBe(false);
    expect(isAnimatedImage(png(true))).toBe(true);
  });

  it("reads the animated WebP flag", () => {
    expect(isAnimatedImage(webp(false))).toBe(false);
    expect(isAnimatedImage(webp(true))).toBe(true);
  });

  it("treats a JPEG and truncated bytes as still", () => {
    expect(isAnimatedImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(isAnimatedImage(new Uint8Array(ascii("GIF89a")))).toBe(false);
  });
});

describe("copyForm", () => {
  it("keeps a small animation whole and a large one as its first frame", () => {
    expect(
      copyForm({ byteLength: ANIMATED_ORIGINAL_MAX_BYTES, mimeType: "image/gif", animated: true }),
    ).toBe("original");
    expect(
      copyForm({
        byteLength: ANIMATED_ORIGINAL_MAX_BYTES + 1,
        mimeType: "image/gif",
        animated: true,
      }),
    ).toBe("still-frame");
  });

  it("keeps a still that is already small and within the size cap", () => {
    expect(
      copyForm({
        byteLength: IMAGE_COPY_TARGET_BYTES,
        mimeType: "image/jpeg",
        animated: false,
        width: 800,
        height: 600,
      }),
    ).toBe("original");
  });

  it("redraws a still that is too heavy or too large", () => {
    expect(
      copyForm({
        byteLength: IMAGE_COPY_TARGET_BYTES + 1,
        mimeType: "image/jpeg",
        animated: false,
        width: 800,
        height: 600,
      }),
    ).toBe("reduced");
    expect(
      copyForm({
        byteLength: 50_000,
        mimeType: "image/png",
        animated: false,
        width: STILL_COPY_MAX_EDGE + 1,
        height: 10,
      }),
    ).toBe("reduced");
  });

  it("keeps SVG as markup", () => {
    expect(
      copyForm({ byteLength: 900_000, mimeType: "image/svg+xml", animated: false }),
    ).toBe("original");
  });

  it("refuses to choose for a still it has not decoded", () => {
    expect(() =>
      copyForm({ byteLength: 10, mimeType: "image/png", animated: false }),
    ).toThrow(/decoded/);
  });
});

describe("encodeAttempts", () => {
  it("caps the longest side at the largest collage format", () => {
    const largest = Math.max(
      ...Object.values(COLLAGE_FORMATS).map((f) => Math.max(f.width, f.height)),
    );
    expect(STILL_COPY_MAX_EDGE).toBe(largest);
    const [first] = encodeAttempts(4000, 2000);
    expect(first).toEqual({
      width: STILL_COPY_MAX_EDGE,
      height: STILL_COPY_MAX_EDGE / 2,
      quality: STILL_COPY_QUALITIES[0],
    });
  });

  it("steps quality down at full size, then shrinks at the quality floor", () => {
    const attempts = encodeAttempts(3200, 1600);
    const full = attempts.slice(0, STILL_COPY_QUALITIES.length);
    expect(full.map((a) => a.quality)).toEqual([...STILL_COPY_QUALITIES]);
    expect(new Set(full.map((a) => a.width))).toEqual(new Set([STILL_COPY_MAX_EDGE]));
    const shrinking = attempts.slice(STILL_COPY_QUALITIES.length);
    expect(shrinking.length).toBeGreaterThan(0);
    for (const attempt of shrinking) {
      expect(attempt.quality).toBe(STILL_COPY_QUALITY_FLOOR);
    }
    const edges = shrinking.map((a) => Math.max(a.width, a.height));
    expect(edges).toEqual([...edges].sort((a, b) => b - a));
    expect(edges.at(-1)).toBe(STILL_COPY_MIN_EDGE);
  });

  it("never enlarges a small image", () => {
    const attempts = encodeAttempts(120, 90);
    for (const attempt of attempts) {
      expect(attempt.width).toBeLessThanOrEqual(120);
      expect(attempt.height).toBeLessThanOrEqual(90);
    }
    expect(attempts).toHaveLength(STILL_COPY_QUALITIES.length);
  });
});

describe("pins and eviction", () => {
  const copy = (hash: string, byteLength: number, storedAt: number) => ({
    hash,
    byteLength,
    storedAt,
  });

  it("lets nothing go while under budget", () => {
    expect(copiesToEvict([copy("a", 10, 1), copy("b", 10, 2)], new Set(), 100)).toEqual([]);
  });

  it("lets the oldest unpinned copies go first until the total fits", () => {
    const copies = [copy("new", 40, 3), copy("old", 40, 1), copy("mid", 40, 2)];
    expect(copiesToEvict(copies, new Set(), 80)).toEqual(["old"]);
    expect(copiesToEvict(copies, new Set(), 40)).toEqual(["old", "mid"]);
  });

  it("never lets a pinned copy go, even when pinned copies alone are over", () => {
    const copies = [copy("pinned", 90, 1), copy("free", 20, 2)];
    expect(copiesToEvict(copies, new Set(["pinned"]), 50)).toEqual(["free"]);
  });

  it("keeps a source pinned while any collage still holds it", () => {
    const pins = [
      { collageId: "one", srcs: ["https://a.test/x.png", "https://a.test/y.png"] },
      { collageId: "two", srcs: ["https://a.test/x.png"] },
    ];
    expect(pinnedSources(pins)).toEqual(
      new Set(["https://a.test/x.png", "https://a.test/y.png"]),
    );
    const afterOneIsDeleted = pins.filter((pin) => pin.collageId !== "one");
    expect(pinnedSources(afterOneIsDeleted)).toEqual(new Set(["https://a.test/x.png"]));
    expect(pinnedSources([])).toEqual(new Set());
  });
});
