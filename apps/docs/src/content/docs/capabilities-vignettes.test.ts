// ABOUTME: Verifies the capabilities page renders finished live capability demos.
// ABOUTME: Guards against placeholder demos and mismatched capability examples.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const capabilitiesPage = readFileSync(join(import.meta.dir, "capabilities.mdx"), "utf8");
const vignetteScript = readFileSync(
  join(import.meta.dir, "../../../public/can-mirror-vignettes.js"),
  "utf8",
);

describe("capabilities can-mirror vignettes", () => {
  test("links can-mirror to the dedicated examples", () => {
    expect(capabilitiesPage).not.toContain("TODO-DEMO");
    expect(capabilitiesPage).toContain(
      "Full treatment with live demos lives on **[Custom elements → can-mirror]",
    );
    expect(capabilitiesPage).toContain(
      "the [mirror playground](/docs/advanced/mirror-playground/)",
    );
    expect(vignetteScript).toContain('emojiOnly = /\\p{Extended_Pictographic}/gu');
    expect(vignetteScript).toContain('emojiPad.addEventListener("input"');
  });

  test("keeps can-mirror vignette support available for linked examples", () => {
    expect(vignetteScript).toContain("appendChild(");
    expect(vignetteScript).toContain("new Date().toLocaleTimeString()");
  });
});

describe("capabilities can-hover demo", () => {
  test("renders the built-in can-hover React component", () => {
    expect(capabilitiesPage).toContain(
      "import { CanHoverDemo } from '@/components/react/capability-demos/CanHoverDemo';",
    );
    expect(capabilitiesPage).toContain("<CanHoverDemo client:only=\"react\" />");
  });
});
