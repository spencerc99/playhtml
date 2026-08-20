// ABOUTME: Tests room host resolution for regular pages and embedded examples.
// ABOUTME: Ensures srcdoc frames share the embedding page's room namespace.
import { describe, expect, it } from "vitest";
import { resolveRoomHost } from "../roomHost";

describe("resolveRoomHost", () => {
  it("uses the current page host when one is available", () => {
    expect(
      resolveRoomHost(
        { host: "playhtml.fun", protocol: "https:" },
        "https://elsewhere.example/",
      ),
    ).toBe("playhtml.fun");
  });

  it("uses the embedding page host for an about:srcdoc document", () => {
    expect(
      resolveRoomHost(
        { host: "", protocol: "about:" },
        "https://playhtml.fun/docs/capabilities/",
      ),
    ).toBe("playhtml.fun");
  });

  it("keeps an empty host for local files", () => {
    expect(
      resolveRoomHost({ host: "", protocol: "file:" }, ""),
    ).toBe("");
  });
});
