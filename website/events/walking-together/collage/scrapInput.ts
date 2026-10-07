// ABOUTME: The scrap shape the table places, and the drag payload the walk's film strip carries.
// ABOUTME: Scraps only come from the strip, so the table accepts nothing else dropped on it.

/**
 * A scrap someone wants to put on the table. Pieces reference `src` directly;
 * nothing is uploaded. The only source is the film strip of scraps the
 * extension collected on this walk, by click or by dragging onto the table.
 */
export interface ScrapInput {
  src: string;
  pageUrl?: string;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

/** Drag type only the film strip sets, so images and links dragged in from
 * other tabs never light up or land on the table. */
export const SCRAP_DRAG_TYPE = "application/x-walk-scrap";

/** The subset of DataTransfer the parser reads, so tests can pass a plain object. */
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

export function scrapDragPayload(input: ScrapInput): string {
  return JSON.stringify(input);
}

/** True when a drag came from the film strip, so the drop target can light up
 * before the payload (unreadable during dragover) is known. */
export function isScrapDrag(types: ReadonlyArray<string>): boolean {
  return types.includes(SCRAP_DRAG_TYPE);
}

/** Reads a strip scrap back out of a drop, keeping only well-formed fields. */
export function scrapInputFromDrag(transfer: TransferLike): ScrapInput | null {
  if (!isScrapDrag(Array.from(transfer.types ?? []))) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(transfer.getData(SCRAP_DRAG_TYPE));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.src !== "string" || !isWebUrl(r.src)) return null;
  const size = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const w = size(r.naturalWidth);
  const h = size(r.naturalHeight);
  return {
    src: r.src,
    ...(typeof r.pageUrl === "string" && isWebUrl(r.pageUrl)
      ? { pageUrl: r.pageUrl }
      : {}),
    ...(typeof r.alt === "string" && r.alt ? { alt: r.alt } : {}),
    ...(w && h ? { naturalWidth: w, naturalHeight: h } : {}),
  };
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
