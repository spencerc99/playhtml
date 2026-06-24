// ABOUTME: Verifies reset-epoch parsing and stale-boundary decisions for PartyServer.
// ABOUTME: Covers malformed client epochs that must not bypass room reset enforcement.
import { describe, expect, it } from "bun:test";
import {
  getAutosaveResetEpochDecision,
  isResetEpochStale,
  parseClientResetEpoch,
} from "../resetEpochPolicy";

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

describe("getAutosaveResetEpochDecision", () => {
  it("skips saves from docs that are older than the server reset epoch", () => {
    expect(getAutosaveResetEpochDecision(null, 100)).toEqual({
      kind: "skip",
      reason: "doc reset epoch missing while server epoch=100",
    });
    expect(getAutosaveResetEpochDecision(99, 100)).toEqual({
      kind: "skip",
      reason: "doc reset epoch 99 < server epoch 100",
    });
  });

  it("promotes the server epoch when the live doc has a newer reset boundary", () => {
    expect(getAutosaveResetEpochDecision(101, 100)).toEqual({
      kind: "promote-server-epoch",
      resetEpoch: 101,
    });
    expect(getAutosaveResetEpochDecision(101, null)).toEqual({
      kind: "promote-server-epoch",
      resetEpoch: 101,
    });
  });

  it("allows saves when the doc and server agree about the reset boundary", () => {
    expect(getAutosaveResetEpochDecision(null, null)).toEqual({
      kind: "save",
    });
    expect(getAutosaveResetEpochDecision(100, 100)).toEqual({
      kind: "save",
    });
  });
});
