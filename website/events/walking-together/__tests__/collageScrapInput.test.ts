// ABOUTME: Tests the film strip drag payload the table collage accepts.
// ABOUTME: Covers round trips, rejected outside drags, and non-web URLs.

import { describe, it, expect } from "vitest";
import {
  isScrapDrag,
  isWebUrl,
  SCRAP_DRAG_TYPE,
  scrapDragPayload,
  scrapInputFromDrag,
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

  it("round-trips a strip scrap through a drag", () => {
    const input = {
      src: "https://cdn.test/cat.jpg",
      pageUrl: "https://blog.test/post",
      alt: "a cat",
      naturalWidth: 400,
      naturalHeight: 300,
    };
    expect(
      scrapInputFromDrag(transfer({ [SCRAP_DRAG_TYPE]: scrapDragPayload(input) })),
    ).toEqual(input);
  });

  it("ignores images and links dragged in from other tabs", () => {
    const outside = transfer({
      "text/html": '<img src="https://cdn.test/cat.jpg">',
      "text/uri-list": "https://cdn.test/cat.jpg",
      "text/plain": "https://cdn.test/cat.jpg",
    });
    expect(isScrapDrag(outside.types)).toBe(false);
    expect(scrapInputFromDrag(outside)).toBeNull();
  });

  it("rejects malformed or non-web payloads", () => {
    expect(scrapInputFromDrag(transfer({ [SCRAP_DRAG_TYPE]: "not json" }))).toBeNull();
    expect(
      scrapInputFromDrag(
        transfer({ [SCRAP_DRAG_TYPE]: JSON.stringify({ src: "data:image/png;base64,AA" }) }),
      ),
    ).toBeNull();
    expect(
      scrapInputFromDrag(
        transfer({
          [SCRAP_DRAG_TYPE]: JSON.stringify({ src: "https://a.test/x.png", pageUrl: "javascript:1" }),
        }),
      ),
    ).toEqual({ src: "https://a.test/x.png" });
  });
});
