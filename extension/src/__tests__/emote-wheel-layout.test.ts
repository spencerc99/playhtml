// ABOUTME: Verifies cursor-relative placement for compact and radial emote menus.
// ABOUTME: Keeps two-choice menus split evenly across the cursor.

import { describe, expect, it } from "vitest";
import { emoteItemPosition } from "../features/emotes/EmoteWheel";

describe("emote menu layout", () => {
  it("places a pair on opposite sides of the cursor", () => {
    expect(emoteItemPosition(0, 2)).toEqual({ x: -48, y: 0 });
    expect(emoteItemPosition(1, 2)).toEqual({ x: 48, y: 0 });
  });

  it("keeps larger sets on the radial layout", () => {
    const position = emoteItemPosition(0, 4);
    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(-74);
  });
});
