// ABOUTME: Verifies canonical playground recipes and explicit shared rooms load from hashes.
// ABOUTME: Guards fallback behavior so broken example links never produce an empty editor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseHash } from "../recipe-loader";
import type { RunnableRecipe } from "../recipes/types";

const starter: RunnableRecipe = { id: "_starter", html: "<p>starter</p>" };
const sound: RunnableRecipe = { id: "synchronized-sound", html: "<p>sound</p>" };

function findRecipe(id: string): RunnableRecipe | undefined {
  return [starter, sound].find((recipe) => recipe.id === id);
}

describe("parseHash", () => {
  beforeEach(() => localStorage.clear());

  it("loads a canonical example into an explicit shared room", () => {
    const loaded = parseHash(
      "#id=synchronized-sound&room=example-synchronized-sound-1234abcd",
      findRecipe,
      starter,
    );

    expect(loaded).toEqual({
      recipeId: "synchronized-sound",
      source: "<p>sound</p>",
      roomId: "example-synchronized-sound-1234abcd",
      fromPayload: false,
    });
  });

  it("falls back when a recipe id is unknown", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loaded = parseHash("#id=missing", findRecipe, starter);

    expect(loaded.recipeId).toBe("_starter");
    expect(loaded.source).toBe(starter.html);
    expect(loaded.roomId).toMatch(/^edit-_starter-/);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects malformed room ids", () => {
    const loaded = parseHash(
      "#id=synchronized-sound&room=../../not-a-room",
      findRecipe,
      starter,
    );

    expect(loaded.roomId).toMatch(/^edit-synchronized-sound-/);
  });
});
