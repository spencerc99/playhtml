// ABOUTME: Reports input and playing media inside embedded frames to the top frame.
// ABOUTME: Keeps screen time running while someone watches an embed or works in an embedded app.

import { isMediaPlaying } from '../utils/media';

export const FRAME_ACTIVITY_MESSAGE = 'FRAME_ACTIVITY';

/** At most one relay per interval: the idle timeout is minutes, not seconds. */
export const FRAME_ACTIVITY_THROTTLE_MS = 30_000;

const INPUT_EVENTS = [
  'pointermove',
  'pointerdown',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
] as const;

/**
 * Listen for input and media playback in this frame and call `report` at most
 * once per FRAME_ACTIVITY_THROTTLE_MS while either is happening.
 * Returns a cleanup function.
 */
export function startFrameActivityRelay(report: () => void): () => void {
  let lastReportTs = -Infinity;
  let mediaTimer: ReturnType<typeof setInterval> | null = null;

  const reportThrottled = () => {
    const now = Date.now();
    if (now - lastReportTs < FRAME_ACTIVITY_THROTTLE_MS) return;
    lastReportTs = now;
    report();
  };

  const stopMediaTimer = () => {
    if (mediaTimer !== null) {
      clearInterval(mediaTimer);
      mediaTimer = null;
    }
  };

  // Media events don't bubble, so listen in the capture phase
  const onPlaying = () => {
    reportThrottled();
    if (mediaTimer !== null) return;
    mediaTimer = setInterval(() => {
      if (isMediaPlaying()) reportThrottled();
      else stopMediaTimer();
    }, FRAME_ACTIVITY_THROTTLE_MS);
  };

  const options = { capture: true, passive: true };
  for (const type of INPUT_EVENTS) {
    window.addEventListener(type, reportThrottled, options);
  }
  document.addEventListener('playing', onPlaying, options);

  return () => {
    for (const type of INPUT_EVENTS) {
      window.removeEventListener(type, reportThrottled, { capture: true });
    }
    document.removeEventListener('playing', onPlaying, { capture: true });
    stopMediaTimer();
  };
}
