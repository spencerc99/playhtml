// ABOUTME: Verifies video post-processing plans for artificial-user recordings.
// ABOUTME: Keeps demo files focused on the measured action window.

import { describe, expect, test } from "bun:test";
import {
  buildFfmpegTrimArgs,
  computeTrimWindow,
  parseFfprobeStream,
  videoMatchesExpectedWindow,
} from "./video";

describe("computeTrimWindow", () => {
  test("skips trimming when a scene never marks the recording start", () => {
    expect(
      computeTrimWindow({
        videoStartedAtMs: 1000,
        recordingStartedAtMs: undefined,
        sceneDurationMs: 30_000,
      }),
    ).toBeNull();
  });

  test("trims from the marked action start with a small tail", () => {
    expect(
      computeTrimWindow({
        videoStartedAtMs: 1000,
        recordingStartedAtMs: 13_250,
        sceneDurationMs: 30_000,
        tailMs: 1500,
      }),
    ).toEqual({
      startSeconds: 12.25,
      durationSeconds: 31.5,
    });
  });
});

describe("buildFfmpegTrimArgs", () => {
  test("builds a high-quality mp4 trim command", () => {
    expect(
      buildFfmpegTrimArgs({
        inputPath: "/tmp/input.webm",
        outputPath: "/tmp/output.mp4",
        startSeconds: 12.25,
        durationSeconds: 31.5,
      }),
    ).toEqual([
      "-y",
      "-ss",
      "12.250",
      "-t",
      "31.500",
      "-i",
      "/tmp/input.webm",
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
      "/tmp/output.mp4",
    ]);
  });
});

describe("parseFfprobeStream", () => {
  test("parses duration, frame rate, and frame count", () => {
    expect(
      parseFfprobeStream(`duration=31.520000
avg_frame_rate=25/1
nb_read_frames=788
`),
    ).toEqual({
      durationSeconds: 31.52,
      frameRate: 25,
      frameCount: 788,
    });
  });
});

describe("videoMatchesExpectedWindow", () => {
  test("accepts small encoder padding around the expected duration", () => {
    expect(
      videoMatchesExpectedWindow(
        { durationSeconds: 31.52, frameRate: 25, frameCount: 788 },
        31.5,
      ),
    ).toBe(true);
  });

  test("rejects files that are much longer than the action window", () => {
    expect(
      videoMatchesExpectedWindow(
        { durationSeconds: 73.04, frameRate: 25, frameCount: 1826 },
        31.5,
      ),
    ).toBe(false);
  });
});
