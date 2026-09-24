// ABOUTME: Tests how a scrap image's display source is resolved, with and without local copies.
// ABOUTME: Uses a real in-memory lookup rather than a stub, and checks lookups are batched per tick.

import { afterEach, describe, expect, it } from "vitest";
import {
  forgetScrapImageSrc,
  provideLocalScrapImages,
  resolveScrapImageSrc,
} from "@movement/utils/scrapImageSource";

const held = new Map<string, string>();
const lookups: string[][] = [];

function serveFromMap() {
  provideLocalScrapImages(async (srcs) => {
    lookups.push([...srcs]);
    return new Map(
      srcs.flatMap((src) => (held.has(src) ? [[src, held.get(src)!]] : [])),
    );
  });
}

afterEach(() => {
  held.clear();
  lookups.length = 0;
});

describe("resolveScrapImageSrc", () => {
  it("answers with the URL itself where no copies are served", async () => {
    expect(await resolveScrapImageSrc("https://a.test/x.png")).toBe(
      "https://a.test/x.png",
    );
  });

  it("answers with the local copy when one is held, else the URL", async () => {
    held.set("https://a.test/kept.png", "blob:kept");
    serveFromMap();
    expect(await resolveScrapImageSrc("https://a.test/kept.png")).toBe(
      "blob:kept",
    );
    expect(await resolveScrapImageSrc("https://a.test/gone.png")).toBe(
      "https://a.test/gone.png",
    );
  });

  it("gathers lookups made together into one read and remembers answers", async () => {
    held.set("https://a.test/1.png", "blob:1");
    serveFromMap();
    const answers = await Promise.all([
      resolveScrapImageSrc("https://a.test/1.png"),
      resolveScrapImageSrc("https://a.test/2.png"),
      resolveScrapImageSrc("https://a.test/1.png"),
    ]);
    expect(answers).toEqual(["blob:1", "https://a.test/2.png", "blob:1"]);
    expect(lookups).toEqual([["https://a.test/1.png", "https://a.test/2.png"]]);

    await resolveScrapImageSrc("https://a.test/1.png");
    expect(lookups).toHaveLength(1);
  });

  it("looks again once told a copy may have been stored since", async () => {
    serveFromMap();
    expect(await resolveScrapImageSrc("https://a.test/late.png")).toBe(
      "https://a.test/late.png",
    );
    held.set("https://a.test/late.png", "blob:late");
    forgetScrapImageSrc("https://a.test/late.png");
    expect(await resolveScrapImageSrc("https://a.test/late.png")).toBe(
      "blob:late",
    );
  });
});
