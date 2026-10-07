// ABOUTME: Verifies recipe iframes receive the requested room and panel behavior.
// ABOUTME: Protects the shared wrapper used by full playground and inline docs embeds.
import { describe, expect, it } from "vitest";
import { buildIframeSrcdoc } from "../iframe-template";

const recipeHtml = "<!doctype html><html><head><title>Test</title></head><body></body></html>";

describe("buildIframeSrcdoc", () => {
  it("injects the shared room and hides development chrome for docs embeds", () => {
    const result = buildIframeSrcdoc({
      recipeHtml,
      playhtmlUrl: "blob:test",
      roomId: "example-test-abcd1234",
      showDevPanel: false,
    });

    expect(result).toContain('const FORCED_ROOM = "example-test-abcd1234"');
    expect(result).toContain("#playhtml-dev-root { display: none !important; }");
    expect(result).toContain('for (const storageName of ["localStorage", "sessionStorage"])');
    expect(result).toContain("makeMemoryStorage()");
    expect(result).not.toContain("trigger.click()");
  });

  it("opens the development panel in the playground", () => {
    const result = buildIframeSrcdoc({
      recipeHtml,
      playhtmlUrl: "blob:test",
      roomId: "edit-test-abcd1234",
    });

    expect(result).toContain("trigger.click()");
    expect(result).toContain('root.dataset.position = "bottom"');
  });

  it("escapes room ids before embedding them in an inline script", () => {
    const result = buildIframeSrcdoc({
      recipeHtml,
      playhtmlUrl: "blob:test",
      roomId: '</script><script>window.injected = true</script>',
    });

    expect(result).not.toContain('</script><script>window.injected');
    expect(result).toContain('\\u003c/script>\\u003cscript>window.injected');
  });
});
