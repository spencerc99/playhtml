// ABOUTME: Plans and runs local video post-processing for Playwright recordings.
// ABOUTME: Produces focused demo clips from the marked action window.

import { once } from "events";
import type { Page } from "@playwright/test";
import { spawn, spawnSync } from "child_process";

export interface VideoTrimInput {
  videoStartedAtMs: number;
  recordingStartedAtMs: number | undefined;
  sceneDurationMs: number;
  tailMs?: number;
}

export interface VideoTrimWindow {
  startSeconds: number;
  durationSeconds: number;
}

export interface FfmpegTrimInput extends VideoTrimWindow {
  inputPath: string;
  outputPath: string;
}

export interface RealtimeVideoInput {
  outputPath: string;
  frameRate: number;
  crf?: number;
}

export interface RealtimeVideoRecorderInput extends RealtimeVideoInput {
  page: Page;
  expectedDurationMs: number;
  jpegQuality?: number;
}

export interface VideoProbe {
  durationSeconds: number;
  frameRate: number;
  frameCount?: number;
}

export interface VideoWindowExpectation {
  toleranceSeconds?: number;
  minFrameRate?: number;
}

interface ScreencastFrame {
  data: string;
  sessionId: number;
}

export function computeTrimWindow(input: VideoTrimInput): VideoTrimWindow | null {
  if (input.recordingStartedAtMs === undefined) return null;

  const startMs = Math.max(0, input.recordingStartedAtMs - input.videoStartedAtMs);
  const durationMs = input.sceneDurationMs + (input.tailMs ?? 1500);
  return {
    startSeconds: Number((startMs / 1000).toFixed(3)),
    durationSeconds: Number((durationMs / 1000).toFixed(3)),
  };
}

function formatSeconds(value: number) {
  return value.toFixed(3);
}

export function buildFfmpegTrimArgs(input: FfmpegTrimInput) {
  return [
    "-y",
    "-ss",
    formatSeconds(input.startSeconds),
    "-t",
    formatSeconds(input.durationSeconds),
    "-i",
    input.inputPath,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

export function buildRealtimeFfmpegArgs(input: RealtimeVideoInput) {
  return [
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(input.frameRate),
    "-i",
    "pipe:0",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(input.crf ?? 14),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    input.outputPath,
  ];
}

export function framesForDuration(durationMs: number, frameRate: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("durationMs must be non-negative");
  }
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error("frameRate must be positive");
  }
  return Math.ceil((durationMs / 1000) * frameRate);
}

export function frameCopiesForElapsed(
  elapsedMs: number,
  frameRate: number,
  writtenFrames: number,
) {
  const expectedFrames = Math.max(1, framesForDuration(elapsedMs, frameRate) + 1);
  return Math.max(0, expectedFrames - writtenFrames);
}

export function ffmpegIsAvailable() {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

export function ffprobeIsAvailable() {
  const result = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
  return result.status === 0;
}

export function trimVideo(input: FfmpegTrimInput) {
  const result = spawnSync("ffmpeg", buildFfmpegTrimArgs(input), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg failed while trimming video:\n${result.stderr || result.stdout}`,
    );
  }
}

function parseFrameRate(value: string) {
  const [numeratorText, denominatorText] = value.trim().split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    throw new Error(`Invalid frame rate: ${value}`);
  }
  return numerator / denominator;
}

function fieldValue(output: string, field: string) {
  const match = output.match(new RegExp(`^${field}=([^\\n]+)`, "m"));
  return match?.[1];
}

export function parseFfprobeStream(output: string): VideoProbe {
  const durationText = fieldValue(output, "duration");
  const frameRateText = fieldValue(output, "avg_frame_rate");
  if (!durationText || !frameRateText) {
    throw new Error("ffprobe output is missing duration or frame rate");
  }

  const frameCountText = fieldValue(output, "nb_read_frames");
  return {
    durationSeconds: Number(durationText),
    frameRate: parseFrameRate(frameRateText),
    ...(frameCountText ? { frameCount: Number(frameCountText) } : {}),
  };
}

export function probeVideo(inputPath: string): VideoProbe {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=duration,avg_frame_rate,nb_read_frames",
      "-of",
      "default=nokey=0:noprint_wrappers=1",
      inputPath,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `ffprobe failed while checking video:\n${result.stderr || result.stdout}`,
    );
  }
  return parseFfprobeStream(result.stdout);
}

export function videoMatchesExpectedWindow(
  probe: VideoProbe,
  expectedDurationSeconds: number,
  expectation: VideoWindowExpectation = {},
) {
  const toleranceSeconds = expectation.toleranceSeconds ?? 1;
  if (Math.abs(probe.durationSeconds - expectedDurationSeconds) > toleranceSeconds) {
    return false;
  }
  if (
    expectation.minFrameRate !== undefined &&
    probe.frameRate < expectation.minFrameRate
  ) {
    return false;
  }
  return true;
}

export async function createRealtimeVideoRecorder(
  input: RealtimeVideoRecorderInput,
) {
  const frameRate = input.frameRate;
  const client = await input.page.context().newCDPSession(input.page);
  const ffmpeg = spawn("ffmpeg", buildRealtimeFfmpegArgs(input), {
    stdio: ["pipe", "ignore", "pipe"],
  });

  let stderr = "";
  let startedAtMs: number | undefined;
  let stopped = false;
  let lastFrame: Buffer | undefined;
  let writtenFrames = 0;
  let writeError: unknown;
  let writeQueue = Promise.resolve();

  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-4000);
  });

  ffmpeg.on("error", (error) => {
    writeError = error;
  });

  async function writeBuffer(buffer: Buffer) {
    if (!ffmpeg.stdin.write(buffer)) {
      await once(ffmpeg.stdin, "drain");
    }
  }

  function enqueueFrame(buffer: Buffer, copies: number) {
    if (copies < 1) return;
    writeQueue = writeQueue
      .then(async () => {
        for (let i = 0; i < copies; i++) {
          await writeBuffer(buffer);
        }
      })
      .catch((error) => {
        writeError = error;
      });
  }

  function recordFrame(buffer: Buffer, elapsedMs: number) {
    if (stopped) return;
    const boundedElapsedMs = Math.min(elapsedMs, input.expectedDurationMs);
    const copies = frameCopiesForElapsed(
      boundedElapsedMs,
      frameRate,
      writtenFrames,
    );
    if (copies < 1) return;
    lastFrame = buffer;
    writtenFrames += copies;
    enqueueFrame(buffer, copies);
  }

  async function closeEncoder() {
    ffmpeg.stdin.end();
    const [code] = await once(ffmpeg, "close");
    await client.detach().catch(() => {});
    if (code !== 0) {
      throw new Error(`ffmpeg failed while recording video:\n${stderr}`);
    }
  }

  client.on("Page.screencastFrame", (frame: ScreencastFrame) => {
    void client
      .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => {});
    if (startedAtMs === undefined || stopped) return;
    recordFrame(Buffer.from(frame.data, "base64"), Date.now() - startedAtMs);
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: input.jpegQuality ?? 92,
    everyNthFrame: 1,
  });

  return {
    outputPath: input.outputPath,
    start() {
      if (startedAtMs !== undefined) return;
      startedAtMs = Date.now();
      void input.page
        .screenshot({
          type: "jpeg",
          quality: input.jpegQuality ?? 92,
        })
        .then((buffer) => recordFrame(buffer, 0))
        .catch((error) => {
          writeError = error;
        });
    },
    async stop(): Promise<VideoProbe> {
      stopped = true;
      await client.send("Page.stopScreencast").catch(() => {});

      const wasStarted = startedAtMs !== undefined;
      if (wasStarted && lastFrame) {
        const targetFrames = framesForDuration(input.expectedDurationMs, frameRate);
        const remainingFrames = Math.max(0, targetFrames - writtenFrames);
        writtenFrames += remainingFrames;
        enqueueFrame(lastFrame, remainingFrames);
      }

      await writeQueue;
      const pendingWriteError = writeError;
      let closeError: unknown;
      try {
        await closeEncoder();
      } catch (error) {
        closeError = error;
      }
      if (pendingWriteError) {
        throw pendingWriteError;
      }
      if (!wasStarted) {
        throw new Error("Recording was never started");
      }
      if (closeError) {
        throw closeError;
      }

      if (ffprobeIsAvailable()) {
        return probeVideo(input.outputPath);
      }
      return {
        durationSeconds: writtenFrames / frameRate,
        frameRate,
        frameCount: writtenFrames,
      };
    },
  };
}
