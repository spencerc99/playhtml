// ABOUTME: Verifies the canonical basic recipes are complete and safe to remix.
// ABOUTME: Guards stable ids, setup ordering, bounded writes, and registry coverage.
import { describe, expect, it } from "vitest";
import {
  canHoverRecipe,
  canMoveRecipe,
  canToggleRecipe,
} from "../built-in-capabilities";
import { emojiMirrorRecipe, growingListMirrorRecipe } from "../mirror-basics";
import {
  sharedCounterRecipe,
  sharedGuestbookRecipe,
} from "../shared-state-basics";

const recipes = [
  canMoveRecipe,
  canToggleRecipe,
  canHoverRecipe,
  emojiMirrorRecipe,
  growingListMirrorRecipe,
  sharedCounterRecipe,
  sharedGuestbookRecipe,
];

describe("basic canonical recipes", () => {
  it("provides complete documents with unique ids and detail pages", () => {
    expect(new Set(recipes.map((recipe) => recipe.id)).size).toBe(
      recipes.length,
    );

    for (const recipe of recipes) {
      expect(recipe.html).toContain("<!doctype html>");
      expect(recipe.html).toContain('import { playhtml } from "playhtml"');
      expect(recipe.html).toContain("await playhtml.init");
      expect(recipe.docsHref).toBe(`/docs/examples/${recipe.id}/`);
      expect(recipe.html).toMatch(/\sid="[^"]+"/);
    }
  });

  it("keeps built-in capability markup in the runnable source", () => {
    expect(canMoveRecipe.html).toContain("can-move");
    expect(canMoveRecipe.html).toContain('can-move-bounds="move-arena"');
    expect(canToggleRecipe.html).toContain("can-toggle");
    expect(canHoverRecipe.html).toContain("can-hover");
    expect(emojiMirrorRecipe.html).toContain("can-mirror");
    expect(growingListMirrorRecipe.html).toContain("can-mirror");
  });

  it("configures can-play elements before initialization", () => {
    for (const recipe of [sharedCounterRecipe, sharedGuestbookRecipe]) {
      const initIndex = recipe.html.indexOf("await playhtml.init");
      expect(recipe.html.indexOf(".defaultData")).toBeLessThan(initIndex);
      expect(recipe.html.indexOf(".updateElement")).toBeLessThan(initIndex);
    }
  });

  it("writes counter and guestbook data only from user handlers", () => {
    const counterUpdate = sharedCounterRecipe.html.indexOf(
      "counter.updateElement",
    );
    const counterInit = sharedCounterRecipe.html.indexOf("await playhtml.init");
    expect(
      sharedCounterRecipe.html.slice(counterUpdate, counterInit),
    ).not.toContain("setData(");

    const guestbookUpdate = sharedGuestbookRecipe.html.indexOf(
      "guestbook.updateElement",
    );
    const guestbookClick = sharedGuestbookRecipe.html.indexOf(
      "guestbook.onClick",
    );
    expect(
      sharedGuestbookRecipe.html.slice(guestbookUpdate, guestbookClick),
    ).not.toContain("setData(");
    expect(
      sharedGuestbookRecipe.html.slice(
        guestbookClick,
        sharedGuestbookRecipe.html.indexOf("guestbook.onMount"),
      ),
    ).toContain("setData(");
    expect(sharedGuestbookRecipe.html).toContain(
      "draft.entries.splice(0, draft.entries.length - MAX_ENTRIES)",
    );
  });
});
