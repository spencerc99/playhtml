// ABOUTME: Verifies crawler metadata and social preview assets for the public sites.
// ABOUTME: Guards route-specific PlayHTML experiment cards and shared brand icons.

import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectPublicAsset(relativePath: string): void {
  expect(statSync(path.join(repoRoot, relativePath)).size).toBeGreaterThan(0);
}

describe("homepage metadata", () => {
  test("PlayHTML declares complete social metadata and a current icon", () => {
    const html = readRepoFile("website/index.html");

    expect(html).toContain(
      '<link rel="canonical" href="https://playhtml.fun/"',
    );
    expect(html).toContain('property="og:image"');
    expect(html).toContain("https://playhtml.fun/social/playhtml-home.png");
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('href="/icon.png"');
    expectPublicAsset("website/public/social/playhtml-home.png");
    expect(
      readFileSync(path.join(repoRoot, "website/public/icon.png")).equals(
        readFileSync(path.join(repoRoot, "apps/docs/public/icon.png")),
      ),
    ).toBe(true);
  });

  test("WWO declares complete social metadata and uses its extension artwork", () => {
    const html = readRepoFile("extension/website/index.html");
    const websiteIcon = readFileSync(
      path.join(repoRoot, "extension/website/public/favicon.png"),
    );
    const extensionIcon = readFileSync(
      path.join(repoRoot, "extension/public/icon/128.png"),
    );

    expect(html).toContain(
      '<link rel="canonical" href="https://wewere.online/"',
    );
    expect(html).toContain('property="og:image"');
    expect(html).toContain("https://wewere.online/social/wwo-home.png");
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(websiteIcon.equals(extensionIcon)).toBe(true);
    expectPublicAsset("extension/website/public/social/wwo-home.png");
  });
});

describe("PlayHTML experiment metadata", () => {
  const experimentCards = [
    ["one", "01"],
    ["two", "02"],
    ["3", "03"],
    ["4", "04"],
    ["5", "05"],
    ["6", "06"],
    ["7", "07"],
    ["8", "08"],
    ["9", "09"],
    ["cinderblock", "10"],
  ] as const;

  for (const [route, cardNumber] of experimentCards) {
    test(`${route} uses its own preview image`, () => {
      const html = readRepoFile(`website/experiments/${route}/index.html`);
      const imageUrl = `https://playhtml.fun/experiments/index-previews/ex-${cardNumber}.png`;

      expect(html).toContain('property="og:image"');
      expect(html).toContain(imageUrl);
      expect(html).toContain(
        'name="twitter:card" content="summary_large_image"',
      );
      expect(html).toContain('name="twitter:image"');
      expectPublicAsset(
        `website/public/experiments/index-previews/ex-${cardNumber}.png`,
      );
    });
  }
});

describe("WWO visualization metadata", () => {
  for (const route of ["archive", "portrait", "conversations", "keypresses"]) {
    test(`${route} uses its own preview image`, () => {
      const html = readRepoFile(`extension/website/${route}/index.html`);
      const imageUrl = `https://wewere.online/social/wwo-${route}.png`;

      expect(html).toContain('property="og:image"');
      expect(html).toContain(imageUrl);
      expect(html).toContain(
        `<link rel="canonical" href="https://wewere.online/${route}/"`,
      );
      expect(html).toContain(
        'name="twitter:card" content="summary_large_image"',
      );
      expect(html).toContain('name="twitter:image"');
      expectPublicAsset(`extension/website/public/social/wwo-${route}.png`);
    });
  }
});

describe("docs metadata", () => {
  test("uses an absolute site URL and the PlayHTML overview image", () => {
    const config = readRepoFile("apps/docs/astro.config.mjs");
    const head = readRepoFile("apps/docs/src/components/HeadOverride.astro");

    expect(config).toContain('site: "https://playhtml.fun"');
    expect(head).toContain('property="og:image"');
    expect(head).toContain(
      "https://playhtml.fun/docs/how-playhtml-works-overview.png",
    );
    expect(head).toContain('name="twitter:image"');
    expectPublicAsset("apps/docs/public/icon.png");
    expectPublicAsset("apps/docs/public/how-playhtml-works-overview.png");
  });
});
