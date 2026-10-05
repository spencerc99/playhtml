// ABOUTME: Turns things people bring to the table (dropped images, pasted links) into scraps.
// ABOUTME: Every scrap source produces a ScrapInput; the table only knows about ScrapInput.

/**
 * A scrap someone wants to put on the table, independent of where it came
 * from. Pieces reference `src` directly; nothing is uploaded.
 *
 * Sources today:
 *  - an image dragged in from another tab or window (`scrapInputFromDataTransfer`)
 *  - an image link pasted onto the page or typed into the link field
 *    (`scrapInputFromText`, `scrapInputFromDataTransfer` on clipboard data)
 *
 * A future "pick from your collection" source (scraps collected with the
 * browser extension) plugs in by producing ScrapInput values and handing them
 * to the table's `addScrap(input)`, the same entrypoint the sources above use.
 */
export interface ScrapInput {
  src: string;
  pageUrl?: string;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

/** The subset of DataTransfer the parsers read, so tests can pass a plain object. */
export interface TransferLike {
  getData(format: string): string;
  types: ReadonlyArray<string>;
}

/** Only absolute web URLs become scraps. data: and blob: URLs would either
 * embed the whole image in shared data or only resolve on one machine. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** First <img> in an HTML fragment, with the link around it when there is one. */
export function imageFromHtml(
  html: string,
): { src: string; alt?: string; href?: string } | null {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const img = doc.querySelector("img");
  const src = img?.getAttribute("src")?.trim();
  if (!img || !src || !isWebUrl(src)) return null;
  const href = img.closest("a")?.getAttribute("href")?.trim();
  const alt = img.getAttribute("alt")?.trim();
  return {
    src,
    ...(alt ? { alt } : {}),
    ...(href && isWebUrl(href) ? { href } : {}),
  };
}

/** URLs from a text/uri-list payload, skipping its comment lines. */
export function urisFromList(list: string): string[] {
  return list
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && isWebUrl(line));
}

/**
 * Reads an image out of a drag or paste payload. Prefers the <img> in the
 * HTML flavor (it carries the real image URL even when the image sat inside a
 * link), then falls back to a URL in uri-list or plain text.
 */
export function scrapInputFromDataTransfer(
  transfer: TransferLike,
): ScrapInput | null {
  const types = Array.from(transfer.types ?? []);
  if (types.includes("text/html")) {
    const image = imageFromHtml(transfer.getData("text/html"));
    if (image) {
      return {
        src: image.src,
        ...(image.alt ? { alt: image.alt } : {}),
        ...(image.href && image.href !== image.src
          ? { pageUrl: image.href }
          : {}),
      };
    }
  }
  if (types.includes("text/uri-list")) {
    const [first] = urisFromList(transfer.getData("text/uri-list"));
    if (first) return { src: first };
  }
  if (types.includes("text/plain")) {
    return scrapInputFromText(transfer.getData("text/plain"));
  }
  return null;
}

/** A pasted or typed image link. */
export function scrapInputFromText(text: string): ScrapInput | null {
  const trimmed = text.trim();
  if (!isWebUrl(trimmed)) return null;
  return { src: trimmed };
}

/** True when a drag carries something the table might accept, so the drop
 * target can light up before the payload (unreadable during dragover) is known. */
export function dragMayCarryScrap(types: ReadonlyArray<string>): boolean {
  return (
    types.includes("text/uri-list") ||
    types.includes("text/html") ||
    types.includes("text/plain")
  );
}

/** Loads an image just to learn its shape. Resolves with null when it fails
 * or takes too long, so a broken link still lands as a placeholder scrap. */
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
