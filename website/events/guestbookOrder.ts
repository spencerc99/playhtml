// ABOUTME: Orders event guestbook entries for display, newest first.
// ABOUTME: Returns a new array so the shared entry list is never reordered in place.

export function newestFirst<Entry>(entries: readonly Entry[]): Entry[] {
  return [...entries].reverse();
}
