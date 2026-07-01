// ABOUTME: Plans and runs local video post-processing for Playwright recordings.
// ABOUTME: Produces focused demo clips from the marked action window.

import { spawnSync } from "child_process";

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

export interface VideoProbe {
  durationSeconds: number;
  frameRate: number;
  frameCount?: number;
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
  toleranceSeconds = 1,
) {
  return Math.abs(probe.durationSeconds - expectedDurationSeconds) <= toleranceSeconds;
}
