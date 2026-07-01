// ABOUTME: Verifies the emote registry shape and lookups.
// ABOUTME: Guards the ported-from-site first three and the 10-count contract.
import { describe, it, expect } from "vitest";
import { EMOTES, getEmote } from "../features/emotes/emotes";

describe("emote registry", () => {
  it("has exactly 10 emotes with unique ids", () => {
    expect(EMOTES).toHaveLength(10);
    const ids = new Set(EMOTES.map((e) => e.id));
    expect(ids.size).toBe(10);
  });

  it("ports the site's first three verbatim", () => {
    expect(EMOTES.slice(0, 3).map((e) => [e.id, e.icon, e.durationMs])).toEqual([
      ["wave", "\\o", 1500],
      ["dance", "~\\/~", 2000],
      ["spin", "','", 1000],
    ]);
  });

  it("marks the three interaction emotes", () => {
    const interact = EMOTES.filter((e) => e.kind === "interact").map((e) => e.id);
    expect(interact.sort()).toEqual(["heart", "highfive", "nuzzle", "poke"].sort());
  });

  it("looks up by id", () => {
    expect(getEmote("wave")?.label).toBe("wave");
    expect(getEmote("nope")).toBeUndefined();
  });
});
