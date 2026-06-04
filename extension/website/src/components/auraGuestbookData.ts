// ABOUTME: Data helpers for the aura guestbook card pile and visitor dots.
// ABOUTME: Keeps dot colors aligned with the cards rendered on the corkboard.

export interface GuestbookEntry {
  name: string;
  color: string;
  message: string;
  timestamp: number;
}

export function getPileDotColors(
  entries: GuestbookEntry[],
  pileLimit: number,
): string[] {
  const sortedEntries = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const start = Math.max(0, sortedEntries.length - pileLimit);
  const seen = new Set<string>();
  const colors: string[] = [];

  for (const entry of sortedEntries.slice(start).reverse()) {
    if (!seen.has(entry.color)) {
      seen.add(entry.color);
      colors.push(entry.color);
    }
  }

  return colors;
}

export function getLoopedEntryIndex(
  currentIndex: number,
  entryCount: number,
  direction: number,
): number {
  if (entryCount === 0) return currentIndex;
  return (currentIndex + direction + entryCount) % entryCount;
}
