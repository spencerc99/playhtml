// ABOUTME: Tests for the salutation parts derivation — root/domain, title
// ABOUTME: suffix-stripping, truncation, and missing-title fallbacks.

import { describe, expect, it } from "vitest";
import { salutationParts } from "../components/bottle/salutation";

describe("salutationParts", () => {
  it("uses the bare domain for root pages, stripping www, with no domain parenthetical", () => {
    expect(salutationParts("https://www.diaryland.com/")).toEqual({
      label: "diaryland.com",
    });
    expect(salutationParts("https://diaryland.com/", "Diaryland | Home")).toEqual({
      label: "diaryland.com",
    });
  });

  it("uses the page title on non-root pages", () => {
    expect(
      salutationParts("https://susans-garden.net/tomatoes", "the tomato failures of 2025"),
    ).toEqual({
      label: "the tomato failures of 2025",
      domain: "susans-garden.net",
    });
  });

  it("carries the domain parenthetical for a titled non-root page", () => {
    expect(salutationParts("https://www.example.com/blog/post", "A Nice Post")).toEqual({
      label: "A Nice Post",
      domain: "example.com",
    });
  });

  it("strips common site-name suffixes from titles", () => {
    expect(
      salutationParts("https://a.com/x", "The Tomato Failures | Susan's Garden"),
    ).toEqual({
      label: "The Tomato Failures",
      domain: "a.com",
    });
    expect(
      salutationParts("https://a.com/x", "The Tomato Failures — Susan's Garden"),
    ).toEqual({
      label: "The Tomato Failures",
      domain: "a.com",
    });
  });

  it("truncates long titles at a word boundary with an ellipsis", () => {
    const long =
      "a very long meandering page title that keeps going well past any reasonable length";
    const { label, domain } = salutationParts("https://a.com/x", long);
    expect(label.length).toBeLessThanOrEqual(49); // 48 + ellipsis char
    expect(label.endsWith("…")).toBe(true);
    expect(label).not.toMatch(/\s…$/); // no dangling space before ellipsis
    expect(domain).toBe("a.com");
  });

  it("falls back to hostname + short path when there is no title, with no domain parenthetical", () => {
    expect(salutationParts("https://www.a.com/writing/letters")).toEqual({
      label: "a.com/writing/letters",
    });
  });

  it("shortens very long paths in the no-title fallback", () => {
    const { label, domain } = salutationParts(
      "https://a.com/one/two/three/four/five/six/seven/eight/nine",
    );
    expect(label.startsWith("a.com/")).toBe(true);
    expect(label.length).toBeLessThanOrEqual(49);
    expect(domain).toBeUndefined();
  });

  it("returns the raw input when the URL does not parse, with no domain parenthetical", () => {
    expect(salutationParts("not a url", "Some Title")).toEqual({ label: "Some Title" });
    expect(salutationParts("not a url")).toEqual({ label: "not a url" });
  });
});
