// ABOUTME: Covers deterministic sitemap parsing and crawl seed selection.
// ABOUTME: Keeps deep-page discovery priorities stable without network access.

import { describe, expect, test } from "bun:test";
import { extractSitemapLocations, selectCrawlSeeds } from "./lib";

describe("extractSitemapLocations", () => {
  test("extracts namespaced, escaped, and CDATA locations", () => {
    const xml = `
      <urlset>
        <url><loc>https://example.com/a&amp;b</loc></url>
        <url><news:loc><![CDATA[https://example.com/c]]></news:loc></url>
      </urlset>
    `;

    expect(extractSitemapLocations(xml)).toEqual([
      "https://example.com/a&b",
      "https://example.com/c",
    ]);
  });
});

describe("selectCrawlSeeds", () => {
  test("starts at home, favors link-rich paths, then sorts deterministically", () => {
    expect(
      selectCrawlSeeds(
        "https://example.com/",
        [
          "https://example.com/zebra",
          "https://example.com/deep/page",
          "https://example.com/about",
          "https://example.com/links-long",
          "https://example.com/now",
          "https://example.com/alpha",
          "https://example.com/about",
        ],
        6
      )
    ).toEqual([
      "https://example.com/",
      "https://example.com/now",
      "https://example.com/about",
      "https://example.com/links-long",
      "https://example.com/alpha",
      "https://example.com/zebra",
    ]);
  });
});
