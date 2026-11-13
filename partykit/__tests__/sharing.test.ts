// ABOUTME: Verifies parsing of the shared-element declarations in a connection URL.
// ABOUTME: Covers well-formed entries and malformed entries that must be dropped.
import { describe, expect, it } from "bun:test";
import {
  parseSharedElementsFromUrl,
  parseSharedReferencesFromUrl,
} from "../sharing";

function connectionUrl(params: Record<string, string>): string {
  const url = new URL("https://api.playhtml.fun/parties/main/room");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

describe("parseSharedReferencesFromUrl", () => {
  it("keeps well-formed references", () => {
    const url = connectionUrl({
      sharedReferences: JSON.stringify([
        { domain: "example.com", path: "/a", elementId: "door" },
      ]),
    });
    expect(parseSharedReferencesFromUrl(url)).toEqual([
      { domain: "example.com", path: "/a", elementId: "door" },
    ]);
  });

  it("drops malformed references instead of passing them on", () => {
    const url = connectionUrl({
      sharedReferences: JSON.stringify([
        null,
        "door",
        { domain: "example.com", path: 7, elementId: "door" },
        { domain: "example.com", path: "/a", elementId: { id: "door" } },
        { domain: "example.com", path: "/a", elementId: "" },
        { domain: "example.com", path: "/a", elementId: "lamp" },
      ]),
    });
    expect(parseSharedReferencesFromUrl(url)).toEqual([
      { domain: "example.com", path: "/a", elementId: "lamp" },
    ]);
  });

  it("returns nothing for missing or invalid JSON", () => {
    expect(parseSharedReferencesFromUrl(connectionUrl({}))).toEqual([]);
    expect(
      parseSharedReferencesFromUrl(connectionUrl({ sharedReferences: "{" }))
    ).toEqual([]);
  });
});

describe("parseSharedElementsFromUrl", () => {
  it("keeps elements and their declared permissions", () => {
    const url = connectionUrl({
      sharedElements: JSON.stringify([
        { elementId: "door", permissions: "read-only", path: "/a" },
        { elementId: "lamp", permissions: "read-write" },
        { elementId: "rug" },
      ]),
    });
    expect(parseSharedElementsFromUrl(url)).toEqual([
      { elementId: "door", permissions: "read-only" },
      { elementId: "lamp", permissions: "read-write" },
      { elementId: "rug", permissions: undefined },
    ]);
  });

  it("drops entries without an element id and ignores non-string permissions", () => {
    const url = connectionUrl({
      sharedElements: JSON.stringify([
        null,
        { permissions: "read-only" },
        { elementId: 4 },
        { elementId: "door", permissions: ["read-only"] },
      ]),
    });
    expect(parseSharedElementsFromUrl(url)).toEqual([
      { elementId: "door", permissions: undefined },
    ]);
  });
});
