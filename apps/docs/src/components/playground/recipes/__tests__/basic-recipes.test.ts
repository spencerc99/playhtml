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
    expect(canMoveRecipe.html).toContain(
      'can-move-bounds="ph-cap-move-arena"',
    );
    expect(canToggleRecipe.html).toContain("can-toggle");
    expect(canHoverRecipe.html).toContain("can-hover");
    expect(emojiMirrorRecipe.html).toContain("can-mirror");
    expect(growingListMirrorRecipe.html).toContain("can-mirror");
  });

  it("keeps the established element ids and example assets", () => {
    expect(canMoveRecipe.html).toContain('id="ph-cap-hat"');
    expect(canMoveRecipe.html).toContain('id="ph-cap-cat"');
    expect(canMoveRecipe.html).toContain(
      'https://playhtml.fun/docs/yankees-hat.png',
    );
    expect(canMoveRecipe.html).toContain(
      'https://playhtml.fun/docs/long-cat.png',
    );
    expect(canToggleRecipe.html).toContain('id="ph-docs-toggle-demo"');
    expect(canHoverRecipe.html).toContain('id="ph-cap-hover-pad"');
    expect(emojiMirrorRecipe.html).toContain('id="emoji-pad"');
    expect(growingListMirrorRecipe.html).toContain('id="guestbook"');
    expect(sharedCounterRecipe.html).toContain('id="ph-docs-counter"');
    expect(sharedGuestbookRecipe.html).toContain(
      'id="ph-cap-docs-guestbook"',
    );
  });

  it("registers can-play elements before initialization", () => {
    for (const recipe of [sharedCounterRecipe, sharedGuestbookRecipe]) {
      const registerIndex = recipe.html.indexOf("playhtml.register(");
      const initIndex = recipe.html.indexOf("await playhtml.init");
      expect(registerIndex).toBeGreaterThan(-1);
      expect(registerIndex).toBeLessThan(initIndex);
      expect(recipe.html.indexOf("defaultData:", registerIndex)).toBeLessThan(
        initIndex,
      );
      expect(recipe.html.indexOf("updateElement:", registerIndex)).toBeLessThan(
        initIndex,
      );
    }
  });

  it("writes counter and guestbook data only from user handlers", () => {
    const counterRegister = sharedCounterRecipe.html.indexOf(
      'playhtml.register("ph-docs-counter", {',
    );
    const counterUpdate = sharedCounterRecipe.html.indexOf(
      "updateElement:",
      counterRegister,
    );
    const counterInit = sharedCounterRecipe.html.indexOf("await playhtml.init");
    expect(
      sharedCounterRecipe.html.slice(counterUpdate, counterInit),
    ).not.toContain("setData(");

    const guestbookRegister = sharedGuestbookRecipe.html.indexOf(
      "playhtml.register(guestbook, {",
    );
    const guestbookUpdate = sharedGuestbookRecipe.html.indexOf(
      "updateElement:",
      guestbookRegister,
    );
    const guestbookClick = sharedGuestbookRecipe.html.indexOf(
      "onClick:",
      guestbookRegister,
    );
    expect(
      sharedGuestbookRecipe.html.slice(guestbookUpdate, guestbookClick),
    ).not.toContain("setData(");
    expect(
      sharedGuestbookRecipe.html.slice(
        guestbookClick,
        sharedGuestbookRecipe.html.indexOf("onMount:", guestbookRegister),
      ),
    ).toContain("setData(");
    expect(sharedGuestbookRecipe.html).toContain(
      "draft.entries.splice(0, draft.entries.length - MAX_ENTRIES)",
    );
    expect(sharedGuestbookRecipe.html).toContain("at: Date.now()");
  });
});
