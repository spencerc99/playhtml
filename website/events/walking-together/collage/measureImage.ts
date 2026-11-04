// ABOUTME: Learns an image's natural size by loading it, for scraps sent without one.
// ABOUTME: Gives up quietly on a failed or slow load so callers fall back on a default shape.

/** Loads an image just to learn its shape. Resolves with null when it fails
 * or takes too long, so the caller can fall back on a default shape. */
export function measureImage(
  src: string,
  timeoutMs = 4000,
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    function finish(size: { width: number; height: number } | null) {
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(size);
    }
    img.onload = () =>
      finish(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null,
      );
    img.onerror = () => finish(null);
    img.src = src;
  });
}
