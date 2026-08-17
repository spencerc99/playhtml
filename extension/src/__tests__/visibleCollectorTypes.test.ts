// ABOUTME: Covers which collector types the settings and setup UIs expose.
// ABOUTME: Guards against flagged collectors leaking controls that do nothing.

import { describe, expect, it } from "vitest";
import { visibleCollectorTypes } from "../components/useVisibleCollectorTypes";
import { FLAGS } from "../flags";

describe("visibleCollectorTypes", () => {
  it("hides the scrap collector while SCRAPS is unreleased", () => {
    expect(FLAGS.SCRAPS).toBe(false);
    expect(visibleCollectorTypes(false)).not.toContain("element");
  });

  it("always shows the released collectors", () => {
    expect(visibleCollectorTypes(false)).toEqual([
      "cursor",
      "navigation",
      "viewport",
      "keyboard",
    ]);
  });

  it("shows the scrap collector to internal dev builds", () => {
    expect(visibleCollectorTypes(true)).toContain("element");
  });
});
