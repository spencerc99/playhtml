// ABOUTME: Verifies announcement candidates hide entries whose feature is not yet reachable.
// ABOUTME: Covers the internet-scraps postcard, which ships behind the SCRAPS flag.

import browser from "webextension-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPostcardCandidates } from "./announcement-storage";
import { FLAGS } from "../flags";

describe("getPostcardCandidates", () => {
  beforeEach(() => {
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits the scraps postcard while the feature is unreachable", async () => {
    expect(FLAGS.SCRAPS).toBe(false);
    const candidates = await getPostcardCandidates();
    expect(candidates.map((a) => a.id)).not.toContain("scraps-2026-08");
  });

  it("includes the scraps postcard for approved beta testers", async () => {
    vi.mocked(browser.storage.local.get).mockImplementation(
      async (keys: unknown) =>
        keys === "wwoInternalAccess"
          ? { wwoInternalAccess: { enabled: true, checkedAt: 1 } }
          : {},
    );
    const candidates = await getPostcardCandidates();
    expect(candidates.map((a) => a.id)).toContain("scraps-2026-08");
  });
});
