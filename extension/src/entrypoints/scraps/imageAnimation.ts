// ABOUTME: Tells whether a scrap image animates, and decodes its frames with their delays for the video export.
// ABOUTME: Reads GIF, WebP and APNG headers directly, and decodes frames with WebCodecs' ImageDecoder.

import { resolveScrapImageSrc } from "@movement/utils/scrapImageSource";
import { animationTimeline, type AnimationTimeline } from "./collageVideoTiming";

type ImageFormat = "image/gif" | "image/webp" | "image/png";

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let text = "";
  for (let index = at; index < at + length && index < bytes.length; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function uint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  );
}

/** The format the bytes are in, among the ones that can animate. */
export function animatableFormat(bytes: Uint8Array): ImageFormat | null {
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG") return "image/png";
  return null;
}

/** Skips a run of GIF data sub-blocks, answering the offset just past them. */
function skipGifSubBlocks(bytes: Uint8Array, at: number): number {
  let offset = at;
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1;
    if (size === 0) return offset;
    offset += size;
  }
  return offset;
}

/** Whether a GIF holds more than one image, walking its blocks. */
function gifHasFrames(bytes: Uint8Array): boolean {
  const packed = bytes[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);
  let images = 0;
  while (offset < bytes.length) {
    const introducer = bytes[offset];
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      offset = skipGifSubBlocks(bytes, offset + 2);
    } else if (introducer === 0x2c) {
      images += 1;
      if (images > 1) return true;
      const descriptor = bytes[offset + 9];
      offset += 10;
      if (descriptor & 0x80) offset += 3 * 2 ** ((descriptor & 0x07) + 1);
      // The LZW minimum code size precedes the image's data sub-blocks.
      offset = skipGifSubBlocks(bytes, offset + 1);
    } else {
      break;
    }
  }
  return false;
}

/** Whether a WebP declares animation in its extended header. */
function webpAnimates(bytes: Uint8Array): boolean {
  // The VP8X chunk, when present, is the first; its flags byte follows the
  // chunk header, and bit 1 marks an animation.
  return ascii(bytes, 12, 4) === "VP8X" && (bytes[20] & 0x02) !== 0;
}

/** Whether a PNG is an APNG with more than one frame. */
function pngAnimates(bytes: Uint8Array): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = uint32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    // The animation control chunk must come before the image data.
    if (type === "IDAT") return false;
    if (type === "acTL") return uint32(bytes, offset + 8) > 1;
    offset += 12 + length;
  }
  return false;
}

/** Whether an image's bytes describe more than one frame. */
export function bytesAnimate(bytes: Uint8Array): boolean {
  switch (animatableFormat(bytes)) {
    case "image/gif":
      return gifHasFrames(bytes);
    case "image/webp":
      return webpAnimates(bytes);
    case "image/png":
      return pngAnimates(bytes);
    case null:
      return false;
  }
}

/** Reads a scrap image's bytes from its kept copy when there is one. */
async function scrapImageBytes(src: string): Promise<Uint8Array> {
  const response = await fetch(await resolveScrapImageSrc(src));
  if (!response.ok) throw new Error(`fetch returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const motion = new Map<string, Promise<boolean>>();

/**
 * Whether the scrap image at `src` animates. The answer is kept for the
 * session; a failed read is forgotten so a later look can try again.
 */
export function scrapImageAnimates(src: string): Promise<boolean> {
  const known = motion.get(src);
  if (known) return known;
  const pending = scrapImageBytes(src).then(bytesAnimate);
  motion.set(src, pending);
  pending.catch(() => motion.delete(src));
  return pending;
}

/**
 * Whether this browser can make a collage video, and if not, why, in words
 * the studio can show.
 */
export function videoExportSupport(): { ok: true } | { ok: false; reason: string } {
  if (typeof ImageDecoder === "undefined") {
    return {
      ok: false,
      reason: "this browser cannot read the frames of an animated image",
    };
  }
  if (typeof VideoEncoder === "undefined") {
    return { ok: false, reason: "this browser cannot encode video" };
  }
  return { ok: true };
}

/** An animated image's frames, decoded on demand in the order a video needs. */
export interface DecodedAnimation {
  timeline: AnimationTimeline;
  width: number;
  height: number;
  /** The composited frame at `index`, open until the next call or `close`. */
  frameAt(index: number): Promise<VideoFrame>;
  close(): void;
}

/**
 * Decodes an animated scrap image with WebCodecs. Each frame's delay is read
 * once up front to build the timeline; frames are then decoded again as the
 * video reaches them, so a long animation is never held whole in memory.
 */
export async function decodeAnimation(src: string): Promise<DecodedAnimation> {
  const bytes = await scrapImageBytes(src);
  const type = animatableFormat(bytes);
  if (!type) throw new Error("the image is not a GIF, WebP or PNG");
  if (!(await ImageDecoder.isTypeSupported(type))) {
    throw new Error(`this browser cannot decode ${type} frames`);
  }
  const decoder = new ImageDecoder({ data: bytes, type });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new Error("the image has no frames to read");
    const delays: number[] = [];
    let width = 0;
    let height = 0;
    for (let index = 0; index < track.frameCount; index += 1) {
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        if (image.duration === null) {
          throw new Error(`frame ${index + 1} of the image has no duration`);
        }
        width = image.displayWidth;
        height = image.displayHeight;
        delays.push(image.duration / 1000);
      } finally {
        image.close();
      }
    }
    const timeline = animationTimeline(delays);

    let shown: { index: number; frame: VideoFrame } | null = null;
    return {
      timeline,
      width,
      height,
      async frameAt(index) {
        if (shown?.index === index) return shown.frame;
        const { image } = await decoder.decode({ frameIndex: index });
        shown?.frame.close();
        shown = { index, frame: image };
        return image;
      },
      close() {
        shown?.frame.close();
        shown = null;
        decoder.close();
      },
    };
  } catch (error) {
    decoder.close();
    throw error;
  }
}
