import { describe, it, expect } from "vitest";
import {
  getStableIdForAwareness,
  getElementAwarenessFingerprint,
} from "../awareness-utils";

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

describe("getElementAwarenessFingerprint", () => {
  it("ignores __ keys so cursor-only changes do not change fingerprint", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { "can-play": { el1: { count: 0 } } }],
    ]);
    const fp1 = getElementAwarenessFingerprint(states);

    // Same element data but add cursor data (as on every mouse move)
    const statesWithCursor = new Map<number, Record<string, unknown>>([
      [
        1,
        {
          "can-play": { el1: { count: 0 } },
          __playhtml_cursors__: { cursor: { x: 100, y: 200 } },
        },
      ],
    ]);
    const fp2 = getElementAwarenessFingerprint(statesWithCursor);
    expect(fp1).toBe(fp2);
  });

  it("returns same fingerprint for same element awareness data", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { "can-play": { a: { n: 1 }, b: { n: 2 } } }],
      [2, { "can-play": { a: { n: 3 } } }],
    ]);
    const fp1 = getElementAwarenessFingerprint(states);
    const fp2 = getElementAwarenessFingerprint(states);
    expect(fp1).toBe(fp2);
  });

  it("returns different fingerprint when element awareness data changes", () => {
    const states1 = new Map<number, Record<string, unknown>>([
      [1, { "can-play": { el1: { count: 0 } } }],
    ]);
    const states2 = new Map<number, Record<string, unknown>>([
      [1, { "can-play": { el1: { count: 1 } } }],
    ]);
    expect(getElementAwarenessFingerprint(states1)).not.toBe(
      getElementAwarenessFingerprint(states2)
    );
  });
});
