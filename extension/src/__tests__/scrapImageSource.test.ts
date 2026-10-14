// ABOUTME: Tests how a scrap image's display source is resolved, with and without local copies.
// ABOUTME: Uses a real in-memory lookup rather than a stub, and checks lookups are batched per tick.

import { afterEach, describe, expect, it } from "vitest";
import {
  forgetScrapImageSrc,
  provideLocalScrapImages,
  prioritizeScrapPreviews,
  resolveScrapImageSrc,
  resolveScrapPreviewSrc,
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

describe("tile previews", () => {
  it("keeps original resolution separate and falls back to held originals", async () => {
    const originals = new Map([
      ["a", "blob:original-a"],
      ["b", "blob:original-b"],
    ]);
    const previews = new Map([["a", "blob:preview-a"]]);
    provideLocalScrapImages(
      async () => originals,
      async () => previews,
    );
    expect(await resolveScrapPreviewSrc("a")).toBe("blob:preview-a");
    expect(await resolveScrapImageSrc("a")).toBe("blob:original-a");
    expect(await resolveScrapPreviewSrc("b")).toBe("blob:original-b");
    previews.set("b", "blob:preview-b");
    expect(await resolveScrapPreviewSrc("b")).toBe("blob:preview-b");
  });

  it("settles each preview independently and drops caches when providers change", async () => {
    let finishSlow!: () => void;
    provideLocalScrapImages(
      async () => new Map(),
      async (srcs) => {
        if (srcs.includes("slow"))
          await new Promise<void>((resolve) => {
            finishSlow = resolve;
          });
        return new Map(srcs.map((src) => [src, `blob:preview-${src}`]));
      },
    );
    const slow = resolveScrapPreviewSrc("slow");
    expect(await resolveScrapPreviewSrc("fast")).toBe("blob:preview-fast");
    finishSlow();
    expect(await slow).toBe("blob:preview-slow");
    provideLocalScrapImages(
      async () => new Map([["fast", "blob:new-original"]]),
    );
    expect(await resolveScrapPreviewSrc("fast")).toBe("blob:new-original");
  });
});

describe("preview priorities", () => {
  it("reports current sources independently of existing resolution and resets the provider", async () => {
    const priorities: string[][] = [];
    let finish!: (value: Map<string, string>) => void;
    provideLocalScrapImages(
      async () => new Map(),
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      (srcs) => priorities.push([...srcs]),
    );
    const pending = resolveScrapPreviewSrc("queued");
    await Promise.resolve();
    prioritizeScrapPreviews(["queued"]);
    prioritizeScrapPreviews([]);
    expect(priorities).toEqual([["queued"], []]);
    finish(new Map([["queued", "blob:preview"]]));
    expect(await pending).toBe("blob:preview");
    provideLocalScrapImages(async () => new Map());
    prioritizeScrapPreviews(["other"]);
    expect(priorities).toHaveLength(2);
  });
});
