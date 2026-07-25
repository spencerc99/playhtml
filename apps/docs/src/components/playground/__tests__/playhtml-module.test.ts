// ABOUTME: Verifies the sandbox module is self-contained before recipe frames import it.
// ABOUTME: Prevents built PlayHTML chunks from retaining unusable relative imports.
import { describe, expect, it } from "vitest";
import { makePlayhtmlModuleUrl } from "../playhtml-module";

describe("makePlayhtmlModuleUrl", () => {
  it("inlines every package chunk into data URLs", () => {
    const moduleUrl = makePlayhtmlModuleUrl();
    const source = atob(moduleUrl.slice(moduleUrl.indexOf(",") + 1));
    const sharedChunkUrl = source.match(
      /from "(data:text\/javascript;base64,[^"]+)"/,
    )?.[1];

    expect(moduleUrl).toMatch(/^data:text\/javascript;base64,/);
    expect(sharedChunkUrl).toBeDefined();
    expect(source).not.toMatch(/from "\.\//);
    expect(source).not.toContain('"./leafEditor.es.js"');

    const sharedChunkSource = atob(
      sharedChunkUrl!.slice(sharedChunkUrl!.indexOf(",") + 1),
    );
    expect(sharedChunkSource).not.toContain('import "./leafEditor.es.js"');
    expect(sharedChunkSource).not.toMatch(/import\("\.\/development-/);
    expect(sharedChunkSource).toContain(
      "globalThis.__playhtmlListSharedElements = ",
    );
  });
});
