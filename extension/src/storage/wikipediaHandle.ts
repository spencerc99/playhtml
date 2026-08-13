// ABOUTME: Owns the persisted Wikipedia article-name used by live chat.
// ABOUTME: Serializes reads and writes so simultaneous tabs share one name.

import browser from "webextension-polyfill";
import { containsProfanity } from "@movement/profanity";

const STORAGE_KEY = "wiki_chat_handle";
const RANDOM_URL = "https://en.wikipedia.org/api/rest_v1/page/random/summary";
const MAX_ROLL_RETRIES = 5;
const FALLBACK = "Anonymous";

let operations: Promise<void> = Promise.resolve();

export function _resetWikipediaHandleForTest(): void {
  operations = Promise.resolve();
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation, operation);
  operations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function rollOnce(): Promise<string | null> {
  try {
    const response = await fetch(RANDOM_URL);
    if (!response.ok) return null;
    const data = (await response.json()) as { title?: string };
    if (typeof data.title !== "string" || data.title.length === 0) return null;
    return data.title;
  } catch {
    return null;
  }
}

async function rollHandle(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ROLL_RETRIES; attempt++) {
    const title = await rollOnce();
    if (title && !containsProfanity(title)) return title;
  }
  return FALLBACK;
}

async function persistHandle(handle: string): Promise<string> {
  await browser.storage.local.set({ [STORAGE_KEY]: handle });
  return handle;
}

export function getOrCreateWikipediaHandle(): Promise<string> {
  return enqueue(async () => {
    const stored = (await browser.storage.local.get(STORAGE_KEY)) as Record<
      string,
      unknown
    >;
    const existing = stored[STORAGE_KEY];
    if (typeof existing === "string" && existing.length > 0) return existing;
    return persistHandle(await rollHandle());
  });
}

export function rerollWikipediaHandle(): Promise<string> {
  return enqueue(async () => persistHandle(await rollHandle()));
}

export function setWikipediaHandle(title: string): Promise<string> {
  return enqueue(async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || containsProfanity(trimmed)) {
      return persistHandle(await rollHandle());
    }
    return persistHandle(trimmed);
  });
}
