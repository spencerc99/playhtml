// ABOUTME: Slowly scrolls a horizontal band back and forth so touch visitors see it holds more.
// ABOUTME: Runs only while the band is on screen and the tab is visible, and yields to the visitor's own scrolling.

const PIXELS_PER_SECOND = 16;
const USER_SCROLL_PAUSE_MS = 4000;

/**
 * Starts the auto-scroll on `viewport` and returns a function that stops it.
 * No animation frames are requested while the band is offscreen or the tab is
 * hidden; it picks up from where it was when it returns.
 */
export function startBandAutoScroll(viewport: HTMLElement): () => void {
  const maxScroll = viewport.scrollWidth - viewport.clientWidth;
  if (maxScroll <= 4) return () => {};

  let rafId: number | null = null;
  let direction = 1;
  let paused = false;
  let onScreen = false;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTime = 0;

  const tick = (now: number) => {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!paused) {
      const next = viewport.scrollLeft + direction * PIXELS_PER_SECOND * dt;
      if (next >= maxScroll) {
        viewport.scrollLeft = maxScroll;
        direction = -1;
      } else if (next <= 0) {
        viewport.scrollLeft = 0;
        direction = 1;
      } else {
        viewport.scrollLeft = next;
      }
    }
    rafId = requestAnimationFrame(tick);
  };

  const update = () => {
    const shouldRun = onScreen && document.visibilityState === "visible";
    if (shouldRun && rafId === null) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    } else if (!shouldRun && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const observer = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    onScreen = entry.isIntersecting;
    update();
  });
  observer.observe(viewport);
  document.addEventListener("visibilitychange", update);

  const pauseForUserScroll = () => {
    paused = true;
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      paused = false;
      lastTime = performance.now();
    }, USER_SCROLL_PAUSE_MS);
  };
  viewport.addEventListener("touchstart", pauseForUserScroll, {
    passive: true,
  });
  viewport.addEventListener("wheel", pauseForUserScroll, { passive: true });

  return () => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", update);
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    if (resumeTimer) clearTimeout(resumeTimer);
    viewport.removeEventListener("touchstart", pauseForUserScroll);
    viewport.removeEventListener("wheel", pauseForUserScroll);
  };
}
