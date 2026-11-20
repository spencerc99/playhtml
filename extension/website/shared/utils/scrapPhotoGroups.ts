// ABOUTME: Folds repeat encounters of one scrap into a single item, keeping each source page and day.
// ABOUTME: Photos match by exact fingerprint or URL; other kinds match by the identity the caller passes.

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
  encounters: (SourcePage & { day: string })[];
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

/**
 * Folds the stored encounters of each scrap into one item: the newest record,
 * with every source page it was met on and the days it was met there. Photos
 * are matched by their fingerprint or URL. Other kinds are matched only when
 * `identify` names them, by the identity it returns; without it they pass
 * through untouched.
 */
export function groupScrapEncounters<T extends PhotoEncounter>(
  items: T[],
  identify?: (item: T) => string | undefined,
): T[] {
  const groups = new Map<string, T>();
  const sourcesByKey = new Map<string, Map<string, ScrapSource>>();
  const otherItems: T[] = [];
  for (const original of items) {
    let item = original;
    let key: string;
    if (original.kind === "image" && original.src) {
      const hash = isImageContentHash(original.contentHash)
        ? original.contentHash
        : undefined;
      if (hash) item = { ...original, key: `image:sha256:${hash}` };
      key = hash ? `image:sha256:${hash}` : canonicalImageKey(original.src);
    } else {
      const identity =
        original.kind === "image" ? undefined : identify?.(original);
      if (identity === undefined) {
        otherItems.push(original);
        continue;
      }
      key = `${original.kind}\u0000${identity}`;
    }
    const current = groups.get(key);
    if (!current || item.ts > current.ts) groups.set(key, item);
    let sources = sourcesByKey.get(key);
    if (!sources) {
      sources = new Map();
      sourcesByKey.set(key, sources);
    }
    for (const source of item.sources ?? [item]) {
      const pageKey = canonicalScrapPageUrl(source.pageUrl);
      const previous = sources.get(pageKey);
      // Standalone collage inputs without a capture day use UTC.
      const encountersByDay = new Map(
        (previous?.encounters ?? []).map((encounter) => [
          encounter.day,
          encounter,
        ]),
      );
      const incoming =
        "encounters" in source
          ? source.encounters
          : [
              {
                pageUrl: source.pageUrl,
                pageTitle: source.pageTitle,
                domain: source.domain,
                ts: source.ts,
                day: item.encounterDay ?? scrapEncounterDay(source.ts, "UTC"),
              },
            ];
      for (const encounter of incoming) {
        const existing = encountersByDay.get(encounter.day);
        if (!existing || encounter.ts > existing.ts)
          encountersByDay.set(encounter.day, encounter);
      }
      const encounters = [...encountersByDay.values()].sort(
        (a, b) => b.ts - a.ts,
      );
      const encounterDays = [...encountersByDay.keys()].sort();
      const latest = previous && previous.ts > source.ts ? previous : source;
      sources.set(pageKey, {
        pageUrl: latest.pageUrl,
        pageTitle: latest.pageTitle,
        domain: latest.domain,
        ts: latest.ts,
        encounters,
        encounterDays,
        encounterCount: encounterDays.length,
      });
    }
  }
  for (const [key, sources] of sourcesByKey) {
    groups.set(key, {
      ...groups.get(key)!,
      sources: [...sources.values()].sort((a, b) => b.ts - a.ts),
      encounterCount: [...sources.values()].reduce(
        (total, source) => total + source.encounterCount,
        0,
      ),
    });
  }

  return [...otherItems, ...groups.values()];
}

/** Folds repeat encounters of photos only; other kinds pass through untouched. */
export function groupPhotoEncounters<T extends PhotoEncounter>(
  items: T[],
): T[] {
  return groupScrapEncounters(items);
}
