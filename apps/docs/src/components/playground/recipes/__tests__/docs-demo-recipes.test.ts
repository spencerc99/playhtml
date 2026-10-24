// ABOUTME: Verifies the recipes behind the docs' doodle, prize wheel, presence, and event demos.
// ABOUTME: Guards complete documents, parseable scripts, registry coverage, and bounded writes.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { doodleStripRecipe } from "../doodle-strip";
import { liveReactionsRecipe, rainEventRecipe } from "../events-basics";
import { exampleRecipes } from "../index";
import { onlineIndicatorRecipe } from "../online-indicator";
import { prizeWheelRecipe } from "../prize-wheel";

const recipes = [
  doodleStripRecipe,
  prizeWheelRecipe,
  onlineIndicatorRecipe,
  rainEventRecipe,
  liveReactionsRecipe,
];

const DEPRECATED = [
  "updateElement",
  "myDefaultAwareness",
  "setMyAwareness",
  "awareness",
  "playerIdentity",
];

function moduleScript(html: string): string {
  return html.match(/<script type="module">([\s\S]*?)<\/script>/)![1];
}

describe("docs demo recipes", () => {
  it.each(recipes.map((recipe) => [recipe.id, recipe]))(
    "%s is a complete, registered document",
    (_id, recipe) => {
      expect(exampleRecipes).toContain(recipe);
      expect(recipe.docsHref).toBe(`/docs/examples/${recipe.id}/`);
      expect(recipe.html).toContain("<!doctype html>");
      expect(recipe.html).toContain("await playhtml.init(");
      expect(recipe.html).toMatch(/\sid="[^"]+"/);
      expect(recipe.react?.code).toContain("export default function App()");

      const { diagnostics = [] } = ts.transpileModule(
        moduleScript(recipe.html),
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          reportDiagnostics: true,
        },
      );
      expect(diagnostics).toEqual([]);

      for (const name of DEPRECATED) {
        expect(recipe.html).not.toContain(name);
        expect(recipe.react?.code).not.toContain(name);
      }
    },
  );

  it("keeps the doodle strip bounded and shares only finished doodles", () => {
    const script = moduleScript(doodleStripRecipe.html);
    expect(script).toContain("data.doodles.splice(0,");
    // The one shared write lives in the "Add to row" click handler.
    expect(script.match(/setData\(/g)).toHaveLength(1);
    expect(script.indexOf("setData(")).toBeGreaterThan(
      script.indexOf('getElementById("doodle-add")'),
    );
  });

  it("registers event listeners before anyone can dispatch", () => {
    expect(rainEventRecipe.html).toContain(
      'rain: { type: "rain", onEvent: makeItRain }',
    );
    expect(liveReactionsRecipe.html).toContain(
      'reaction: { type: "reaction", onEvent: burst }',
    );
  });

  it("imports the view helpers the prize wheel uses", () => {
    expect(prizeWheelRecipe.html).toContain(
      'import { playhtml, html, nothing } from "playhtml"',
    );
  });
});
