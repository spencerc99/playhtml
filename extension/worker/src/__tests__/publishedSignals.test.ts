// ABOUTME: Tests robots.txt and sitemap parsing used as evidence for pages that refuse our fetch.
// ABOUTME: Covers agent group choice, longest-match rules, wildcards, and sitemap index detection.

import { describe, expect, it } from "vitest";
import {
  isPathDisallowed,
  parseRobots,
  parseSitemap,
  patternMatches,
  readPublishedSignals,
} from "../routes/publishedSignals";

describe("parseRobots", () => {
  it("uses the * group and collects every sitemap", () => {
    const robots = parseRobots(`
User-agent: Googlebot
Disallow: /nothing-for-google/

User-agent: *
Disallow: /account/
Allow: /account/help
Disallow:
# Disallow: /commented-out/

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/news.xml
`);
    expect(robots.rules).toEqual([
      { allow: false, pattern: "/account/" },
      { allow: true, pattern: "/account/help" },
    ]);
    expect(robots.sitemaps).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/news.xml",
    ]);
  });

  it("prefers a group that names our fetcher over the * group", () => {
    const robots = parseRobots(`
User-agent: *
Disallow: /

User-agent: wewere-online
Disallow: /private/
`);
    expect(robots.rules).toEqual([{ allow: false, pattern: "/private/" }]);
  });

  it("shares rules across consecutive user-agent lines", () => {
    const robots = parseRobots(`
User-agent: bingbot
User-agent: *
Disallow: /checkout
`);
    expect(robots.rules).toEqual([{ allow: false, pattern: "/checkout" }]);
  });
});

describe("isPathDisallowed", () => {
  const rules = parseRobots(`
User-agent: *
Disallow: /account/
Allow: /account/help
Disallow: /*?session=
Disallow: /*.pdf$
`).rules;

  it("blocks paths under a disallowed prefix", () => {
    expect(isPathDisallowed(rules, "/account/orders")).toBe(true);
  });

  it("lets the longer Allow win", () => {
    expect(isPathDisallowed(rules, "/account/help/returns")).toBe(false);
  });

  it("matches wildcards and end anchors", () => {
    expect(isPathDisallowed(rules, "/p/1?session=abc")).toBe(true);
    expect(isPathDisallowed(rules, "/guide.pdf")).toBe(true);
    expect(isPathDisallowed(rules, "/guide.pdf.html")).toBe(false);
  });

  it("allows paths no rule matches", () => {
    expect(isPathDisallowed(rules, "/2026/10/01/arts/museum.html")).toBe(false);
  });

  it("treats Disallow: / as blocking everything", () => {
    expect(
      isPathDisallowed(parseRobots("User-agent: *\nDisallow: /").rules, "/"),
    ).toBe(true);
  });
});

describe("patternMatches", () => {
  it("handles prefixes, inner wildcards, and end anchors", () => {
    expect(patternMatches("/a", "/abc")).toBe(true);
    expect(patternMatches("/a$", "/abc")).toBe(false);
    expect(patternMatches("/a$", "/a")).toBe(true);
    expect(patternMatches("/*/edit", "/docs/1/edit")).toBe(true);
    expect(patternMatches("/*/edit$", "/docs/1/edit/more")).toBe(false);
    expect(patternMatches("/x*y*z$", "/xyz")).toBe(true);
    expect(patternMatches("/ab*ba$", "/aba")).toBe(false);
  });

  it("stays fast on patterns built to cause backtracking", () => {
    const pattern = `/${"*a".repeat(200)}$`;
    const path = `/${"a".repeat(2_000)}b`;
    const started = performance.now();
    expect(patternMatches(pattern, path)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("readPublishedSignals", () => {
  it("never fetches from private or local addresses", async () => {
    expect(await readPublishedSignals("http://127.0.0.1/admin")).toBeNull();
    expect(await readPublishedSignals("http://localhost/robots")).toBeNull();
  });
});

describe("parseSitemap", () => {
  it("reads page locations from a urlset", () => {
    expect(
      parseSitemap(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a?x=1&amp;y=2</loc></url>
  <url><loc><![CDATA[https://example.com/b]]></loc></url>
</urlset>`),
    ).toEqual({
      index: false,
      locations: ["https://example.com/a?x=1&y=2", "https://example.com/b"],
    });
  });

  it("recognizes a sitemap index", () => {
    expect(
      parseSitemap(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/news.xml</loc></sitemap>
</sitemapindex>`),
    ).toEqual({ index: true, locations: ["https://example.com/news.xml"] });
  });
});
