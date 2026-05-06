// ABOUTME: Verifies reset-epoch parsing and stale-boundary decisions for PartyServer.
// ABOUTME: Covers malformed client epochs that must not bypass room reset enforcement.
import { describe, expect, it } from "bun:test";
import { isResetEpochStale, parseClientResetEpoch } from "../resetEpochPolicy";

describe("parseClientResetEpoch", () => {
  it("parses finite numeric epoch params", () => {
    expect(parseClientResetEpoch("1710000000000")).toBe(1710000000000);
    expect(parseClientResetEpoch("0")).toBe(0);
  });

  it("treats missing or malformed params as absent", () => {
    expect(parseClientResetEpoch(null)).toBe(null);
    expect(parseClientResetEpoch("")).toBe(null);
    expect(parseClientResetEpoch("bad")).toBe(null);
    expect(parseClientResetEpoch("123bad")).toBe(null);
    expect(parseClientResetEpoch("Infinity")).toBe(null);
  });
});

describe("isResetEpochStale", () => {
  it("requires a current client epoch once the room has a reset epoch", () => {
    expect(isResetEpochStale(null, null)).toBe(false);
    expect(isResetEpochStale(null, 100)).toBe(true);
    expect(isResetEpochStale(99, 100)).toBe(true);
    expect(isResetEpochStale(100, 100)).toBe(false);
    expect(isResetEpochStale(101, 100)).toBe(false);
  });
});
