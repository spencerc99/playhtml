// ABOUTME: Verifies the collages board tells a failed load apart from an empty board.
// ABOUTME: Covers all-failed, partly-failed, and all-unshared pinned lists.
import { describe, expect, it } from "vitest";
import { boardContents } from "../boardContents";

describe("boardContents", () => {
  it("reports a failure when every pinned collage failed to load", () => {
    expect(boardContents(["failed", "failed"])).toBe("failed");
  });

  it("reports a failure when nothing loaded and some requests failed", () => {
    expect(boardContents(["missing", "failed"])).toBe("failed");
  });

  it("shows the collages that loaded even when others failed", () => {
    expect(boardContents(["failed", { id: "a" }, "missing"])).toEqual([
      { id: "a" },
    ]);
  });

  it("is empty when every pinned collage was unshared", () => {
    expect(boardContents(["missing", "missing"])).toEqual([]);
  });
});
