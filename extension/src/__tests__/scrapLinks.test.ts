// ABOUTME: Tests which stored scrap URLs may become links on an extension page.
// ABOUTME: Guards that non-web schemes never reach an href.

import { describe, expect, it } from "vitest";
import { webPageHref } from "../entrypoints/scraps/scrapLinks";

describe("webPageHref", () => {
  it("allows an https page", () => {
    expect(webPageHref("https://example.test/a?b=1#c")).toBe(
      "https://example.test/a?b=1#c",
    );
  });

  it("allows a plain http page", () => {
    expect(webPageHref("http://127.0.0.1:8080/page")).toBe(
      "http://127.0.0.1:8080/page",
    );
  });

  it("refuses a javascript URL", () => {
    expect(webPageHref("javascript:alert(1)")).toBeNull();
  });

  it("refuses a javascript URL whose scheme is disguised by case and spacing", () => {
    expect(webPageHref("  JaVaScRiPt:alert(1)")).toBeNull();
  });

  it("refuses a data URL", () => {
    expect(webPageHref("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses other privileged schemes", () => {
    expect(webPageHref("chrome-extension://abc/page.html")).toBeNull();
    expect(webPageHref("file:///etc/passwd")).toBeNull();
    expect(webPageHref("blob:https://example.test/abc")).toBeNull();
  });

  it("refuses a malformed or relative URL", () => {
    expect(webPageHref("not a url")).toBeNull();
    expect(webPageHref("/just/a/path")).toBeNull();
  });

  it("refuses an empty or missing value", () => {
    expect(webPageHref("")).toBeNull();
    expect(webPageHref("   ")).toBeNull();
    expect(webPageHref(undefined as unknown as string)).toBeNull();
  });
});
