// ABOUTME: Tests the Tranco-format loader and the popularity cap that keeps
// ABOUTME: well-known domains out of the featured suggestions.

import { describe, expect, it } from "vitest";

import {
  isPopular,
  loadPopularityList,
  parseTrancoCsv,
  registrableDomainOf,
  type PopularityList,
} from "../popularity";

const SAMPLE_CSV = `1,google.com
2,youtube.com
3,facebook.com
10,wikipedia.org
`;

function listFrom(text: string): PopularityList {
  return { available: true, domains: parseTrancoCsv(text), path: "inline" };
}

describe("parseTrancoCsv", () => {
  it("reads rank and domain pairs", () => {
    expect(parseTrancoCsv(SAMPLE_CSV)).toEqual(
      new Set(["google.com", "youtube.com", "facebook.com", "wikipedia.org"]),
    );
  });

  it("skips blank lines and malformed rows", () => {
    const parsed = parseTrancoCsv("1,good.com\n\nnot-a-rank,bad.com\n7\n2,ok.org\n");

    expect(parsed).toEqual(new Set(["good.com", "ok.org"]));
  });

  it("lowercases domains", () => {
    expect(parseTrancoCsv("1,Example.COM\n")).toEqual(new Set(["example.com"]));
  });
});

describe("loadPopularityList", () => {
  it("reports unavailable when the file is absent, without throwing", () => {
    const list = loadPopularityList("/nonexistent/tranco-top10k.csv");

    expect(list.available).toBe(false);
    expect(list.domains.size).toBe(0);
  });
});

describe("registrableDomainOf", () => {
  it("reduces a host to its registrable domain", () => {
    expect(registrableDomainOf("https://en.wikipedia.org/wiki/Moss")).toBe(
      "wikipedia.org",
    );
  });

  it("returns null for an unparseable url", () => {
    expect(registrableDomainOf("not a url")).toBe(null);
  });
});

describe("isPopular", () => {
  it("caps a listed domain reached by a subdomain", () => {
    expect(isPopular("https://en.wikipedia.org/wiki/Moss", listFrom(SAMPLE_CSV))).toBe(
      true,
    );
  });

  it("leaves an unlisted small site uncapped", () => {
    expect(isPopular("https://annshafer.com/", listFrom(SAMPLE_CSV))).toBe(false);
  });

  it("applies no cap at all when the list is unavailable", () => {
    const absent: PopularityList = {
      available: false,
      domains: new Set(),
      path: "missing",
    };

    expect(isPopular("https://google.com/", absent)).toBe(false);
  });
});
