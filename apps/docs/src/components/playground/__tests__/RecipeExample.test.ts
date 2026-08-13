// ABOUTME: Verifies docs examples join rooms that preserve shared example data.
// ABOUTME: Keeps inline examples stable while standalone examples remain shareable.
import { describe, expect, it } from "vitest";
import { resolveExampleRoomId } from "../RecipeExample";

describe("resolveExampleRoomId", () => {
  it("uses the docs page room for compact inline examples", () => {
    const url = new URL(
      "https://playhtml.fun/docs/capabilities/?room=example-can-move-stale",
    );

    expect(resolveExampleRoomId(url, "can-move", true)).toBe(
      "/docs/capabilities/",
    );
  });

  it("uses an explicit room for standalone examples", () => {
    const url = new URL(
      "https://playhtml.fun/docs/examples/can-move/?room=shared-room",
    );

    expect(resolveExampleRoomId(url, "can-move", false)).toBe("shared-room");
  });
});
