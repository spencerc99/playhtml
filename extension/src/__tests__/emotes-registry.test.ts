// ABOUTME: Verifies the emote registry shape and lookups.
// ABOUTME: Guards the ported-from-site first three and the 10-count contract.
import { describe, it, expect } from "vitest";
import { EMOTES, ACTIVE_EMOTES, getEmote } from "../features/emotes/emotes";

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

  it("ACTIVE_EMOTES is the enabled subset, in catalog order", () => {
    // Every active emote is enabled, and the order matches the catalog.
    expect(ACTIVE_EMOTES.every((e) => e.enabled)).toBe(true);
    expect(ACTIVE_EMOTES).toEqual(EMOTES.filter((e) => e.enabled));
    // The interaction emotes are currently disabled (their two-cursor behavior
    // is still being worked out), so none appear in the active set.
    expect(ACTIVE_EMOTES.some((e) => e.kind === "interact")).toBe(false);
  });
});
