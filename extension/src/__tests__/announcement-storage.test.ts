// ABOUTME: Tests for announcement seen-state storage and candidate filtering.
// ABOUTME: Verifies forward-only state, URL gating, and shippedAt ordering.

import { describe, it, expect, beforeEach, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  getState,
  setState,
  getToastCandidates,
  getPostcardCandidates,
  getPostcardViews,
  recordAnnouncementInstall,
  recordPostcardView,
  POSTCARD_VIEW_LIMIT,
} from "../announcements/announcement-storage";
import { ANNOUNCEMENTS } from "../announcements/announcements";

let data: Record<string, unknown>;

function setupStorage(): Record<string, unknown> {
  data = {};
  vi.mocked(browser.storage.local.get).mockImplementation((keys: any) => {
    if (typeof keys === "string")
      return Promise.resolve({ [keys]: data[keys] });
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
    const first = ANNOUNCEMENTS.find(
      (announcement) => announcement.relevantUrl,
    );
    if (!first) return;
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
    const first = ANNOUNCEMENTS.find(
      (announcement) => announcement.relevantUrl,
    );
    if (!first || !first.relevantUrl) return;
    const offTarget = "https://example.com/";
    const onTarget = "https://en.wikipedia.org/wiki/Anything";
    const offResults = await getToastCandidates(offTarget);
    const onResults = await getToastCandidates(onTarget);
    expect(offResults.some((a) => a.id === first.id)).toBe(false);
    expect(onResults.some((a) => a.id === first.id)).toBe(true);
  });

  it("getPostcardCandidates excludes only dismissed, includes toast-shown", async () => {
    // Announcements tied to a still-dark feature never surface, so pick one
    // that is reachable for every user.
    const first = ANNOUNCEMENTS.find(
      (announcement) => announcement.requiresFeature === undefined,
    );
    if (!first) return;
    expect((await getPostcardCandidates()).some((a) => a.id === first.id)).toBe(
      true,
    );
    await setState(first.id, "toast-shown");
    expect((await getPostcardCandidates()).some((a) => a.id === first.id)).toBe(
      true,
    );
    await setState(first.id, "dismissed");
    expect((await getPostcardCandidates()).some((a) => a.id === first.id)).toBe(
      false,
    );
  });

  it("keeps popup-only announcements out of page toasts", async () => {
    const popupOnly = ANNOUNCEMENTS.find(
      (announcement) =>
        announcement.popupOnly && announcement.requiresFeature === undefined,
    );
    expect(popupOnly).toBeDefined();
    expect(
      (await getToastCandidates("https://example.com")).some(
        (announcement) => announcement.id === popupOnly?.id,
      ),
    ).toBe(false);
    expect(
      (await getPostcardCandidates()).some(
        (announcement) => announcement.id === popupOnly?.id,
      ),
    ).toBe(true);
  });

  it("hides the announcement backlog from fresh installs", async () => {
    await recordAnnouncementInstall(Date.parse("2026-08-07T00:00:00Z"));

    expect(
      await getToastCandidates("https://en.wikipedia.org/wiki/Anything"),
    ).toEqual([]);
    expect(await getPostcardCandidates()).toEqual([]);
  });

  it("reads states stored before view counts existed", async () => {
    const reachable = ANNOUNCEMENTS.filter(
      (announcement) => announcement.requiresFeature === undefined,
    );
    expect(reachable.length).toBeGreaterThanOrEqual(2);
    const [shown, dismissed] = reachable;
    data[`announcement_seen_${shown.id}`] = "toast-shown";
    data[`announcement_seen_${dismissed.id}`] = "dismissed";

    expect(await getState(shown.id)).toBe("toast-shown");
    expect(await getState(dismissed.id)).toBe("dismissed");
    expect(await getPostcardViews(shown.id)).toBe(0);
    const ids = (await getPostcardCandidates()).map((a) => a.id);
    expect(ids).toContain(shown.id);
    expect(ids).not.toContain(dismissed.id);
  });

  it("recordPostcardView dismisses at the view limit", async () => {
    for (let i = 1; i < POSTCARD_VIEW_LIMIT; i++) {
      expect(await recordPostcardView("a")).toBe(i);
      expect(await getState("a")).toBeUndefined();
    }
    expect(await recordPostcardView("a")).toBe(POSTCARD_VIEW_LIMIT);
    expect(await getState("a")).toBe("dismissed");
  });

  it("getPostcardViews rejects a malformed stored count", async () => {
    data["announcement_views_a"] = "two";
    await expect(getPostcardViews("a")).rejects.toThrow(/not a non-negative/);
  });
});
