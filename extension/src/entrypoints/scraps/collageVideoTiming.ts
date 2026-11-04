// ABOUTME: Timing and sizing math for a collage's video: loop length, frame sampling, output size.
// ABOUTME: Pure functions, so the export's clock and dimensions can be reasoned about apart from any canvas.

/** Frames per second the collage video is encoded at. */
export const COLLAGE_VIDEO_FPS = 30;

/** Longest a collage video runs, however long its slowest animation loops. */
export const COLLAGE_VIDEO_MAX_MS = 10_000;

/** Pixel density the video aims for, matching the still export. */
export const COLLAGE_VIDEO_SCALE = 2;

/**
 * Longest side a collage video may have. H.264 encoders commonly stop at 4096
 * on a side, and a larger video is unwieldy to share anyway.
 */
export const COLLAGE_VIDEO_MAX_SIDE = 3840;

/**
 * Densities tried in turn when the encoder refuses a size, largest first. The
 * last is the frame's own logical size.
 */
export const COLLAGE_VIDEO_SCALE_STEPS = [2, 1.5, 1.25, 1] as const;

/**
 * Frame delays at or under this many milliseconds are shown by browsers as
 * `SLOW_FRAME_MS` instead, so a GIF that asks for "as fast as possible" plays
 * at the speed people are used to seeing it.
 */
export const FAST_FRAME_THRESHOLD_MS = 10;
export const SLOW_FRAME_MS = 100;

/** When each frame of one animated image starts, and how long one loop runs. */
export interface AnimationTimeline {
  /** How long each frame shows, in milliseconds, after the browser's clamp. */
  durations: readonly number[];
  /** Start time of each frame within a loop, in milliseconds. */
  starts: readonly number[];
  loopMs: number;
}

/** The delay a browser actually shows a frame for. */
export function displayedFrameMs(delayMs: number): number {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`An animation frame has an unreadable delay: ${delayMs}`);
  }
  return delayMs <= FAST_FRAME_THRESHOLD_MS ? SLOW_FRAME_MS : delayMs;
}

/** Builds a timeline from each frame's stated delay, in milliseconds. */
export function animationTimeline(
  delaysMs: readonly number[],
): AnimationTimeline {
  if (delaysMs.length === 0) {
    throw new Error("An animation needs at least one frame");
  }
  const durations = delaysMs.map(displayedFrameMs);
  const starts: number[] = [];
  let elapsed = 0;
  for (const duration of durations) {
    starts.push(elapsed);
    elapsed += duration;
  }
  return { durations, starts, loopMs: elapsed };
}

/**
 * Which frame shows at `timeMs` into the collage video. An animation shorter
 * than the video loops, so it keeps playing to the end.
 */
export function frameIndexAt(timeline: AnimationTimeline, timeMs: number): number {
  if (timeMs < 0) throw new Error("frameIndexAt needs a time at or after zero");
  const withinLoop = timeMs % timeline.loopMs;
  // The last frame whose start is at or before the time is the one showing.
  let low = 0;
  let high = timeline.starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (timeline.starts[middle] <= withinLoop) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * How long the collage video runs: one full loop of its slowest animation,
 * held to `capMs`. Faster animations loop inside it.
 */
export function videoLoopMs(
  timelines: readonly AnimationTimeline[],
  capMs = COLLAGE_VIDEO_MAX_MS,
): number {
  if (timelines.length === 0) {
    throw new Error("A collage video needs at least one animated piece");
  }
  const longest = Math.max(...timelines.map((timeline) => timeline.loopMs));
  return Math.min(longest, capMs);
}

/** How many frames a video of `durationMs` has at `fps`, never fewer than one. */
export function videoFrameCount(
  durationMs: number,
  fps = COLLAGE_VIDEO_FPS,
): number {
  if (durationMs <= 0 || fps <= 0) {
    throw new Error("videoFrameCount needs a positive duration and rate");
  }
  return Math.max(1, Math.round((durationMs * fps) / 1000));
}

/** The moment in the collage, in milliseconds, that output frame `index` shows. */
export function videoFrameTimeMs(index: number, fps = COLLAGE_VIDEO_FPS): number {
  return (index * 1000) / fps;
}

export interface VideoSize {
  width: number;
  height: number;
}

/** Rounds to the nearest even whole number, never below two. */
function evenSide(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * The sizes a collage video may be encoded at, best first. Each keeps the
 * frame's shape, fits within `maxSide`, and has even sides as H.264 requires.
 * The caller asks the encoder about each in turn and takes the first it
 * accepts.
 */
export function videoSizeCandidates(
  frame: VideoSize,
  steps: readonly number[] = COLLAGE_VIDEO_SCALE_STEPS,
  maxSide = COLLAGE_VIDEO_MAX_SIDE,
): VideoSize[] {
  if (frame.width <= 0 || frame.height <= 0) {
    throw new Error("videoSizeCandidates needs a frame with area");
  }
  const fitScale = maxSide / Math.max(frame.width, frame.height);
  const sizes: VideoSize[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const scale = Math.min(step, fitScale);
    const size = {
      width: evenSide(frame.width * scale),
      height: evenSide(frame.height * scale),
    };
    const key = `${size.width}x${size.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sizes.push(size);
  }
  return sizes;
}
