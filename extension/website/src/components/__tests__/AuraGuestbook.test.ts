// ABOUTME: Tests for guestbook card pile and visitor dot data selection.
// ABOUTME: Verifies hoverable dot colors stay backed by rendered cards.

import { describe, expect, it } from "vitest";
import { getPileDotColors } from "../auraGuestbookData";

function entry(color: string, timestamp: number) {
  return {
    name: `person-${timestamp}`,
    color,
    message: `message ${timestamp}`,
    timestamp,
  };
}

describe("getPileDotColors", () => {
  it("returns newest unique colors from the rendered pile window", () => {
    const entries = Array.from({ length: 123 }, (_, index) =>
      entry(`hsl(${index}, 60%, 50%)`, index),
    );

    const colors = getPileDotColors(entries, 120);

    expect(colors).toHaveLength(120);
    expect(colors.slice(0, 3)).toEqual([
      "hsl(122, 60%, 50%)",
      "hsl(121, 60%, 50%)",
      "hsl(120, 60%, 50%)",
    ]);
    expect(colors).not.toContain("hsl(0, 60%, 50%)");
    expect(colors).not.toContain("hsl(1, 60%, 50%)");
    expect(colors).not.toContain("hsl(2, 60%, 50%)");
  });

  it("deduplicates repeated colors by the newest rendered card", () => {
    const entries = [
      entry("#c4724e", 1),
      entry("#4a9a8a", 2),
      entry("#c4724e", 3),
    ];

    expect(getPileDotColors(entries, 120)).toEqual(["#c4724e", "#4a9a8a"]);
  });
});
