// ABOUTME: Random Wikipedia-article handle for chat. Persists to browser.storage.local.
// ABOUTME: Filters profane rolls; falls back to "Anonymous" on persistent failure.

import browser from "webextension-polyfill";
import { containsProfanity } from "@movement/profanity";

const STORAGE_KEY = "wiki_chat_handle";
const RANDOM_URL = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
const MAX_ROLL_RETRIES = 5;
const FALLBACK = "Anonymous";

let cached: string | null = null;

export function _resetForTest(): void {
  cached = null;
}

async function rollOnce(): Promise<string | null> {
  try {
    const res = await fetch(RANDOM_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    if (typeof data.title !== "string" || data.title.length === 0) return null;
    return data.title;
  } catch {
    return null;
  }
}

async function rollHandle(): Promise<string> {
  for (let i = 0; i < MAX_ROLL_RETRIES; i++) {
    const title = await rollOnce();
    if (title && !containsProfanity(title)) return title;
  }
  return FALLBACK;
}

export async function getOrCreateHandle(): Promise<string> {
  if (cached) return cached;
  const stored = (await browser.storage.local.get(STORAGE_KEY)) as Record<string, unknown>;
  const existing = stored[STORAGE_KEY];
  if (typeof existing === "string" && existing.length > 0) {
    cached = existing;
    return existing;
  }
  const fresh = await rollHandle();
  cached = fresh;
  await browser.storage.local.set({ [STORAGE_KEY]: fresh });
  return fresh;
}

export async function rerollHandle(): Promise<string> {
  const fresh = await rollHandle();
  cached = fresh;
  await browser.storage.local.set({ [STORAGE_KEY]: fresh });
  return fresh;
}
