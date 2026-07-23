// ABOUTME: URL-hash <-> editor state, lz-string remix encoding, and localStorage
// ABOUTME: management for editor room ids and source drafts.
import LZString from "lz-string";
import type { RunnableRecipe } from "./recipes/types";

export type LoadedRecipe = {
  /** Base recipe id (e.g. "_starter" or "synchronized-sound"). */
  recipeId: string;
  /** Current source code in the editor. */
  source: string;
  /** Room id the iframe should join. */
  roomId: string;
  /** True if this load came from a URL payload (i.e., a remix from someone else). */
  fromPayload: boolean;
};

const DRAFT_PREFIX = "playhtml:play:draft:";
const ROOM_PREFIX = "playhtml:editor-room:";
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type DraftRecord = { source: string; updatedAt: number };

type Payload = {
  v: 1;
  sessionId: string;
  recipeId: string;
  files: { "index.html": string };
};

/**
 * Generate 8 random hex chars for a room-id suffix. Uses crypto.randomUUID
 * (browsers ≥ 2021) and slices the leading hex characters.
 */
function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/**
 * Get-or-mint the editor room id for a recipe. All of one user's tabs of
 * the same recipe land in the same room (multi-tab testing works).
 */
export function getEditorRoomId(recipeId: string): string {
  if (typeof localStorage === "undefined") {
    // SSR or storage-blocked context — fall back to a per-call ephemeral id
    return `edit-${recipeId}-${randomSuffix()}`;
  }
  const key = ROOM_PREFIX + recipeId;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const fresh = `edit-${recipeId}-${randomSuffix()}`;
  localStorage.setItem(key, fresh);
  return fresh;
}

/**
 * Parse the current URL hash and resolve to the recipe to load. Falls back
 * to the provided default when no recognized hash is present.
 *
 * Hash forms:
 *   (empty)            → fallback recipe
 *   #id=<recipe>       → canonical recipe
 *   #c=<lz-payload>    → remix payload
 */
export function parseHash(
  hash: string,
  findRecipe: (id: string) => RunnableRecipe | undefined,
  fallbackRecipe: RunnableRecipe,
): LoadedRecipe {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(stripped);

  const compressed = params.get("c");
  if (compressed) {
    const payload = decodePayload(compressed);
    if (payload) {
      return {
        recipeId: payload.recipeId,
        source: payload.files["index.html"],
        roomId: `recipe:${payload.recipeId}:${payload.sessionId}`,
        fromPayload: true,
      };
    }
    // Malformed payload — fall through to the canonical default.
  }

  const requestedId = params.get("id") || fallbackRecipe.id;
  const recipe = findRecipe(requestedId);
  if (recipe) {
    return {
      recipeId: recipe.id,
      source: recipe.html,
      roomId: getRequestedRoomId(params) || getEditorRoomId(recipe.id),
      fromPayload: false,
    };
  }

  console.warn(
    `[playground] Unknown recipe id "${requestedId}" — falling back to ${fallbackRecipe.id}.`,
  );
  return {
    recipeId: fallbackRecipe.id,
    source: fallbackRecipe.html,
    roomId: getRequestedRoomId(params) || getEditorRoomId(fallbackRecipe.id),
    fromPayload: false,
  };
}

function getRequestedRoomId(params: URLSearchParams): string | null {
  const room = params.get("room");
  if (!room) return null;
  return /^[a-zA-Z0-9:_-]{1,120}$/.test(room) ? room : null;
}

/**
 * Build a hash payload for the current source. Returns the new hash
 * (without leading #) or null if the compressed size would exceed the
 * URL ceiling.
 */
export function encodeHashPayload(args: {
  recipeId: string;
  sessionId: string;
  source: string;
}): { hash: string; sizeBytes: number; tooLarge: boolean } {
  const payload: Payload = {
    v: 1,
    sessionId: args.sessionId,
    recipeId: args.recipeId,
    files: { "index.html": args.source },
  };
  const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
  const tooLarge = compressed.length > 2000;
  return {
    hash: `c=${compressed}`,
    sizeBytes: compressed.length,
    tooLarge,
  };
}

function decodePayload(compressed: string): Payload | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(compressed);
    if (!json) return null;
    const parsed = JSON.parse(json) as Payload;
    if (parsed?.v !== 1 || !parsed.files?.["index.html"] || !parsed.sessionId || !parsed.recipeId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save a draft of the current in-progress source. Called on every
 * debounced edit. Skipped when the source matches the canonical recipe.
 */
export function saveDraft(recipeId: string, source: string, canonicalSource: string): void {
  if (typeof localStorage === "undefined") return;
  if (source === canonicalSource) {
    // No edits — clear any existing draft to prevent stale restore banners.
    localStorage.removeItem(DRAFT_PREFIX + recipeId);
    return;
  }
  const record: DraftRecord = { source, updatedAt: Date.now() };
  localStorage.setItem(DRAFT_PREFIX + recipeId, JSON.stringify(record));
}

/**
 * Read the draft for a recipe, if one exists and is fresh. Returns null
 * if there is no draft, the draft is stale, or storage is unavailable.
 */
export function loadDraft(recipeId: string): DraftRecord | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(DRAFT_PREFIX + recipeId);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as DraftRecord;
    if (Date.now() - record.updatedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_PREFIX + recipeId);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

/** Discard the draft for a recipe without saving anything. */
export function discardDraft(recipeId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(DRAFT_PREFIX + recipeId);
}

/**
 * Remove drafts older than 30 days. Called once on editor mount so
 * abandoned localStorage doesn't grow unbounded.
 */
export function pruneStaleDrafts(): void {
  if (typeof localStorage === "undefined") return;
  const now = Date.now();
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
    try {
      const record = JSON.parse(localStorage.getItem(key) || "") as DraftRecord;
      if (now - record.updatedAt > DRAFT_TTL_MS) {
        toRemove.push(key);
      }
    } catch {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
}

/**
 * Format a "minutes/hours/days ago" string for the draft restore banner.
 */
export function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
