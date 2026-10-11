// ABOUTME: Shared-state shape for the notes riders tuck under carriage seats.
// ABOUTME: Notes are keyed per seat so concurrent writers merge instead of clobbering.

export interface SeatNote {
  id: string;
  /** Author's playhtml colour — notes read as somebody's hand, not a username. */
  color: string;
  text: string;
  leftAt: number;
}

/** Keyed by note id, so concurrent riders never overwrite each other. */
export type SeatNoteStack = Record<string, SeatNote>;

/** Keyed by seat id, then by note id. */
export type SeatNotesData = Record<string, SeatNoteStack>;

/** How many notes one seat renders — a crowded seat stays legible. */
export const SEAT_NOTE_RENDER_LIMIT = 20;
/** How many notes one seat keeps at all, so the shared doc stays small. */
export const SEAT_NOTE_STORAGE_LIMIT = 40;
export const SEAT_NOTE_MAX_LENGTH = 160;

export function normalizeSeatNoteText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, SEAT_NOTE_MAX_LENGTH);
}

/** Most recent first — you read what was tucked there last. */
export function getSeatNotes(
  stack: SeatNoteStack | undefined,
  limit: number = SEAT_NOTE_RENDER_LIMIT,
): SeatNote[] {
  if (!stack) return [];
  return Object.values(stack)
    .sort((a, b) => b.leftAt - a.leftAt)
    .slice(0, limit);
}

/** Ids past the storage limit, oldest first. */
export function getOverflowNoteIds(
  stack: SeatNoteStack | undefined,
  limit: number = SEAT_NOTE_STORAGE_LIMIT,
): string[] {
  if (!stack) return [];
  const notes = Object.values(stack).sort((a, b) => a.leftAt - b.leftAt);
  const overflow = Math.max(0, notes.length - limit);
  return notes.slice(0, overflow).map((note) => note.id);
}

/** Notes yellow with age rather than disappearing. */
export function getNoteAgeLabel(leftAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - leftAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
