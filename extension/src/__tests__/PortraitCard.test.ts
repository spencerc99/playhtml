// ABOUTME: Verifies portrait texture density remains consistent across card sizes.
// ABOUTME: Keeps wide weekly cards as vivid as the compact portrait overlays.

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatDuration,
  getPortraitStrokeCount,
  PortraitCard,
} from "../components/PortraitCard";

describe("getPortraitStrokeCount", () => {
  it("renders an empty portrait as zero minutes", () => {
    expect(formatDuration(0)).toBe("0 min");
  });

  it("scales stroke count with canvas area", () => {
    const compact = getPortraitStrokeCount(18 * 60_000, 300, 180);
    const wide = getPortraitStrokeCount(18 * 60_000, 720, 220);

    expect(compact).toBe(270);
    expect(wide).toBeGreaterThan(compact * 2);
  });

  it("keeps the density cap proportional to canvas area", () => {
    const compact = getPortraitStrokeCount(24 * 60 * 60_000, 300, 180);
    const wide = getPortraitStrokeCount(24 * 60 * 60_000, 720, 220);

    expect(compact).toBe(2_000);
    expect(wide).toBeGreaterThan(5_000);
  });

  it("uses browsing language and an exact supplied range", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PortraitCard, {
        domain: "",
        totalTimeMs: 60_000,
        hourBuckets: new Array(24).fill(0),
        cursorDistancePx: 0,
        dateRange: null,
        dateLabel: "jul 20 – 26, 2026",
      }),
    );

    expect(markup).toContain("browsing");
    expect(markup).not.toContain("spent");
    expect(markup).toContain("jul 20 – 26, 2026");
  });
});
