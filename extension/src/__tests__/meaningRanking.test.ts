import { describe, expect, it } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  meaningMatches,
  unreadPictures,
} from "../entrypoints/scraps/meaning/meaningRanking";

function unit(...values: number[]): Float32Array {
  const length = Math.hypot(...values);
  return Float32Array.from(values.map((value) => value / length));
}

function image(src: string, ts: number): ScrapItem {
  return {
    id: src,
    key: `image:${src}`,
    kind: "image",
    src,
    naturalWidth: 10,
    naturalHeight: 10,
    pageTitle: "",
    domain: "example.com",
    pageUrl: "https://example.com",
    ts,
  };
}

describe("meaningMatches", () => {
  it("keeps only pictures at or above the threshold, with their scores", () => {
    const query = unit(1, 0);
    const vectors = new Map<string, Float32Array | null>([
      ["eye.png", unit(1, 0.1)],
      ["bolt.png", unit(0, 1)],
      ["unreadable.svg", null],
    ]);
    const matches = meaningMatches(query, vectors, 0.5);
    expect([...matches.keys()]).toEqual(["eye.png"]);
    expect(matches.get("eye.png")).toBeCloseTo(0.995, 2);
  });
});

describe("unreadPictures", () => {
  it("lists unread picture addresses once each, newest first", () => {
    const items: ScrapItem[] = [
      image("a.png", 1),
      image("b.png", 3),
      image("a.png", 5),
      image("read.png", 9),
      {
        ...image("x", 7),
        kind: "heading",
        text: "hi",
        level: 1,
        styles: {},
      } as ScrapItem,
    ];
    expect(unreadPictures(items, new Map([["read.png", null]]))).toEqual([
      "a.png",
      "b.png",
    ]);
  });
});
