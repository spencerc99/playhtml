// ABOUTME: Verifies the sandbox module is self-contained before recipe frames import it.
// ABOUTME: Prevents built PlayHTML chunks from retaining unusable relative imports.
import { describe, expect, it } from "vitest";
import { makePlayhtmlModuleUrl } from "../playhtml-module";

describe("makePlayhtmlModuleUrl", () => {
  it("inlines the leaf editor dependency into a data URL", () => {
    const moduleUrl = makePlayhtmlModuleUrl();
    const source = atob(moduleUrl.slice(moduleUrl.indexOf(",") + 1));

    expect(moduleUrl).toMatch(/^data:text\/javascript;base64,/);
    expect(source).not.toContain('"./leafEditor.es.js"');
    expect(source).toContain('from "data:text/javascript;base64,');
  });
});
