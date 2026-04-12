// ABOUTME: Video recording engine for cursor trail export — SVG→canvas→MediaRecorder pipeline
// ABOUTME: Captures AnimatedTrails SVG frames at 30fps and encodes to WebM via MediaRecorder

import { svgToImageBitmap, triggerDownload } from "./portraitExport";

export interface RecordingOptions {
  width: number;
  height: number;
  /** If true, canvas background is transparent (VP9 alpha). If false, fills white. */
  transparent: boolean;
  onStop: (blob: Blob) => void;
}

/**
 * Start recording the given SVG element to a WebM video.
 * Returns a stopRecording() function.
 */
export function startRecording(
  svgEl: SVGSVGElement,
  options: RecordingOptions,
): () => void {
  const { width, height, transparent, onStop } = options;

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

  // Per-frame capture at 30fps via setInterval
  // svgToImageBitmap is async — skip frame if previous one is still in-flight
  let capturing = false;
  const intervalId = setInterval(async () => {
    if (capturing) return;
    capturing = true;
    try {
      if (!transparent) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
      const bitmap = await svgToImageBitmap(svgEl, width, height);
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
