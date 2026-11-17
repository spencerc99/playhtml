// ABOUTME: Tests the shared profanity matcher used by the guestbook and the fridge.
// ABOUTME: Covers whole-word matching, case, and list entries containing regex characters.
import { describe, expect, test } from "bun:test";
import profaneWords from "profane-words";
import { buildProfanityMatcher, containsProfanity } from "../utils/profanity";

describe("profanity matcher", () => {
  test("matches listed words as whole words in any case", () => {
    expect(containsProfanity("well shit")).toBe(true);
    expect(containsProfanity("SHIT happens")).toBe(true);
  });

  test("does not match listed words inside longer words", () => {
    expect(containsProfanity("scunthorpe")).toBe(false);
    expect(containsProfanity("hello there friend")).toBe(false);
    expect(containsProfanity("")).toBe(false);
  });

  test("treats regex characters in listed words literally", () => {
    const matcher = buildProfanityMatcher(["f*ck", "c.u.n.t", "a+b"]);
    expect(matcher.test("f*ck")).toBe(true);
    expect(matcher.test("ck")).toBe(false);
    expect(matcher.test("fffck")).toBe(false);
    expect(matcher.test("c.u.n.t")).toBe(true);
    expect(matcher.test("cxuxnxt")).toBe(false);
    expect(matcher.test("a+b")).toBe(true);
    expect(matcher.test("aab")).toBe(false);
  });

  test("agrees with a per-word \\b check for alphanumeric list entries", () => {
    const plainWords = profaneWords.filter((word) => /^\w+$/.test(word));
    const matcher = buildProfanityMatcher(plainWords);
    const samples = [
      "hello",
      "nice fridge",
      "assistant",
      "class",
      "a damn good day",
      "Hell yes",
      "shitake",
      "bass player",
    ];
    for (const sample of samples) {
      const expected = plainWords.some((word) =>
        new RegExp(`\\b${word}\\b`, "i").test(sample),
      );
      expect(matcher.test(sample)).toBe(expected);
    }
  });
});
