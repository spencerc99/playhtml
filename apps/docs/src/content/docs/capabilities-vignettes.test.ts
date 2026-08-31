// ABOUTME: Verifies the capabilities page renders finished live capability demos.
// ABOUTME: Guards against placeholder demos and mismatched capability examples.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const capabilitiesPage = readFileSync(
  join(import.meta.dir, "capabilities.mdx"),
  "utf8",
);
const customElementsPage = readFileSync(
  join(import.meta.dir, "custom-elements.mdx"),
  "utf8",
);
const mirrorRecipes = readFileSync(
  join(import.meta.dir, "../../components/playground/recipes/mirror-basics.ts"),
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
    expect(customElementsPage).toContain("<RecipeExample");
    expect(customElementsPage).toContain("recipe={emojiMirrorRecipe}");
    expect(customElementsPage).toContain("recipe={growingListMirrorRecipe}");
    expect(mirrorRecipes).toContain('emojiPad.addEventListener("input"');
  });

  test("keeps both can-mirror demos in the canonical recipe registry", () => {
    expect(mirrorRecipes).toContain('id: "emoji-mirror"');
    expect(mirrorRecipes).toContain('id: "growing-list-mirror"');
    expect(mirrorRecipes).toContain("list.appendChild(item)");
  });
});

describe("capabilities can-hover demo", () => {
  test("renders the canonical can-hover recipe", () => {
    expect(capabilitiesPage).toContain("canHoverRecipe,");
    expect(capabilitiesPage).toContain("<RecipeExample");
    expect(capabilitiesPage).toContain("recipe={canHoverRecipe}");
  });
});
