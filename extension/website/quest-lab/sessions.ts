// ABOUTME: Splits a stream of image scraps into "quests": bursts of collecting separated by breaks.
// ABOUTME: Also drops the noise the meeting flagged (SVGs, icons, tiny images) before grouping.

import type { ImageScrap } from "./questions";

export interface Quest {
  id: string;
  start: number;
  end: number;
  scraps: ImageScrap[];
  domains: { domain: string; count: number }[];
}

export interface NoiseRules {
  dropSvg: boolean;
  minSide: number;
}

export function isNoise(scrap: ImageScrap, rules: NoiseRules): boolean {
  const src = scrap.src.toLowerCase();
  if (rules.dropSvg && (src.startsWith("data:image/svg") || /\.svg(\?|#|$)/.test(src))) {
    return true;
  }
  return Math.min(scrap.naturalWidth, scrap.naturalHeight) < rules.minSide;
}

/** One entry per image, keeping the first sighting when the same picture was seen again. */
function firstSightings(scraps: ImageScrap[]): ImageScrap[] {
  const seen = new Set<string>();
  return scraps.filter((scrap) => {
    const key = scrap.contentHash ?? scrap.src;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function splitQuests(
  scraps: ImageScrap[],
  gapMinutes: number,
  minScraps: number,
): Quest[] {
  const sorted = [...scraps].sort((a, b) => a.ts - b.ts);
  const groups: ImageScrap[][] = [];
  for (const scrap of sorted) {
    const current = groups[groups.length - 1];
    const last = current?.[current.length - 1];
    if (last && scrap.ts - last.ts <= gapMinutes * 60_000) current.push(scrap);
    else groups.push([scrap]);
  }
  return groups
    .map(firstSightings)
    .filter((group) => group.length >= minScraps)
    .map((group) => {
      const counts = new Map<string, number>();
      for (const scrap of group) counts.set(scrap.domain, (counts.get(scrap.domain) ?? 0) + 1);
      return {
        id: `quest-${group[0].ts}`,
        start: group[0].ts,
        end: group[group.length - 1].ts,
        scraps: group,
        domains: [...counts]
          .map(([domain, count]) => ({ domain, count }))
          .sort((a, b) => b.count - a.count),
      };
    })
    .reverse();
}
