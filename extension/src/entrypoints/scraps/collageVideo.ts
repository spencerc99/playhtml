// ABOUTME: Renders a collage with animated pieces frame by frame and encodes it as an H.264 MP4.
// ABOUTME: Draws each piece with the still bake's routine, swapping in the frame an animation shows at each moment.

import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeVideo,
} from "mediabunny";
import {
  CollageBakeError,
  collageCanvas,
  drawPiece,
  paintPaper,
  pieceFailure,
  prepareCollagePieces,
  type BakeFailure,
  type BakeOptions,
  type PieceImage,
  type PreparedPiece,
} from "./bakeCollage";
import {
  COLLAGE_VIDEO_FPS,
  frameIndexAt,
  videoFrameCount,
  videoFrameTimeMs,
  videoLoopMs,
  videoSizeCandidates,
  type VideoSize,
} from "./collageVideoTiming";
import { cutoutAlpha, type CutoutAlpha } from "./cutoutImages";
import {
  decodeAnimation,
  scrapImageAnimates,
  videoExportSupport,
  type DecodedAnimation,
} from "./imageAnimation";
import type { CollageFrame } from "./collageRecord";

/** Seconds between key frames, so the video seeks and loops cleanly. */
const KEY_FRAME_INTERVAL_S = 1;

export interface VideoBakeOptions extends Omit<BakeOptions, "scale"> {
  /** Told after each frame is encoded. */
  onProgress?: (done: number, total: number) => void;
}

/** A piece whose image changes over the video, and how to draw it at a time. */
interface AnimatedPiece {
  prepared: PreparedPiece;
  animation: DecodedAnimation;
  imageAt(timeMs: number): Promise<PieceImage>;
}

/**
 * Cuts each frame of an animated image with the mask its first frame gave,
 * into a canvas covering only the cropped region, as the still cut does.
 */
function cutFrames(
  animation: DecodedAnimation,
  alpha: CutoutAlpha,
): (timeMs: number) => Promise<PieceImage> {
  if (
    animation.width !== alpha.sourceWidth ||
    animation.height !== alpha.sourceHeight
  ) {
    throw new Error(
      `the animation's frames are ${animation.width}×${animation.height} but its cut was made at ${alpha.sourceWidth}×${alpha.sourceHeight}`,
    );
  }
  const { region } = alpha;
  const canvas = document.createElement("canvas");
  canvas.width = region.width;
  canvas.height = region.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context to cut the animation's frames");
  return async (timeMs) => {
    const frame = await animation.frameAt(
      frameIndexAt(animation.timeline, timeMs),
    );
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, region.width, region.height);
    context.drawImage(
      frame,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );
    context.globalCompositeOperation = "destination-in";
    context.drawImage(alpha.canvas, 0, 0);
    context.globalCompositeOperation = "source-over";
    return { image: canvas, placement: alpha.placement };
  };
}

async function animatePiece(prepared: PreparedPiece): Promise<AnimatedPiece | null> {
  const { piece } = prepared;
  if (piece.scrap.kind !== "image") return null;
  const { src } = piece.scrap;
  if (!(await scrapImageAnimates(src))) return null;
  const animation = await decodeAnimation(src);
  try {
    if (piece.cutout) {
      const alpha = await cutoutAlpha(src, piece.cutout, piece.crop);
      return { prepared, animation, imageAt: cutFrames(animation, alpha) };
    }
    return {
      prepared,
      animation,
      imageAt: async (timeMs) => ({
        image: await animation.frameAt(frameIndexAt(animation.timeline, timeMs)),
      }),
    };
  } catch (error) {
    animation.close();
    throw error;
  }
}

/** The largest size in the list the browser's H.264 encoder will take. */
async function encodableSize(frame: CollageFrame): Promise<VideoSize> {
  for (const size of videoSizeCandidates(frame)) {
    const accepted = await canEncodeVideo("avc", {
      width: size.width,
      height: size.height,
      quality: QUALITY_HIGH,
      frameRate: COLLAGE_VIDEO_FPS,
    });
    if (accepted) return size;
  }
  throw new Error("this browser cannot encode H.264 video at the collage's size");
}

/**
 * Renders the collage as a looping MP4 as long as its slowest animation's
 * loop, held to the video cap. Throws `CollageBakeError` naming every piece
 * that could not be drawn, and a plain error when the browser cannot make
 * video or nothing in the collage moves.
 */
export async function bakeCollageVideo(options: VideoBakeOptions): Promise<Blob> {
  const support = videoExportSupport();
  if (!support.ok) throw new Error(support.reason);
  const { frame } = options;

  const prepared = await prepareCollagePieces(options.pieces);
  const failures: BakeFailure[] = [];
  const animated = new Map<string, AnimatedPiece>();
  await Promise.all(
    prepared.map(async (entry) => {
      try {
        const piece = await animatePiece(entry);
        if (piece) animated.set(entry.piece.id, piece);
      } catch (error) {
        failures.push(pieceFailure(entry.piece, error));
      }
    }),
  );

  try {
    if (failures.length > 0) throw new CollageBakeError(failures);
    if (animated.size === 0) {
      throw new Error("nothing in this collage moves");
    }

    const durationMs = videoLoopMs(
      [...animated.values()].map((piece) => piece.animation.timeline),
    );
    const total = videoFrameCount(durationMs);
    const size = await encodableSize(frame);

    // The paper and grain never change, so they are laid once and copied in.
    const paper = collageCanvas(frame, size.width, size.height);
    await paintPaper(
      paper.context,
      frame,
      options.paper,
      options.grain ?? false,
    );
    const { canvas, context } = collageCanvas(frame, size.width, size.height);

    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target,
    });
    const source = new CanvasSource(canvas, {
      codec: "avc",
      quality: QUALITY_HIGH,
      keyFrameInterval: KEY_FRAME_INTERVAL_S,
    });
    output.addVideoTrack(source, { frameRate: COLLAGE_VIDEO_FPS });
    await output.start();

    try {
      for (let index = 0; index < total; index += 1) {
        const timeMs = videoFrameTimeMs(index);
        context.drawImage(paper.canvas, 0, 0, frame.width, frame.height);
        for (const entry of prepared) {
          const moving = animated.get(entry.piece.id);
          const image = moving ? await moving.imageAt(timeMs) : entry.still;
          drawPiece(context, entry.piece, entry.source, image);
        }
        await source.add(timeMs / 1000, 1 / COLLAGE_VIDEO_FPS);
        options.onProgress?.(index + 1, total);
      }
      await output.finalize();
    } catch (error) {
      await output.cancel();
      throw error;
    }

    if (!target.buffer) throw new Error("the video encoder produced no file");
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    for (const piece of animated.values()) piece.animation.close();
  }
}
