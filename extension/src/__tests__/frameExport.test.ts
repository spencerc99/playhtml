import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_SIDE,
  exportPaperSize,
  matLayout,
} from "../entrypoints/scraps/frameExport";

describe("exportPaperSize", () => {
  it("shrinks a 2x bake so the whole mat fits the longest side", () => {
    const paper = exportPaperSize(3000, 2100);
    const mat = matLayout(paper.width, paper.height);
    expect(Math.max(mat.width, mat.height)).toBeLessThanOrEqual(
      EXPORT_MAX_SIDE + 1,
    );
    expect(Math.max(mat.width, mat.height)).toBeGreaterThan(
      EXPORT_MAX_SIDE - 4,
    );
    expect(paper.width / paper.height).toBeCloseTo(3000 / 2100, 2);
  });

  it("fits tall papers by their height", () => {
    const paper = exportPaperSize(1800, 3200);
    const mat = matLayout(paper.width, paper.height);
    expect(mat.height).toBeLessThanOrEqual(EXPORT_MAX_SIDE + 1);
  });

  it("never enlarges a small picture", () => {
    expect(exportPaperSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
