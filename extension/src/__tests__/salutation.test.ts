// ABOUTME: Tests for the salutation address derivation — root/domain, title
// ABOUTME: suffix-stripping, truncation, and missing-title fallbacks.

import { describe, expect, it } from "vitest";
import { salutationAddress } from "../components/bottle/salutation";

describe("salutationAddress", () => {
  it("uses the bare domain for root pages, stripping www", () => {
    expect(salutationAddress("https://www.diaryland.com/")).toBe("diaryland.com");
    expect(salutationAddress("https://diaryland.com/", "Diaryland | Home")).toBe(
      "diaryland.com",
    );
  });

  it("uses the page title on non-root pages", () => {
    expect(
      salutationAddress("https://susans-garden.net/tomatoes", "the tomato failures of 2025"),
    ).toBe("the tomato failures of 2025");
  });

  it("strips common site-name suffixes from titles", () => {
    expect(
      salutationAddress("https://a.com/x", "The Tomato Failures | Susan's Garden"),
    ).toBe("The Tomato Failures");
    expect(
      salutationAddress("https://a.com/x", "The Tomato Failures — Susan's Garden"),
    ).toBe("The Tomato Failures");
  });

  it("truncates long titles at a word boundary with an ellipsis", () => {
    const long =
      "a very long meandering page title that keeps going well past any reasonable length";
    const out = salutationAddress("https://a.com/x", long);
    expect(out.length).toBeLessThanOrEqual(49); // 48 + ellipsis char
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/); // no dangling space before ellipsis
  });

  it("falls back to hostname + short path when there is no title", () => {
    expect(salutationAddress("https://www.a.com/writing/letters")).toBe(
      "a.com/writing/letters",
    );
  });

  it("shortens very long paths in the no-title fallback", () => {
    const out = salutationAddress(
      "https://a.com/one/two/three/four/five/six/seven/eight/nine",
    );
    expect(out.startsWith("a.com/")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(49);
  });

  it("returns the raw input when the URL does not parse", () => {
    expect(salutationAddress("not a url", "Some Title")).toBe("Some Title");
    expect(salutationAddress("not a url")).toBe("not a url");
  });
});
