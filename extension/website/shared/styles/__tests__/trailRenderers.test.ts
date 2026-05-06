// ABOUTME: Tests trail renderer DOM mutation caching.
// ABOUTME: Guards hot-path SVG attribute updates against redundant writes.

import { describe, expect, it, vi } from "vitest";
import { colorRenderer } from "../trailRenderers";

describe("colorRenderer", () => {
  it("does not reapply unchanged SVG path attributes", () => {
    const pathEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    const setAttribute = vi.spyOn(pathEl, "setAttribute");

    const params = {
      pathEl,
      pathData: "M 0 0 L 10 10",
      trailOpacity: 0.7,
      strokeWidth: 5,
      cursorType: "default",
      trailProgress: 0.5,
      trailColor: "#7c3aed",
      fixedMonoStrokeWidth: 3,
    };

    colorRenderer.updatePath(params);
    const firstCallCount = setAttribute.mock.calls.length;

    colorRenderer.updatePath(params);

    expect(firstCallCount).toBeGreaterThan(0);
    expect(setAttribute.mock.calls).toHaveLength(firstCallCount);
  });
});
