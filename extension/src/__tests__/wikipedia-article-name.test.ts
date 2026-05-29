// ABOUTME: Tests for currentWikipediaArticleName — which pages can be adopted as a chat handle.
// ABOUTME: The main page and namespace pages must return null so "be this page" doesn't appear there.

import { describe, it, expect, afterEach } from "vitest";
import { currentWikipediaArticleName } from "../custom-sites/wikipedia";

function setLocation(href: string) {
  const url = new URL(href);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: url.href,
      pathname: url.pathname,
      origin: url.origin,
      hostname: url.hostname,
    },
  });
}

describe("currentWikipediaArticleName", () => {
  afterEach(() => {
    setLocation("https://en.wikipedia.org/");
  });

  it("returns the title on a real article", () => {
    setLocation("https://en.wikipedia.org/wiki/Octopus");
    expect(currentWikipediaArticleName()).toBe("Octopus");
  });

  it("decodes underscores and percent-encoding", () => {
    setLocation("https://en.wikipedia.org/wiki/Pyotr_Stolypin");
    expect(currentWikipediaArticleName()).toBe("Pyotr Stolypin");
  });

  it("returns null on the main page (/wiki/Main_Page)", () => {
    setLocation("https://en.wikipedia.org/wiki/Main_Page");
    expect(currentWikipediaArticleName()).toBeNull();
  });

  it("returns null on the bare root and /wiki/", () => {
    setLocation("https://en.wikipedia.org/");
    expect(currentWikipediaArticleName()).toBeNull();
    setLocation("https://en.wikipedia.org/wiki/");
    expect(currentWikipediaArticleName()).toBeNull();
  });

  it("returns null on namespace pages (Special:/Talk:)", () => {
    setLocation("https://en.wikipedia.org/wiki/Special:RecentChanges");
    expect(currentWikipediaArticleName()).toBeNull();
    setLocation("https://en.wikipedia.org/wiki/Talk:Octopus");
    expect(currentWikipediaArticleName()).toBeNull();
  });
});
