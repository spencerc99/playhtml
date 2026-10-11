// ABOUTME: Runs in embedded frames only and relays their activity to the top frame.
// ABOUTME: The top frame's NavigationCollector uses it to avoid marking an active page idle.

import {
  FRAME_ACTIVITY_MESSAGE,
  startFrameActivityRelay,
} from '../features/frameActivity';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (window === window.top) return;
    startFrameActivityRelay(() => {
      browser.runtime
        .sendMessage({ type: FRAME_ACTIVITY_MESSAGE })
        .catch(() => {
          // Extension reloaded or the background is unavailable; nothing to do
        });
    });
  },
});
