// ABOUTME: Tests for browser install links in the homepage download gate.
// ABOUTME: Verifies desktop visitors get direct install links for supported browsers.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DownloadGate } from "../DownloadGate";

const EDGE_DOWNLOAD_URL =
  "https://microsoftedge.microsoft.com/addons/detail/we-were-online/kiamoecdnaglmhigmbmdkiodbbphpodl";

vi.mock("../DownloadGate.module.scss", () => ({
  default: {
    gate: "gate",
    desktopOnly: "desktopOnly",
    mobileOnly: "mobileOnly",
    downloadGroup: "downloadGroup",
    downloadGroupLarge: "downloadGroupLarge",
    downloadLabel: "downloadLabel",
    downloadLink: "downloadLink",
    form: "form",
    row: "row",
    input: "input",
    submit: "submit",
    subtext: "subtext",
  },
}));

describe("DownloadGate", () => {
  it("renders compact desktop browser download links", () => {
    const html = renderToStaticMarkup(<DownloadGate />);

    expect(html).toContain('install:');
    expect(html).toContain('>Chrome</a>');
    expect(html).toContain('>Firefox</a>');
    expect(html).toContain('>Edge</a>');
    expect(html).not.toContain('install for Chrome');
    expect(html).not.toContain('install for Firefox');
    expect(html).not.toContain('install for Edge');
    expect(html).toContain(`href="${EDGE_DOWNLOAD_URL}"`);
  });
});
