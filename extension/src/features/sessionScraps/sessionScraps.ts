// ABOUTME: Picks the image scraps from one stretch of browsing, for pages that collage "what you just browsed".
// ABOUTME: Pure selection over newest-first scraps: an explicit time window, or the latest burst before a long break.

/** The fields of an image scrap a hosted collage page receives. Nothing else leaves the extension. */
export interface SessionScrap {
  id: string;
  src: string;
  /** Only the origin of the page the scrap came from; its path, query and fragment stay behind. */
  pageUrl: string;
  alt?: string;
  width: number;
  height: number;
  capturedAt: number;
}

/** An image scrap as the background reads it, before it is trimmed for a page. */
export interface SessionScrapCandidate {
  id: string;
  src: string;
  pageUrl: string;
  ts: number;
  alt?: string;
  naturalWidth: number;
  naturalHeight: number;
  contentHash?: string;
}

/** A break this long between two scraps ends a browsing session. */
export const SESSION_GAP_MS = 45 * 60_000;
/** The furthest back a page can ask for, so it can never read a whole history. */
export const SESSION_LOOKBACK_MS = 12 * 60 * 60_000;
/**
 * The most scraps one answer carries: well above what a busy hour of browsing
 * collects, so it only guards against a runaway answer.
 */
export const SESSION_SCRAP_LIMIT = 2000;

export interface SessionWindow {
  start: number;
  end: number;
}

export interface SessionScrapsAnswer {
  scraps: SessionScrap[];
  window: SessionWindow | null;
}

/** Only web images travel: data: and blob: URLs would only resolve on this machine. */
function isWebImage(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/**
 * A page's address can carry private paths, document ids or tokens, and the
 * collage only shows where a scrap came from, so only the origin travels.
 */
export function pageOrigin(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/** The window a page asked for, clamped to the lookback and to now. */
export function clampWindow(
  now: number,
  since?: number,
  until?: number,
): SessionWindow {
  const floor = now - SESSION_LOOKBACK_MS;
  const start = Math.max(floor, Number.isFinite(since) ? (since as number) : floor);
  const end = Math.min(now, Number.isFinite(until) ? (until as number) : now);
  return { start, end: Math.max(start, end) };
}

/**
 * Chooses the scraps to hand over. `newestFirst` must already be limited to
 * the lookback. With `since`, everything inside the window counts. Without
 * it, the session is the newest scrap and every scrap before it until a break
 * longer than `SESSION_GAP_MS`. The same picture seen twice counts once.
 */
export function selectSessionScraps(
  newestFirst: readonly SessionScrapCandidate[],
  options: { now: number; since?: number; until?: number },
): SessionScrapsAnswer {
  const asked = clampWindow(options.now, options.since, options.until);
  const inRange = newestFirst.filter(
    (scrap) => scrap.ts >= asked.start && scrap.ts <= asked.end && isWebImage(scrap.src),
  );

  let session = inRange;
  if (!Number.isFinite(options.since) && inRange.length > 0) {
    session = [inRange[0]];
    for (let index = 1; index < inRange.length; index += 1) {
      if (inRange[index - 1].ts - inRange[index].ts > SESSION_GAP_MS) break;
      session.push(inRange[index]);
    }
  }
  if (session.length === 0) return { scraps: [], window: null };

  const seen = new Set<string>();
  const scraps: SessionScrap[] = [];
  for (const scrap of session) {
    const key = scrap.contentHash ?? scrap.src;
    if (seen.has(key)) continue;
    seen.add(key);
    scraps.push({
      id: scrap.id,
      src: scrap.src,
      pageUrl: pageOrigin(scrap.pageUrl),
      ...(scrap.alt ? { alt: scrap.alt } : {}),
      width: scrap.naturalWidth,
      height: scrap.naturalHeight,
      capturedAt: scrap.ts,
    });
    if (scraps.length >= SESSION_SCRAP_LIMIT) break;
  }
  return {
    scraps,
    window: {
      start: Number.isFinite(options.since) ? asked.start : session[session.length - 1].ts,
      end: Number.isFinite(options.since) ? asked.end : session[0].ts,
    },
  };
}
