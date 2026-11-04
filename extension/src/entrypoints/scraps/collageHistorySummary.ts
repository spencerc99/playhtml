// ABOUTME: The one line under the history heading that sums up every saved collage.
// ABOUTME: Counts collages, pieces and distinct source pages, and names the newest one's day.

import type { CollageSummary } from "./collageRecord";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The collage made most recently, whose picture fronts the history heading. */
export function newestCollage(
  collages: readonly CollageSummary[],
): CollageSummary | null {
  return collages.reduce<CollageSummary | null>(
    (newest, collage) =>
      !newest || collage.createdAt > newest.createdAt ? collage : newest,
    null,
  );
}

/**
 * "3 collages · 41 pieces from 17 pages · last one Sep 22", or "nothing made
 * yet" before the first. A page used by several collages counts once.
 */
export function collagesSummaryLine(
  collages: readonly CollageSummary[],
): string {
  const newest = newestCollage(collages);
  if (!newest) return "nothing made yet";
  const pieces = collages.reduce((total, collage) => total + collage.pieceCount, 0);
  const pages = new Set(collages.flatMap((collage) => collage.sourcePages)).size;
  const day = new Date(newest.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return [
    plural(collages.length, "collage", "collages"),
    `${plural(pieces, "piece", "pieces")} from ${plural(pages, "page", "pages")}`,
    `last one ${day}`,
  ].join(" \u00b7 ");
}
