// ABOUTME: Tests reading whether GIF, WebP and PNG bytes hold more than one frame.
// ABOUTME: Builds tiny real files byte by byte so the header walk meets the formats' actual layouts.

import { describe, expect, it } from "vitest";
import {
  animatableFormat,
  bytesAnimate,
} from "../entrypoints/scraps/imageAnimation";

function bytes(...parts: (string | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (const char of part) out.push(char.charCodeAt(0));
    } else {
      out.push(...part);
    }
  }
  return new Uint8Array(out);
}

/** A 1×1 GIF with a two-color table and the given number of frames. */
function gif(frames: number): Uint8Array {
  const frame = [
    // Graphic control extension with a 100ms delay.
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
    // Image descriptor, no local color table.
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00,
    // LZW minimum code size, one data sub-block, terminator.
    0x02, 0x02, 0x44, 0x01, 0x00,
  ];
  return bytes(
    "GIF89a",
    [1, 0, 1, 0, 0x80, 0, 0],
    [0, 0, 0, 255, 255, 255],
    // A looping application extension, as animated GIFs carry.
    [0x21, 0xff, 0x0b],
    "NETSCAPE2.0",
    [0x03, 0x01, 0x00, 0x00, 0x00],
    ...Array.from({ length: frames }, () => frame),
    [0x3b],
  );
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function pngChunk(type: string, data: number[]): (string | number[])[] {
  // The CRC is not checked by the header walk, so zeros stand in for it.
  return [uint32(data.length), type, data, [0, 0, 0, 0]];
}

function png(animationFrames: number | null): Uint8Array {
  return bytes(
    [0x89],
    "PNG",
    [0x0d, 0x0a, 0x1a, 0x0a],
    ...pngChunk("IHDR", [...uint32(1), ...uint32(1), 8, 6, 0, 0, 0]),
    ...(animationFrames === null
      ? []
      : pngChunk("acTL", [...uint32(animationFrames), ...uint32(0)])),
    ...pngChunk("IDAT", [0]),
    ...pngChunk("IEND", []),
  );
}

function webp(flags: number): Uint8Array {
  return bytes(
    "RIFF",
    [0, 0, 0, 0],
    "WEBP",
    "VP8X",
    [10, 0, 0, 0],
    [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
}

describe("bytesAnimate", () => {
  it("reads a GIF with several frames as animated and one frame as still", () => {
    expect(animatableFormat(gif(3))).toBe("image/gif");
    expect(bytesAnimate(gif(3))).toBe(true);
    expect(bytesAnimate(gif(1))).toBe(false);
  });

  it("reads an APNG with frames as animated and a plain PNG as still", () => {
    expect(animatableFormat(png(null))).toBe("image/png");
    expect(bytesAnimate(png(4))).toBe(true);
    expect(bytesAnimate(png(1))).toBe(false);
    expect(bytesAnimate(png(null))).toBe(false);
  });

  it("reads a WebP's animation flag", () => {
    expect(animatableFormat(webp(0x02))).toBe("image/webp");
    expect(bytesAnimate(webp(0x02))).toBe(true);
    expect(bytesAnimate(webp(0x10))).toBe(false);
  });

  it("treats other formats as still", () => {
    expect(animatableFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(bytesAnimate(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });
});
