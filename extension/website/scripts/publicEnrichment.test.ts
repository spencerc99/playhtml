// ABOUTME: Tests public enrichment address filtering and metadata extraction.
// ABOUTME: Covers private network rejection and common Open Graph and JSON-LD evidence.

import { describe, expect, test } from "vitest";

import { extractPublicMetadata, isPrivateAddress } from "./publicEnrichment";

describe("isPrivateAddress", () => {
  test("rejects local and private IPv4 and IPv6 ranges", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("169.254.1.2")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
  });

  test("allows public addresses", () => {
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("extractPublicMetadata", () => {
  test("extracts Open Graph and JSON-LD evidence", () => {
    const html = `<title>Fallback</title><meta property="og:title" content="A small wonder"><meta name="description" content="Made by a person"><script type="application/ld+json">{"name":"A small wonder","author":{"name":"June"},"datePublished":"2025-04-03","interactionStatistic":{"interactionType":"WatchAction","userInteractionCount":123}}</script>`;
    expect(extractPublicMetadata(html)).toMatchObject({ title: "A small wonder", description: "Made by a person", author: "June", publishedAt: "2025-04-03", viewCount: 123 });
  });
});
