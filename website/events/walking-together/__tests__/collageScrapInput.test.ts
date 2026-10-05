// ABOUTME: Tests how dropped and pasted payloads become scrap inputs for the table collage.
// ABOUTME: Covers HTML image drags, uri-lists, plain links, and rejected non-web URLs.

import { describe, it, expect } from "vitest";
import {
  dragMayCarryScrap,
  imageFromHtml,
  isWebUrl,
  scrapInputFromDataTransfer,
  scrapInputFromText,
  urisFromList,
} from "../collage/scrapInput";

const transfer = (payload: Record<string, string>) => ({
  types: Object.keys(payload),
  getData: (format: string) => payload[format] ?? "",
});

describe("scrap input", () => {
  it("accepts only http(s) URLs", () => {
    expect(isWebUrl("https://a.test/x.png")).toBe(true);
    expect(isWebUrl("http://a.test/x.png")).toBe(true);
    expect(isWebUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isWebUrl("blob:https://a.test/123")).toBe(false);
    expect(isWebUrl("x.png")).toBe(false);
  });

  it("reads the image, its alt, and its surrounding link from dragged HTML", () => {
    const html =
      '<a href="https://blog.test/post"><img src="https://cdn.test/cat.jpg" alt="a cat"></a>';
    expect(imageFromHtml(html)).toEqual({
      src: "https://cdn.test/cat.jpg",
      alt: "a cat",
      href: "https://blog.test/post",
    });
    expect(
      scrapInputFromDataTransfer(
        transfer({
          "text/html": html,
          "text/uri-list": "https://blog.test/post",
        }),
      ),
    ).toEqual({
      src: "https://cdn.test/cat.jpg",
      alt: "a cat",
      pageUrl: "https://blog.test/post",
    });
  });

  it("ignores HTML without a usable image and falls back to the uri-list", () => {
    expect(imageFromHtml("<p>hello</p>")).toBeNull();
    expect(imageFromHtml('<img src="/relative.png">')).toBeNull();
    expect(
      scrapInputFromDataTransfer(
        transfer({
          "text/html": "<p>hi</p>",
          "text/uri-list": "# comment\nhttps://cdn.test/a.png\nhttps://cdn.test/b.png",
        }),
      ),
    ).toEqual({ src: "https://cdn.test/a.png" });
  });

  it("parses uri-lists, skipping comments and non-web lines", () => {
    expect(urisFromList("#c\r\nhttps://a.test/1\r\nfile:///x\r\n")).toEqual([
      "https://a.test/1",
    ]);
  });

  it("takes a plain-text link and rejects plain text", () => {
    expect(
      scrapInputFromDataTransfer(transfer({ "text/plain": " https://a.test/x.gif " })),
    ).toEqual({ src: "https://a.test/x.gif" });
    expect(scrapInputFromDataTransfer(transfer({ "text/plain": "hello" }))).toBeNull();
    expect(scrapInputFromDataTransfer(transfer({ Files: "" }))).toBeNull();
    expect(scrapInputFromText("nope")).toBeNull();
  });

  it("lights up the drop target for text-ish drags only", () => {
    expect(dragMayCarryScrap(["text/uri-list"])).toBe(true);
    expect(dragMayCarryScrap(["Files"])).toBe(false);
  });
});
