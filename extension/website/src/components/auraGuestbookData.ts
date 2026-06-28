// ABOUTME: Data helpers for the aura guestbook card pile and visitor dots.
// ABOUTME: Keeps visitor colors and card indexes stable for the corkboard.

export interface GuestbookEntry {
  name: string;
  color: string;
  message: string;
  timestamp: number;
}

export function appendGuestbookEntry(
  entries: GuestbookEntry[],
  entry: GuestbookEntry,
): void {
  entries.push(entry);
}

export function getGuestbookDotColors(entries: GuestbookEntry[]): string[] {
  const sortedEntries = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const seen = new Set<string>();
  const colors: string[] = [];

  for (const entry of sortedEntries.reverse()) {
    if (!seen.has(entry.color)) {
      seen.add(entry.color);
      colors.push(entry.color);
    }
  }

  return colors;
}

export function getRenderedPileCardIndexes(
  sortedEntries: GuestbookEntry[],
  pileLimit: number,
  hoveredColor: string | null,
): number[] {
  const start = Math.max(0, sortedEntries.length - pileLimit);
  const indexes: number[] = [];

  for (let index = start; index < sortedEntries.length; index++) {
    indexes.push(index);
  }

  if (hoveredColor === null) return indexes;
  if (indexes.some((index) => sortedEntries[index].color === hoveredColor)) {
    return indexes;
  }

  for (let index = sortedEntries.length - 1; index >= 0; index--) {
    if (sortedEntries[index].color === hoveredColor) {
      indexes.push(index);
      break;
    }
  }

  return indexes;
}

export function getLoopedEntryIndex(
  currentIndex: number,
  entryCount: number,
  direction: number,
): number {
  if (entryCount === 0) return currentIndex;
  return (currentIndex + direction + entryCount) % entryCount;
}
