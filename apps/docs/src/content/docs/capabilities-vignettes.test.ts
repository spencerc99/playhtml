// ABOUTME: Verifies the capabilities page renders finished live vignette markup.
// ABOUTME: Guards against placeholder demos replacing the can-mirror examples.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const capabilitiesPage = readFileSync(join(import.meta.dir, "capabilities.mdx"), "utf8");
const vignetteScript = readFileSync(
  join(import.meta.dir, "../../../public/can-mirror-vignettes.js"),
  "utf8",
);

describe("capabilities can-mirror vignettes", () => {
  test("renders an emoji-only textarea live preview", () => {
    expect(capabilitiesPage).not.toContain("TODO-DEMO");
    expect(capabilitiesPage).toContain('<textarea can-mirror id="emoji-pad"');
    expect(capabilitiesPage).toContain('data-can-mirror-vignette="emoji"');
    expect(capabilitiesPage).toContain('src="/docs/can-mirror-vignettes.js"');
    expect(vignetteScript).toContain('emojiOnly = /\\p{Extended_Pictographic}/gu');
    expect(vignetteScript).toContain('emojiPad.addEventListener("input"');
  });

  test("renders a shared guestbook live preview", () => {
    expect(capabilitiesPage).toContain('<ul can-mirror id="guestbook"');
    expect(capabilitiesPage).toContain('data-can-mirror-vignette="guestbook"');
    expect(vignetteScript).toContain("appendChild(");
    expect(vignetteScript).toContain("new Date().toLocaleTimeString()");
  });
});
