// ABOUTME: Tests for the domain → owning-organization resolver.

import { describe, it, expect } from "vitest";
import { resolveOwner, INDEPENDENT, getOwner } from "../corporations";

describe("resolveOwner", () => {
  it("resolves exact domains", () => {
    expect(resolveOwner("youtube.com").id).toBe("alphabet");
    expect(resolveOwner("instagram.com").id).toBe("meta");
    expect(resolveOwner("twitch.tv").id).toBe("amazon");
  });

  it("resolves subdomains via suffix walking", () => {
    expect(resolveOwner("docs.google.com").id).toBe("alphabet");
    expect(resolveOwner("en.wikipedia.org").id).toBe("wikimedia");
    expect(resolveOwner("gist.github.com").id).toBe("microsoft");
  });

  it("strips a www prefix", () => {
    expect(resolveOwner("www.youtube.com").id).toBe("alphabet");
  });

  it("resolves country-TLD brand families via patterns", () => {
    expect(resolveOwner("google.de").id).toBe("alphabet");
    expect(resolveOwner("amazon.co.jp").id).toBe("amazon");
    expect(resolveOwner("maps.google.co.uk").id).toBe("alphabet");
  });

  it("classifies nonprofits as nonprofit", () => {
    expect(resolveOwner("wikipedia.org").kind).toBe("nonprofit");
    expect(resolveOwner("archive.org").kind).toBe("nonprofit");
  });

  it("returns the independent web for unknown domains", () => {
    expect(resolveOwner("spencerchang.me")).toBe(INDEPENDENT);
    expect(resolveOwner("some-small-blog.net")).toBe(INDEPENDENT);
  });

  it("returns the independent web for empty input", () => {
    expect(resolveOwner("")).toBe(INDEPENDENT);
  });

  it("does not let lookalike domains match brand patterns", () => {
    expect(resolveOwner("notgoogle.dev")).toBe(INDEPENDENT);
    expect(resolveOwner("mygoogle.fans")).toBe(INDEPENDENT);
  });
});

describe("getOwner", () => {
  it("looks up owners by id and falls back to independent", () => {
    expect(getOwner("meta").name).toBe("Meta");
    expect(getOwner("nonexistent")).toBe(INDEPENDENT);
  });
});
