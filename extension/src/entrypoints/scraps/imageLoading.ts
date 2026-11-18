// ABOUTME: Loads the images a collage is drawn from, each within a time limit.
// ABOUTME: A stalled image host fails that one image instead of holding a bake, and a reopen waiting on it, open.

/**
 * How long an image host may stay silent, and how long a decode may take.
 * Past it the host is treated as stalled.
 */
export const IMAGE_LOAD_LIMIT_MS = 15_000;

function tooSlow(what: string, limitMs: number): Error {
  return new Error(`${what} within ${Math.round(limitMs / 1000)} seconds`);
}

/** Decodes an image from a URL the page can already read, within the limit. */
export async function loadImage(
  source: string,
  limitMs = IMAGE_LOAD_LIMIT_MS,
): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "sync";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image failed to decode"));
      timer = setTimeout(
        () => reject(tooSlow("the image did not decode", limitMs)),
        limitMs,
      );
      image.src = source;
    });
  } finally {
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
  }
  return image;
}

/**
 * Fetches an image's bytes, giving up on a host that goes quiet. The limit is
 * on silence, not on the whole download: each piece of the image that arrives
 * starts it again, so a large image on a slow connection still finishes.
 */
export async function fetchImageBlob(
  src: string,
  limitMs = IMAGE_LOAD_LIMIT_MS,
): Promise<Blob> {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), limitMs);
  const heard = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), limitMs);
  };
  try {
    const response = await fetch(src, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`fetch returned ${response.status}`);
    }
    heard();
    if (!response.body) return await response.blob();
    const reader = response.body.getReader();
    const parts: BlobPart[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      heard();
    }
    return new Blob(parts, {
      type: response.headers.get("content-type") ?? "",
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw tooSlow("the image stopped arriving", limitMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads a remote image through `fetch` so the bytes arrive as a same-origin
 * blob URL. The extension holds host permissions for all http/https, so this
 * keeps the canvas untainted where a plain crossorigin `<img>` would not.
 */
export async function loadRemoteImage(
  src: string,
  limitMs = IMAGE_LOAD_LIMIT_MS,
): Promise<HTMLImageElement> {
  if (src.startsWith("data:")) return loadImage(src, limitMs);
  const blob = await fetchImageBlob(src, limitMs);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await loadImage(objectUrl, limitMs);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
