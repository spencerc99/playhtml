// ABOUTME: Tests the shared profanity matcher used by the guestbook and the fridge.
// ABOUTME: Covers whole-word matching, case, and list entries containing regex characters.
import { describe, expect, test } from "bun:test";
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

  test("flags whole listed words in sentences and ignores them inside longer words", () => {
    const samples: Array<[string, boolean]> = [
      ["a damn good day", true],
      ["what a bastard", true],
      ["Crap, I missed it", true],
      ["hello", false],
      ["nice fridge", false],
      ["assistant", false],
      ["class", false],
      ["shitake", false],
      ["bass player", false],
      // "hell" is not on the list.
      ["Hell yes", false],
    ];
    for (const [sample, expected] of samples) {
      expect({ sample, flagged: containsProfanity(sample) }).toEqual({
        sample,
        flagged: expected,
      });
    }
  });
});
