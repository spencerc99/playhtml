// ABOUTME: Tests which stored URL forms a page lookup covers, and the urlHash parameter the Worker accepts.
// ABOUTME: The Worker validates with the same parseUrlHashes, so these cases are the request contract.

import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_EVENT_URLS,
  MAX_PAGE_EVENT_URL_LENGTH,
  formatUrlHashes,
  pageEventUrlVariants,
  parseUrlHashes,
} from "../utils/pageEventUrls";

const HASH_A = "0cc175b9c0f1b6a831c399e269772661";
const HASH_B = "900150983cd24fb0d6963f7d28e17f72";

describe("pageEventUrlVariants", () => {
  it("lists the page and its trailing-slash twin when there is no query", () => {
    expect(pageEventUrlVariants("https://example.com/wiki/Cat")).toEqual([
      "https://example.com/wiki/Cat",
      "https://example.com/wiki/Cat/",
    ]);
    expect(pageEventUrlVariants("https://example.com/wiki/Cat/")).toEqual([
      "https://example.com/wiki/Cat/",
      "https://example.com/wiki/Cat",
    ]);
  });

  it("does not toggle the slash of the root path", () => {
    expect(pageEventUrlVariants("https://example.com/")).toEqual([
      "https://example.com/",
    ]);
    expect(pageEventUrlVariants("https://example.com")).toEqual([
      "https://example.com/",
    ]);
    expect(pageEventUrlVariants("https://example.com/?q=1")).toEqual([
      "https://example.com/?q=1",
      "https://example.com/",
    ]);
  });

  it("adds the query-less forms after the forms with the query", () => {
    expect(pageEventUrlVariants("https://example.com/a/?b=1&c=2")).toEqual([
      "https://example.com/a/?b=1&c=2",
      "https://example.com/a?b=1&c=2",
      "https://example.com/a/",
      "https://example.com/a",
    ]);
  });

  it("drops the fragment, including an empty one", () => {
    expect(pageEventUrlVariants("https://example.com/a?b=1#History")).toEqual([
      "https://example.com/a?b=1",
      "https://example.com/a/?b=1",
      "https://example.com/a",
      "https://example.com/a/",
    ]);
    expect(pageEventUrlVariants("https://example.com/a#")).toEqual([
      "https://example.com/a",
      "https://example.com/a/",
    ]);
  });

  it("keeps an empty query as written, since that is how such a page is stored", () => {
    expect(pageEventUrlVariants("https://example.com/a?")).toEqual([
      "https://example.com/a?",
      "https://example.com/a/?",
      "https://example.com/a",
      "https://example.com/a/",
    ]);
  });

  it("serializes the URL the way an uploaded event stores it", () => {
    // Lowercase host, default port removed, non-ASCII path percent-encoded.
    expect(pageEventUrlVariants("https://EXAMPLE.com:443/wiki/猫")).toEqual([
      "https://example.com/wiki/%E7%8C%AB",
      "https://example.com/wiki/%E7%8C%AB/",
    ]);
    // Path casing and protocol are not varied.
    expect(pageEventUrlVariants("http://example.com/Wiki")).toEqual([
      "http://example.com/Wiki",
      "http://example.com/Wiki/",
    ]);
  });

  it("never lists more forms than one lookup accepts, and never repeats one", () => {
    const pages = [
      "https://example.com",
      "https://example.com/",
      "https://example.com/?q",
      "https://example.com/a",
      "https://example.com/a/",
      "https://example.com/a?",
      "https://example.com/a/?q=1#h",
      "https://example.com//a//?q=1",
    ];
    for (const page of pages) {
      const variants = pageEventUrlVariants(page);
      expect(variants.length).toBeGreaterThanOrEqual(1);
      expect(variants.length).toBeLessThanOrEqual(MAX_PAGE_EVENT_URLS);
      expect(new Set(variants).size).toBe(variants.length);
    }
  });

  it("refuses pages that are not http(s)", () => {
    for (const page of [
      "file:///Users/me/notes.html",
      "chrome-extension://abc/popup.html",
      "about:blank",
    ]) {
      expect(() => pageEventUrlVariants(page)).toThrow(
        "Page URL must be http or https",
      );
    }
  });

  it("refuses a URL that is not a URL", () => {
    expect(() => pageEventUrlVariants("not a url")).toThrow();
  });

  it("refuses a page URL longer than the Worker accepts", () => {
    const base = "https://example.com/";
    const atLimit = base + "a".repeat(MAX_PAGE_EVENT_URL_LENGTH - base.length);
    expect(pageEventUrlVariants(atLimit)[0]).toBe(atLimit);
    expect(() => pageEventUrlVariants(`${atLimit}a`)).toThrow(
      "Page URL is too long",
    );
  });
});

describe("parseUrlHashes", () => {
  it("accepts one to four lowercase md5 hex digests", () => {
    expect(parseUrlHashes(HASH_A)).toEqual([HASH_A]);
    const four = [HASH_A, HASH_B, "d41d8cd98f00b204e9800998ecf8427e", "f96b697d7cb7938d525a2f31aaf161d0"];
    expect(parseUrlHashes(four.join(","))).toEqual(four);
  });

  it("removes repeated digests", () => {
    expect(parseUrlHashes(`${HASH_A},${HASH_B},${HASH_A}`)).toEqual([
      HASH_A,
      HASH_B,
    ]);
  });

  it("counts repeats toward the four-digest limit", () => {
    expect(parseUrlHashes([HASH_A, HASH_A, HASH_A, HASH_A, HASH_B].join(","))).toBeNull();
  });

  it.each([
    ["an empty value", ""],
    ["a trailing comma", `${HASH_A},`],
    ["uppercase hex", HASH_A.toUpperCase()],
    ["a short digest", HASH_A.slice(1)],
    ["a long digest", `${HASH_A}0`],
    ["non-hex characters", `${HASH_A.slice(0, 31)}g`],
    ["spaces after commas", `${HASH_A}, ${HASH_B}`],
    ["a raw URL", "https://example.com/a"],
  ])("refuses %s", (_label, value) => {
    expect(parseUrlHashes(value)).toBeNull();
  });

  it("reads back what formatUrlHashes writes", () => {
    const hashes = [HASH_A, HASH_B];
    expect(formatUrlHashes(hashes)).toBe(`${HASH_A},${HASH_B}`);
    expect(parseUrlHashes(formatUrlHashes(hashes))).toEqual(hashes);
  });
});
