// ABOUTME: Groups identical photos for display while retaining distinct source pages.
// ABOUTME: Uses exact fingerprints when available and URL identity for unchecked photos.

import {
  canonicalImageKey,
  canonicalScrapPageUrl,
  isImageContentHash,
} from "./scrapIdentity";

import { scrapEncounterDay } from "./scrapEncounterDay";

interface SourcePage {
  pageUrl: string;
  pageTitle: string;
  domain: string;
  ts: number;
}

export interface ScrapSource extends SourcePage {
  encounterDays: string[];
  encounterCount: number;
}

type PhotoEncounter = SourcePage & {
  encounterDay?: string;
  encounterCount?: number;
  kind: string;
  src?: string;
  contentHash?: string;
  sources?: ScrapSource[];
};

export function groupPhotoEncounters<T extends PhotoEncounter>(
  items: T[],
): T[] {
  const hashesByUrl = new Map<string, { hash: string; ts: number }>();
  for (const item of items) {
    if (
      item.kind !== "image" ||
      !item.src ||
      !isImageContentHash(item.contentHash)
    )
      continue;
    const url = canonicalImageKey(item.src);
    const current = hashesByUrl.get(url);
    if (!current || item.ts > current.ts)
      hashesByUrl.set(url, { hash: item.contentHash, ts: item.ts });
  }
  const photos = new Map<string, T>();
  const sourcesByKey = new Map<string, Map<string, ScrapSource>>();
  const otherItems: T[] = [];
  for (const original of items) {
    if (original.kind !== "image" || !original.src) {
      otherItems.push(original);
      continue;
    }
    const hash = isImageContentHash(original.contentHash)
      ? original.contentHash
      : hashesByUrl.get(canonicalImageKey(original.src))?.hash;
    const item = hash ? { ...original, contentHash: hash } : original;
    const key = hash ? `image:sha256:${hash}` : canonicalImageKey(original.src);
    const current = photos.get(key);
    if (!current || item.ts > current.ts) photos.set(key, item);
    let sources = sourcesByKey.get(key);
    if (!sources) {
      sources = new Map();
      sourcesByKey.set(key, sources);
    }
    for (const source of item.sources ?? [item]) {
      const pageKey = canonicalScrapPageUrl(source.pageUrl);
      const previous = sources.get(pageKey);
      // Standalone collage inputs without a capture day use UTC.
      const days =
        "encounterDays" in source
          ? source.encounterDays
          : [item.encounterDay ?? scrapEncounterDay(source.ts, "UTC")];
      const encounterDays = [
        ...new Set([...(previous?.encounterDays ?? []), ...days]),
      ].sort();
      const latest = previous && previous.ts > source.ts ? previous : source;
      sources.set(pageKey, {
        pageUrl: latest.pageUrl,
        pageTitle: latest.pageTitle,
        domain: latest.domain,
        ts: latest.ts,
        encounterDays,
        encounterCount: encounterDays.length,
      });
    }
  }
  for (const [key, sources] of sourcesByKey) {
    photos.set(key, {
      ...photos.get(key)!,
      sources: [...sources.values()].sort((a, b) => b.ts - a.ts),
      encounterCount: [...sources.values()].reduce(
        (total, source) => total + source.encounterCount,
        0,
      ),
    });
  }

  return [...otherItems, ...photos.values()];
}
