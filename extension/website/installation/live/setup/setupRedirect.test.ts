// ABOUTME: Verifies the previous live installation setup URL remains a redirect.
// ABOUTME: Protects existing bookmarks while the setup interface lives under admin.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("installation setup redirect", () => {
  it("redirects browsers and no-script visitors to the installation office", () => {
    const html = readFileSync("website/installation/live/setup/index.html", "utf8");

    expect(html).toContain('content="0; url=/admin/installation/"');
    expect(html).toContain('window.location.replace("/admin/installation/")');
    expect(html).toContain('href="/admin/installation/"');
  });
});
