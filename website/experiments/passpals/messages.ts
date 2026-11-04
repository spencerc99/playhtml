// ABOUTME: Shapes and bounds the two kinds of writing in a passpals room.
// ABOUTME: Transmissions fade after an hour; letters stay for whoever arrives next.

export const TRANSMISSION_TTL_MS = 60 * 60 * 1000;
export const MAX_TRANSMISSIONS = 200;
export const MAX_LETTERS = 200;
export const MAX_BODY_LENGTH = 280;

export interface Entry {
  id: string;
  handle: string;
  body: string;
  at: number;
}

const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

export function sanitizeBody(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_BODY_LENGTH);
}

export function makeId(random: () => number = Math.random): string {
  return `${Date.now().toString(36)}-${Math.floor(random() * 1e9).toString(36)}`;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<Entry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.handle === "string" &&
    typeof entry.body === "string" &&
    typeof entry.at === "number" &&
    Number.isFinite(entry.at)
  );
}

/** Read-side view: drop anything malformed or older than the fade window. */
export function activeTransmissions(
  entries: unknown[],
  now: number,
  ttlMs: number = TRANSMISSION_TTL_MS,
): Entry[] {
  return entries.filter(
    (entry): entry is Entry => isEntry(entry) && now - entry.at < ttlMs,
  );
}

/**
 * How many entries to drop from the front so the stored list stays bounded.
 * Returned as a count rather than a new array because the write path splices
 * the shared draft in place.
 */
export function overflowCount(length: number, max: number): number {
  return Math.max(0, length - max);
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Letters are dated by distance, not by clock — the point is how long ago. */
export function formatAge(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60 * 1000) return "just now";
  if (elapsed < 60 * 60 * 1000) {
    const minutes = Math.floor(elapsed / (60 * 1000));
    return `${minutes} min ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / (60 * 60 * 1000));
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 365) return days === 1 ? "1 day ago" : `${days} days ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export function sortedLetters(entries: unknown[]): Entry[] {
  return entries.filter(isEntry).sort((a, b) => b.at - a.at);
}
