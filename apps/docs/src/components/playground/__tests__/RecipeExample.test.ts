// ABOUTME: Verifies docs examples join rooms that preserve shared example data.
// ABOUTME: Keeps default example rooms stable while preserving explicit room links.
import { describe, expect, it } from "vitest";
import { resolveExampleRoomId } from "../RecipeExample";

describe("resolveExampleRoomId", () => {
  it("uses the page path when no valid room is provided", () => {
    const url = new URL(
      "https://playhtml.fun/docs/capabilities/?room=not%20a%20room",
    );

    expect(resolveExampleRoomId(url)).toBe("/docs/capabilities/");
  });

  it("uses a stable page room for standalone examples", () => {
    const url = new URL("https://playhtml.fun/docs/examples/can-move/");

    expect(resolveExampleRoomId(url)).toBe("/docs/examples/can-move/");
  });

  it("uses an explicit room for standalone examples", () => {
    const url = new URL(
      "https://playhtml.fun/docs/examples/can-move/?room=shared-room",
    );

    expect(resolveExampleRoomId(url)).toBe("shared-room");
  });
});
