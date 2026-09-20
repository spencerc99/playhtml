// ABOUTME: Verifies source-aware filtering without dropping photo encounter history.
// ABOUTME: Covers domain/path scopes and saved-text search across grouped photos and buttons.
import { describe, expect, it } from "vitest";
import type { ScrapItem } from "../../components/ScrapCollage";
import { groupPhotoEncounters } from "../scrapPhotoGroups";
import { parseFilterChip } from "../eventUtils";
import { matchesScrapFilters } from "../scrapFilters";

const photo: ScrapItem = {
  id: "a",
  key: "a",
  kind: "image",
  src: "https://cdn.test/a.png",
  pageTitle: "Garden",
  pageUrl: "https://are.na/spencer/garden",
  domain: "are.na",
  ts: 1,
  alt: "Green leaves",
  naturalWidth: 100,
  naturalHeight: 100,
};
const grouped = groupPhotoEncounters([
  photo,
  {
    ...photo,
    id: "b",
    key: "b",
    pageTitle: "Botanical notes",
    pageUrl: "https://spencer.place/notes",
    domain: "spencer.place",
    ts: 2,
  },
])[0];
describe("scrap filters", () => {
  it("matches any photo source and preserves all encounters", () => {
    expect(
      matchesScrapFilters(
        grouped,
        [parseFilterChip("are.na/spencer")],
        "garden",
      ),
    ).toBe(true);
    expect(grouped.sources).toHaveLength(2);
    expect(
      matchesScrapFilters(grouped, [parseFilterChip("are.na/other")], ""),
    ).toBe(false);
    expect(
      matchesScrapFilters(grouped, [parseFilterChip("not-are.na")], ""),
    ).toBe(false);
  });
  it("combines domain choices with OR and search with AND", () => {
    const places = [
      parseFilterChip("example.com"),
      parseFilterChip("spencer.place"),
    ];
    expect(matchesScrapFilters(grouped, places, "BOTANICAL leaves")).toBe(true);
    expect(matchesScrapFilters(grouped, places, "missing")).toBe(false);
    expect(matchesScrapFilters(grouped, [], "  ")).toBe(true);
  });
  it("searches button text and URLs", () => {
    const button: ScrapItem = {
      ...photo,
      kind: "button",
      text: "Save for later",
      styles: {},
    };
    expect(matchesScrapFilters(button, [], "later spencer")).toBe(true);
  });
});
