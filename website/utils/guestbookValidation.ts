// ABOUTME: Defines validation helpers for homepage guestbook form fields.
// ABOUTME: Keeps visitor names limited to characters the homepage accepts.

const GuestbookNameCharacters = /[^a-z0-9]/gi;
const GuestbookNamePattern = /^[a-z0-9]+$/i;

export function sanitizeGuestbookName(name: string): string {
  return name.replace(GuestbookNameCharacters, "");
}

export function isGuestbookNameAllowed(name: string): boolean {
  return GuestbookNamePattern.test(name);
}
