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
