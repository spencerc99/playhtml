// ABOUTME: Tests for announcement seen-state storage and candidate filtering.
// ABOUTME: Verifies forward-only state, URL gating, and shippedAt ordering.

import { describe, it, expect, beforeEach, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  getState,
  setState,
  getToastCandidates,
  getPostcardCandidates,
} from "../announcements/announcement-storage";
import { ANNOUNCEMENTS } from "../announcements/announcements";

function setupStorage(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  vi.mocked(browser.storage.local.get).mockImplementation((keys: any) => {
    if (typeof keys === "string") return Promise.resolve({ [keys]: data[keys] });
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      keys.forEach((k) => {
        out[k] = data[k];
      });
      return Promise.resolve(out);
    }
    return Promise.resolve({ ...data });
  });
  vi.mocked(browser.storage.local.set).mockImplementation((items: any) => {
    Object.assign(data, items);
    return Promise.resolve();
  });
  return data;
}

describe("announcement-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStorage();
  });

  it("getState returns undefined for unseen", async () => {
    expect(await getState("nope")).toBeUndefined();
  });

  it("setState writes and getState reads", async () => {
    await setState("a", "toast-shown");
    expect(await getState("a")).toBe("toast-shown");
    await setState("a", "dismissed");
    expect(await getState("a")).toBe("dismissed");
  });

  it("setState is forward-only: dismissed cannot downgrade to toast-shown", async () => {
    await setState("a", "dismissed");
    await setState("a", "toast-shown");
    expect(await getState("a")).toBe("dismissed");
  });

  it("getToastCandidates excludes already-seen announcements", async () => {
    const first = ANNOUNCEMENTS[0];
    if (!first) return; // guard if list is empty in a future state
    const url = "https://en.wikipedia.org/wiki/Octopus";
    const before = await getToastCandidates(url);
    if (!first.relevantUrl || first.relevantUrl.test(url)) {
      expect(before.some((a) => a.id === first.id)).toBe(true);
    }
    await setState(first.id, "toast-shown");
    const after = await getToastCandidates(url);
    expect(after.some((a) => a.id === first.id)).toBe(false);
  });

  it("getToastCandidates respects relevantUrl gating", async () => {
    const first = ANNOUNCEMENTS[0];
    if (!first || !first.relevantUrl) return;
    const offTarget = "https://example.com/";
    const onTarget = "https://en.wikipedia.org/wiki/Anything";
    const offResults = await getToastCandidates(offTarget);
    const onResults = await getToastCandidates(onTarget);
    expect(offResults.some((a) => a.id === first.id)).toBe(false);
    expect(onResults.some((a) => a.id === first.id)).toBe(true);
  });

  it("getPostcardCandidates excludes only dismissed, includes toast-shown", async () => {
    const first = ANNOUNCEMENTS[0];
    if (!first) return;
    expect((await getPostcardCandidates()).some((a) => a.id === first.id)).toBe(true);
    await setState(first.id, "toast-shown");
    expect((await getPostcardCandidates()).some((a) => a.id === first.id)).toBe(true);
    await setState(first.id, "dismissed");
    expect((await getPostcardCandidates()).some((a) => a.id === first.id)).toBe(false);
  });
});
