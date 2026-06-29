// ABOUTME: Tests for turning extension release notes into public changelog entries.
// ABOUTME: Verifies version headings, bullets, images, and video media references.

import { describe, expect, test } from "vitest";
import { parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  test("returns releases with bullets and dates", () => {
    const changelog = `# @playhtml/extension

## 0.1.19 (2026-06-17)

- Added a public changelog.
- Linked the popup to release notes.

## 0.1.18 (2026-06-16)

- Reduced background work.
`;

    expect(parseChangelog(changelog)).toEqual([
      {
        version: "0.1.19",
        date: "2026-06-17",
        blocks: [
          { type: "bullet", text: "Added a public changelog." },
          { type: "bullet", text: "Linked the popup to release notes." },
        ],
      },
      {
        version: "0.1.18",
        date: "2026-06-16",
        blocks: [{ type: "bullet", text: "Reduced background work." }],
      },
    ]);
  });

  test("parses images and video image syntax as media blocks", () => {
    const changelog = `# @playhtml/extension

## 0.1.20 (2026-06-17)

- Cursor trails now look like ink.
![Cursor trails](/changelog/media/cursor-trails.png)
![video: Cursor trail demo](/changelog/media/cursor-trails.mp4)
`;

    expect(parseChangelog(changelog)[0].blocks).toEqual([
      { type: "bullet", text: "Cursor trails now look like ink." },
      {
        type: "image",
        alt: "Cursor trails",
        src: "/changelog/media/cursor-trails.png",
      },
      {
        type: "video",
        title: "Cursor trail demo",
        src: "/changelog/media/cursor-trails.mp4",
      },
    ]);
  });

  test("keeps nested changelog headings as release content", () => {
    const changelog = `# @playhtml/extension

## 0.1.9

### Patch Changes

- Updated dependencies.
`;

    expect(parseChangelog(changelog)).toEqual([
      {
        version: "0.1.9",
        blocks: [
          { type: "heading", text: "Patch Changes" },
          { type: "bullet", text: "Updated dependencies." },
        ],
      },
    ]);
  });
});
