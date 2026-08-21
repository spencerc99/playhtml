// ABOUTME: Tests deterministic URL normalization and source-specific reserve catalog parsing.
// ABOUTME: Verifies duplicate handling without exercising public websites during the test suite.

import { describe, expect, test } from "bun:test";
import {
  canonicalizeCatalogUrl,
  dedupeCatalogEntries,
  parseHtmlReviewArchive,
  parseTaperIssue,
} from "./generate-reserve-catalog";

describe("canonicalizeCatalogUrl", () => {
  test("removes fragments and common tracking parameters", () => {
    expect(
      canonicalizeCatalogUrl(
        "https://Example.com/work/?utm_source=train&z=2&a=1#section",
      ),
    ).toBe("https://example.com/work?a=1&z=2");
  });

  test("rejects non-web protocols", () => {
    expect(canonicalizeCatalogUrl("mailto:person@example.com")).toBeNull();
  });
});

describe("parseHtmlReviewArchive", () => {
  test("keeps issue and work links but not author links", () => {
    const entries = parseHtmlReviewArchive(`
      <section>
        <h2><a href="/05/">issue 05, spring 2026</a></h2>
        <ul>
          <li>
            <span><a href="/05/meanders/">Meanders</a></span>
            <span> • </span>
            <span><a href="https://artist.example/">Artist</a></span>
          </li>
          <li>
            <a href="/05/root-level-work/">Root-level work</a>
            <span> • </span>
            <a href="https://another-artist.example/">Another artist</a>
          </li>
        </ul>
      </section>
    `);

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://thehtml.review/05",
      "https://thehtml.review/05/meanders",
      "https://thehtml.review/05/root-level-work",
    ]);
  });
});

describe("parseTaperIssue", () => {
  test("keeps each issue work once and ignores navigation", () => {
    const entries = parseTaperIssue(
      `
        <a href="about.html">about</a>
        <ol>
          <li><a href="http://taper.badquar.to/16/piece.html">Piece</a></li>
          <li><a href="piece.html#again">Piece repeated</a></li>
        </ol>
      `,
      "https://taper.badquar.to/16/",
      "Taper #16",
    );

    expect(dedupeCatalogEntries(entries)).toHaveLength(1);
    expect(entries[0]?.url).toBe("https://taper.badquar.to/16/piece.html");
  });
});

describe("dedupeCatalogEntries", () => {
  test("prefers trusted editorial provenance over discovery provenance", () => {
    const discovery = parseTaperIssue(
      '<ol><li><a href="piece.html">Piece</a></li></ol>',
      "https://taper.badquar.to/16/",
      "Taper #16",
    )[0]!;
    const trusted = { ...discovery, sourceMode: "trusted-editorial" as const };
    const lessTrusted = { ...discovery, sourceMode: "discovery-only" as const };

    expect(dedupeCatalogEntries([lessTrusted, trusted])[0]?.sourceMode).toBe(
      "trusted-editorial",
    );
  });
});
