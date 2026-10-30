// ABOUTME: Checks that visited URLs resolve to the right building, host or city on the map.
// ABOUTME: The labels here mirror the shapes the real bundle uses, chunk markers included.

import { describe, expect, it } from "vitest";
import { Locator, visitKey, subHost } from "../locate";

const labels = {
  pages: [
    "github.com/spencerc99/playhtml",   // 0  sub 0
    "github.com/explore",               // 1  sub 0
    "gist.github.com/abc",              // 2  sub 1
    "youtube.com/watch",                // 3  sub 2 (chunk 1)
    "youtube.com/results",              // 4  sub 3 (chunk 2)
    "www.nytimes.com/",                 // 5  sub 4
  ],
  subs: ["github.com", "gist.github.com", "youtube.com/watch [1]", "youtube.com/watch [2]", "nytimes.com"],
  doms: ["github.com", "youtube.com", "nytimes.com"],
};
const A = {
  pageSub: Uint32Array.from([0, 0, 1, 2, 3, 4]),
  subDom: Uint32Array.from([0, 0, 1, 1, 2]),
  pageHits: [50, 900, 5, 40, 400, 7],
};

describe("visitKey", () => {
  it("normalises scheme, www., trailing slashes, query and hash away", () => {
    expect(visitKey("https://www.GitHub.com/explore/?tab=1#x")).toEqual({ host: "github.com", path: "/explore" });
    expect(visitKey("github.com")).toEqual({ host: "github.com", path: "/" });
    expect(visitKey("chrome-extension://abc/popup.html")).toBeNull();
    expect(visitKey("not a url at all ://")).toBeNull();
  });

  it("reads the host out of a neighbourhood label", () => {
    expect(subHost("youtube.com/watch [2]")).toBe("youtube.com");
    expect(subHost("www.nytimes.com")).toBe("nytimes.com");
  });
});

describe("Locator", () => {
  const loc = new Locator(labels, A);

  it("finds the exact page first", () => {
    expect(loc.locate("https://github.com/explore")).toMatchObject({ page: 1, quality: "page", host: "github.com" });
  });

  it("falls back to the longest page the path sits beneath", () => {
    const r = loc.locate("https://github.com/spencerc99/playhtml/issues/5?q=x");
    expect(r).toMatchObject({ page: 0, quality: "path", name: "github.com/spencerc99/playhtml" });
  });

  it("falls back to the host's busiest building, across its chunks", () => {
    const r = loc.locate("https://youtube.com/feed/subscriptions");
    expect(r).toMatchObject({ page: 4, quality: "host", host: "youtube.com", domain: "youtube.com" });
  });

  it("falls back to the city for an unseen subdomain", () => {
    const r = loc.locate("https://music.youtube.com/library");
    expect(r).toMatchObject({ page: 4, quality: "domain", name: "youtube.com" });
  });

  it("treats a root path and a www. host as the map spells them", () => {
    expect(loc.locate("https://nytimes.com")).toMatchObject({ page: 5, quality: "page" });
  });

  it("returns null for places the map has never heard of", () => {
    expect(loc.locate("https://nowhere.example/x")).toBeNull();
    expect(loc.locate("about:blank")).toBeNull();
  });
});
