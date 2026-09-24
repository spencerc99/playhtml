// ABOUTME: Tests that each scraps page place survives a trip through the URL hash.
// ABOUTME: Covers browse, the collage list, a new collage, saved ids, and unknown hashes.

import { describe, expect, it } from "vitest";
import {
  parsePlaceHash,
  placeHash,
  type ScrapsPlace,
} from "../entrypoints/scraps/scrapsPlace";

describe("scraps place hash", () => {
  const places: ScrapsPlace[] = [
    { mode: "browse" },
    { mode: "create", collage: null },
    { mode: "create", collage: "new" },
    { mode: "create", collage: { id: "collage-1a2b" } },
    { mode: "create", collage: { id: "odd/id with space" } },
  ];

  it.each(places)("round-trips %j", (place) => {
    expect(parsePlaceHash(placeHash(place))).toEqual(place);
  });

  it("writes browse as no hash at all", () => {
    expect(placeHash({ mode: "browse" })).toBe("");
  });

  it("reads an unknown hash as browse", () => {
    expect(parsePlaceHash("#somewhere")).toEqual({ mode: "browse" });
    expect(parsePlaceHash("")).toEqual({ mode: "browse" });
  });
});
