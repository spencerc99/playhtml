// ABOUTME: Tests example page markup required by playhtml custom callbacks.
// ABOUTME: Verifies DOM-configured elements mount through can-play.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

function readExampleHtml(filename: string): string {
  return readFileSync(new URL(`../${filename}`, import.meta.url), "utf8");
}

function elementOpeningTag(html: string, id: string): string | undefined {
  return html.match(new RegExp(`<[^>]+\\s+id="${id}"[^>]*>`))?.[0];
}

describe("custom example markup", () => {
  test.each([
    ["guestbook.html", "village-guestbook"],
    ["garden.html", "community-garden"],
    ["shop.html", "shop-marquee"],
    ["shop.html", "bell-count"],
  ])("%s marks #%s as can-play", (filename, id) => {
    const element = elementOpeningTag(readExampleHtml(filename), id);

    expect(element).toContain("can-play");
  });
});
