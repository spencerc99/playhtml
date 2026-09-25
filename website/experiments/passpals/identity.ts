// ABOUTME: Derives a passpals room from a password without the password ever leaving the browser.
// ABOUTME: Also mints the default screen name and the accent color drawn for each handle.

export const ROOM_PREFIX = "passpals";
export const ROOM_HASH_LENGTH = 12;
export const MAX_HANDLE_LENGTH = 20;

/**
 * Folds away the differences that would otherwise scatter the same bad
 * password across several rooms. "Password1 " and "password1" are, socially
 * speaking, the same password, so they should be the same room.
 */
export function normalizePassword(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export function isUsablePassword(raw: string): boolean {
  return normalizePassword(raw).length > 0;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The room id is the only thing derived from the password that ever leaves
 * this machine. The password itself is never sent, never stored, and never
 * rendered for anyone but the person who typed it.
 */
export async function roomIdForPassword(raw: string): Promise<string> {
  const hex = await sha256Hex(normalizePassword(raw));
  return `${ROOM_PREFIX}-${hex.slice(0, ROOM_HASH_LENGTH)}`;
}

/**
 * A per-room, per-browser id used only to count how many people have passed
 * through. Salting with the room means the same browser is a different,
 * unlinkable id in every room it visits.
 */
export async function visitorIdForRoom(
  secret: string,
  roomId: string,
): Promise<string> {
  const hex = await sha256Hex(`${secret}::${roomId}`);
  return hex.slice(0, 12);
}

const HANDLE_ADJECTIVES = [
  "dialup",
  "midnight",
  "glitter",
  "static",
  "velvet",
  "pixel",
  "chrome",
  "feral",
  "neon",
  "sleepy",
  "hollow",
  "ultra",
  "plastic",
  "silver",
  "rusty",
  "quiet",
  "frostbit",
  "dusty",
  "spare",
  "lowfi",
];

const HANDLE_NOUNS = [
  "modem",
  "moth",
  "raccoon",
  "comet",
  "pager",
  "ghost",
  "saint",
  "mixtape",
  "sparrow",
  "bandit",
  "phantom",
  "tulip",
  "vulture",
  "cassette",
  "satellite",
  "crow",
  "lantern",
  "sprite",
  "harbor",
  "wolf",
];

function pick<T>(list: T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** A throwaway screen name in the register of the era the password came from. */
export function generateHandle(random: () => number = Math.random): string {
  const adjective = pick(HANDLE_ADJECTIVES, random);
  const noun = pick(HANDLE_NOUNS, random);
  const suffix = String(Math.floor(random() * 100)).padStart(2, "0");
  return `${adjective}_${noun}${suffix}`;
}

const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

export function sanitizeHandle(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\s+/g, "_")
    .slice(0, MAX_HANDLE_LENGTH)
    .trim();
}

export const HANDLE_COLORS = [
  "#111111",
  "#2b4fe8",
  "#c42348",
  "#d9480f",
  "#0b7a75",
  "#6d28d9",
];

/** Stable per handle, so the same person keeps the same color for everyone. */
export function colorForHandle(handle: string): string {
  let hash = 5381;
  for (let i = 0; i < handle.length; i++) {
    hash = ((hash << 5) + hash + handle.charCodeAt(i)) >>> 0;
  }
  return HANDLE_COLORS[hash % HANDLE_COLORS.length];
}
