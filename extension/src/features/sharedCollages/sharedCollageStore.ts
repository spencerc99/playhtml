// ABOUTME: Keeps the shared collages this person started or joined, so their collage list can show them.
// ABOUTME: Only a summary and thumbnail live here; the collage itself lives in its shared room.

import browser from "webextension-polyfill";
import {
  ALLOW_LOCAL_SESSION_SCRAPS_PAGES,
  isSharedCollagePageUrl,
} from "../sessionScraps/sessionScrapsBridge";
import {
  mergeSharedCollageEntry,
  parseSharedCollageEntry,
  type SharedCollageEntry,
} from "./sharedCollageEntry";

export const SHARED_COLLAGES_STORAGE_KEY = "sharedCollages";

function isPageUrl(url: string): boolean {
  return isSharedCollagePageUrl(url, ALLOW_LOCAL_SESSION_SCRAPS_PAGES);
}

async function readAll(): Promise<Record<string, SharedCollageEntry>> {
  const stored = await browser.storage.local.get(SHARED_COLLAGES_STORAGE_KEY);
  const raw = stored[SHARED_COLLAGES_STORAGE_KEY];
  if (!raw || typeof raw !== "object") return {};
  const entries: Record<string, SharedCollageEntry> = {};
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const entry = parseSharedCollageEntry(value, isPageUrl);
    if (entry) entries[entry.id] = entry;
  }
  return entries;
}

/** Every shared collage this person has been part of, most recently changed first. */
export async function listSharedCollages(): Promise<SharedCollageEntry[]> {
  return Object.values(await readAll()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

/** Adds or refreshes one shared collage; returns false when the entry is not one. */
export async function rememberSharedCollage(value: unknown): Promise<boolean> {
  const entry = parseSharedCollageEntry(value, isPageUrl);
  if (!entry) return false;
  const entries = await readAll();
  entries[entry.id] = mergeSharedCollageEntry(entries[entry.id], entry);
  await browser.storage.local.set({ [SHARED_COLLAGES_STORAGE_KEY]: entries });
  return true;
}

/** Takes a shared collage out of this person's list; the collage itself stays for everyone else. */
export async function forgetSharedCollage(id: string): Promise<void> {
  const entries = await readAll();
  delete entries[id];
  await browser.storage.local.set({ [SHARED_COLLAGES_STORAGE_KEY]: entries });
}
