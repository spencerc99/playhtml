// ABOUTME: Renders a framed collage turning from its front to its back and over again, as a looping MP4.
// ABOUTME: The mat and caption hold still while the paper turns in its window.

import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeVideo,
} from "mediabunny";
import { COLLAGE_VIDEO_FPS } from "./collageVideoTiming";
import {
  matLayout,
  paintMat,
  paintPaperEdge,
  type ExportCaption,
} from "./frameExport";

/** How long each side rests, and how long a turn takes, in seconds. */
const HOLD_S = 1.4;
const TURN_S = 0.9;
const KEY_FRAME_INTERVAL_S = 1;
/** Paper widths tried, largest first, until the encoder takes one. */
const PAPER_WIDTHS = [1600, 1280, 1024, 800, 640];

/** Where in the loop a moment falls: which side shows and how far it has turned. */
export function flipAt(timeS: number): { angle: number } {
  const loop = 2 * (HOLD_S + TURN_S);
  const t = ((timeS % loop) + loop) % loop;
  const ease = (x: number) => (1 - Math.cos(Math.PI * x)) / 2;
  if (t < HOLD_S) return { angle: 0 };
  if (t < HOLD_S + TURN_S) return { angle: Math.PI * ease((t - HOLD_S) / TURN_S) };
  if (t < 2 * HOLD_S + TURN_S) return { angle: Math.PI };
  return {
    angle: Math.PI * (1 + ease((t - 2 * HOLD_S - TURN_S) / TURN_S)),
  };
}

export function flipLoopSeconds(): number {
  return 2 * (HOLD_S + TURN_S);
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

export interface FlipVideoOptions {
  front: Blob;
  back: Blob;
  caption: ExportCaption;
  onProgress?: (done: number, total: number) => void;
}

export async function bakeFlipVideo(options: FlipVideoOptions): Promise<Blob> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("this browser cannot encode video");
  }
  const [front, back] = await Promise.all([
    createImageBitmap(options.front),
    createImageBitmap(options.back),
  ]);
  try {
    const aspect = front.height / front.width;
    let layout = null;
    for (const width of PAPER_WIDTHS) {
      if (width > front.width && width !== PAPER_WIDTHS[PAPER_WIDTHS.length - 1]) continue;
      const candidate = matLayout(width, Math.round(width * aspect));
      const size = { width: even(candidate.width), height: even(candidate.height) };
      const accepted = await canEncodeVideo("avc", {
        ...size,
        quality: QUALITY_HIGH,
        frameRate: COLLAGE_VIDEO_FPS,
      });
      if (accepted) {
        layout = { ...candidate, ...size };
        break;
      }
    }
    if (!layout) {
      throw new Error("this browser cannot encode H.264 video at the collage's size");
    }

    // The mat and caption never change, so they are painted once.
    const mat = document.createElement("canvas");
    mat.width = layout.width;
    mat.height = layout.height;
    const matContext = mat.getContext("2d");
    if (!matContext) throw new Error("no 2d context to draw the mat");
    await paintMat(matContext, layout, options.caption);
    // The window reads as a shallow recess while the paper is turned away.
    matContext.fillStyle = "rgba(58, 55, 52, 0.06)";
    const win = layout.window;
    matContext.fillRect(win.x, win.y, win.width, win.height);

    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context to draw the video");

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

    const total = Math.round(flipLoopSeconds() * COLLAGE_VIDEO_FPS);
    try {
      for (let index = 0; index < total; index += 1) {
        const timeS = index / COLLAGE_VIDEO_FPS;
        const { angle } = flipAt(timeS);
        const turned = Math.abs(Math.sin(angle));
        const face = Math.cos(angle) >= 0 ? front : back;
        const squeeze = Math.max(0.001, Math.abs(Math.cos(angle)));
        const lift = 1 + 0.035 * turned;

        context.drawImage(mat, 0, 0);
        context.save();
        context.translate(win.x + win.width / 2, win.y + win.height / 2);
        context.scale(squeeze * lift, lift);
        context.shadowColor = `rgba(58, 55, 52, ${0.25 * turned})`;
        context.shadowBlur = win.width * 0.03 * turned;
        context.shadowOffsetY = win.width * 0.012 * turned;
        context.drawImage(face, -win.width / 2, -win.height / 2, win.width, win.height);
        context.restore();
        if (turned === 0) paintPaperEdge(context, win, win.width);

        await source.add(timeS, 1 / COLLAGE_VIDEO_FPS);
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
    front.close();
    back.close();
  }
}
