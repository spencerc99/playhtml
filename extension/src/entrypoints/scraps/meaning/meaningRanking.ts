// ABOUTME: Compares search words against what the model saw in each scrap picture.
// ABOUTME: Pure helpers, so the cut-off and ordering can be tested without the model.

import type { ScrapItem } from "@movement/components/ScrapCollage";

/** Both vectors are unit length, so their dot product is how alike they are. */
export function similarity(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) sum += a[index] * b[index];
  return sum;
}

/** Each picture close enough to the words, with how close it is. */
export function meaningMatches(
  query: Float32Array,
  vectors: ReadonlyMap<string, Float32Array | null>,
  threshold: number,
): Map<string, number> {
  const matches = new Map<string, number>();
  for (const [src, vector] of vectors) {
    if (!vector) continue;
    const score = similarity(query, vector);
    if (score >= threshold) matches.set(src, score);
  }
  return matches;
}

/** The picture addresses the model has not looked at yet, newest scraps first. */
export function unreadPictures(
  items: readonly ScrapItem[],
  read: ReadonlyMap<string, unknown>,
): string[] {
  const newest = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "image" || !item.src || read.has(item.src)) continue;
    if (item.src.startsWith("data:image/svg")) continue;
    newest.set(item.src, Math.max(newest.get(item.src) ?? 0, item.ts));
  }
  return [...newest]
    .sort((first, second) => second[1] - first[1])
    .map(([src]) => src);
}
