// ABOUTME: Per-announcement seen-state stored in browser.storage.local.
// ABOUTME: Forward-only state machine: undefined → "toast-shown" → "dismissed".

import browser from "webextension-polyfill";
import { ANNOUNCEMENTS, type Announcement } from "./announcements";

export type AnnouncementState = "toast-shown" | "dismissed";

const KEY_PREFIX = "announcement_seen_";

function key(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export async function getState(id: string): Promise<AnnouncementState | undefined> {
  const stored = (await browser.storage.local.get(key(id))) as Record<string, unknown>;
  const v = stored[key(id)];
  if (v === "toast-shown" || v === "dismissed") return v;
  return undefined;
}

// Forward-only: dismissed locks in; toast-shown only writes if currently undefined.
export async function setState(id: string, next: AnnouncementState): Promise<void> {
  const current = await getState(id);
  if (current === "dismissed") return;
  if (current === "toast-shown" && next === "toast-shown") return;
  await browser.storage.local.set({ [key(id)]: next });
}

function urlMatches(a: Announcement, url: string): boolean {
  if (!a.relevantUrl) return true;
  return a.relevantUrl.test(url);
}

function byShippedAtDesc(a: Announcement, b: Announcement): number {
  return b.shippedAt - a.shippedAt;
}

export async function getToastCandidates(url: string): Promise<Announcement[]> {
  const out: Announcement[] = [];
  for (const a of ANNOUNCEMENTS) {
    if (!urlMatches(a, url)) continue;
    const s = await getState(a.id);
    if (s === undefined) out.push(a);
  }
  return out.sort(byShippedAtDesc);
}

export async function getPostcardCandidates(): Promise<Announcement[]> {
  const out: Announcement[] = [];
  for (const a of ANNOUNCEMENTS) {
    const s = await getState(a.id);
    if (s !== "dismissed") out.push(a);
  }
  return out.sort(byShippedAtDesc);
}
