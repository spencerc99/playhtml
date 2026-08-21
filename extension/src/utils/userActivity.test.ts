// ABOUTME: Covers user-activity checks across supported and missing idle APIs.
// ABOUTME: Verifies Safari can deliver milestones without the idle permission.

import { describe, expect, it, vi } from "vitest";
import { isUserActive } from "./userActivity";

describe("isUserActive", () => {
  it("uses the browser idle state when the API is available", async () => {
    const queryState = vi
      .fn()
      .mockResolvedValueOnce("active")
      .mockResolvedValueOnce("idle");

    await expect(isUserActive({ queryState })).resolves.toBe(true);
    await expect(isUserActive({ queryState })).resolves.toBe(false);
    expect(queryState).toHaveBeenCalledWith(60);
  });

  it("treats the user as active when the idle API is unavailable", async () => {
    await expect(isUserActive(undefined)).resolves.toBe(true);
  });

  it("keeps milestone delivery available when the idle API fails", async () => {
    const error = new Error("idle state unavailable");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      isUserActive({ queryState: vi.fn().mockRejectedValue(error) }),
    ).resolves.toBe(true);
    expect(warning).toHaveBeenCalledWith(
      "[Background] Could not read browser idle state:",
      error,
    );

    warning.mockRestore();
  });
});
