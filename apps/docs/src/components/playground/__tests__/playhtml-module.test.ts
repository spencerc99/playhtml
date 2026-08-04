// ABOUTME: Verifies the sandbox module is self-contained before recipe frames import it.
// ABOUTME: Prevents built PlayHTML chunks from retaining unusable relative imports.
import { describe, expect, it } from "vitest";
import { makePlayhtmlModuleUrl } from "../playhtml-module";

function collectModuleSources(moduleUrl: string, seen = new Set<string>()): string[] {
  if (seen.has(moduleUrl)) return [];
  seen.add(moduleUrl);

  const source = atob(moduleUrl.slice(moduleUrl.indexOf(",") + 1));
  const embeddedModuleUrls = source.match(
    /data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,
  ) ?? [];

  return [
    source,
    ...embeddedModuleUrls.flatMap((url) => collectModuleSources(url, seen)),
  ];
}

describe("makePlayhtmlModuleUrl", () => {
  it("inlines every package chunk into data URLs", () => {
    const moduleUrl = makePlayhtmlModuleUrl();
    const moduleSources = collectModuleSources(moduleUrl);

    expect(moduleUrl).toMatch(/^data:text\/javascript;base64,/);
    expect(moduleSources.length).toBeGreaterThan(3);
    expect(moduleSources).toSatisfy((sources: string[]) =>
      sources.every(
        (source) =>
          !/(?:from\s+|import\()\s*["']\.\//.test(source) &&
          !source.includes('"./leafEditor.es.js"'),
      ),
    );
    expect(moduleSources).toSatisfy((sources: string[]) =>
      sources.some((source) =>
        source.includes("globalThis.__playhtmlListSharedElements = "),
      ),
    );
  });
});
