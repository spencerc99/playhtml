import { describe, it, expect } from "vitest";
import { getStableIdForAwareness } from "../awareness-utils";

describe("getStableIdForAwareness", () => {
  it("returns clientId as string when state has no __playhtml_cursors__ (cursors disabled)", () => {
    expect(getStableIdForAwareness({}, 42)).toBe("42");
    expect(getStableIdForAwareness({ "can-play": { el1: {} } }, 0)).toBe("0");
  });

  it("returns clientId when __playhtml_cursors__ exists but has no playerIdentity", () => {
    expect(
      getStableIdForAwareness({ __playhtml_cursors__: {} }, 7)
    ).toBe("7");
    expect(
      getStableIdForAwareness(
        { __playhtml_cursors__: { cursor: { x: 0, y: 0 } } },
        3
      )
    ).toBe("3");
  });

  it("returns playerIdentity.publicKey when present (cursors enabled)", () => {
    expect(
      getStableIdForAwareness(
        {
          __playhtml_cursors__: {
            playerIdentity: { publicKey: "abc-123" },
          },
        },
        42
      )
    ).toBe("abc-123");
  });

  it("falls back to clientId when playerIdentity exists but publicKey is missing", () => {
    expect(
      getStableIdForAwareness(
        { __playhtml_cursors__: { playerIdentity: {} } },
        99
      )
    ).toBe("99");
  });
});
