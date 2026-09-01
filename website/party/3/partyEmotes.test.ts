// ABOUTME: Verifies the party's deliberately small cursor-emote selection.
// ABOUTME: Covers the bare-E shortcut without changing the extension's full wheel.

import { describe, expect, it } from "vitest";
import { PARTY_EMOTES } from "./partyEmotes";

describe("party cursor emotes", () => {
  it("offers only wave and spin", () => {
    expect(PARTY_EMOTES.map((emote) => emote.id)).toEqual(["wave", "spin"]);
  });
});
