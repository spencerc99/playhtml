// ABOUTME: Video recording engine for cursor trail export — SVG→canvas→MediaRecorder pipeline
// ABOUTME: Captures AnimatedTrails SVG frames at 30fps and encodes to WebM via MediaRecorder

import { svgToImageBitmap, triggerDownload } from "./portraitExport";

export interface ScrollKeyframe {
  /** Absolute timestamp (ms, same epoch as CollectionEvent.ts) */
  ts: number;
  /** Raw pixel scroll position at this timestamp */
  scrollX: number;
  scrollY: number;
}

export interface RecordingOptions {
  width: number;
  height: number;
  /** If true, canvas background is transparent (VP9 alpha). If false, fills white. */
  transparent: boolean;
  /**
   * Animation start timestamp (ms, same epoch as CollectionEvent.ts).
   * Used to align the scroll timeline to the animation playback position.
   */
  animationStartTs: number;
  /** Animation cycle duration in ms — how long one full loop takes at the current speed. */
  cycleDurationMs: number;
  /** Animation speed multiplier (e.g. 2 = 2x speed). */
  animationSpeed: number;
  /**
   * Sorted scroll keyframes extracted from cursor events.
   * If empty, the viewBox stays at 0 0 width height (no scroll pan).
   */
  scrollTimeline: ScrollKeyframe[];
  onStop: (blob: Blob) => void;
}

/**
 * Linearly interpolate scroll position at a given absolute timestamp.
 * Returns {scrollX: 0, scrollY: 0} if timeline is empty.
 */
function interpolateScroll(
  timeline: ScrollKeyframe[],
  ts: number,
): { scrollX: number; scrollY: number } {
  if (timeline.length === 0) return { scrollX: 0, scrollY: 0 };
  if (ts <= timeline[0].ts) return { scrollX: timeline[0].scrollX, scrollY: timeline[0].scrollY };
  if (ts >= timeline[timeline.length - 1].ts) {
    const last = timeline[timeline.length - 1];
    return { scrollX: last.scrollX, scrollY: last.scrollY };
  }

  // Binary search for the surrounding keyframes
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].ts <= ts) lo = mid;
    else hi = mid;
  }
  const a = timeline[lo];
  const b = timeline[hi];
  const t = (ts - a.ts) / (b.ts - a.ts);
  return {
    scrollX: Math.round(a.scrollX + (b.scrollX - a.scrollX) * t),
    scrollY: Math.round(a.scrollY + (b.scrollY - a.scrollY) * t),
  };
}

/**
 * Start recording the given SVG element to a WebM video.
 * Returns a stopRecording() function.
 */
export function startRecording(
  svgEl: SVGSVGElement,
  options: RecordingOptions,
): () => void {
  const {
    width,
    height,
    transparent,
    animationStartTs,
    cycleDurationMs,
    animationSpeed,
    scrollTimeline,
    onStop,
  } = options;

  // Create hidden canvas — must NOT be display:none (breaks captureStream)
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText =
    "visibility:hidden;position:fixed;top:-9999px;left:-9999px;pointer-events:none;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  // Pick best supported codec
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    onStop(blob);
    canvas.remove();
  };

  recorder.start();

  // Track when recording started so we can compute animation elapsed time per frame
  const recordingStartWall = performance.now();

  // Per-frame capture at 30fps via setInterval
  // svgToImageBitmap is async — skip frame if previous one is still in-flight
  let capturing = false;
  const intervalId = setInterval(async () => {
    if (capturing) return;
    capturing = true;
    try {
      // Compute how far into the animation cycle we are (loops)
      const wallElapsed = performance.now() - recordingStartWall;
      const scaledElapsed = wallElapsed * animationSpeed;
      const loopedElapsed = cycleDurationMs > 0 ? scaledElapsed % cycleDurationMs : scaledElapsed;

      // Map looped elapsed time back to an absolute timestamp for scroll lookup
      const currentTs = animationStartTs + loopedElapsed;
      const { scrollX, scrollY } = interpolateScroll(scrollTimeline, currentTs);

      // Build viewBox: pan across document space according to scroll position
      const viewBoxOverride =
        scrollTimeline.length > 0
          ? `${scrollX} ${scrollY} ${width} ${height}`
          : undefined;

      const bitmap = await svgToImageBitmap(svgEl, width, height, viewBoxOverride);
      // Clear/fill only immediately before drawing so the canvas never sits blank
      if (!transparent) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    } catch {
      // SVG serialization can fail transiently — skip frame
    } finally {
      capturing = false;
    }
  }, 1000 / 30);

  return () => {
    clearInterval(intervalId);
    recorder.stop();
  };
}

/** Generate a filename for the exported video. */
export function videoExportFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `we-were-online-trails-${date}.webm`;
}

// Re-export triggerDownload so callers can use a single import for download utilities
export { triggerDownload };
