// ABOUTME: Verifies reset-epoch parsing and stale-boundary decisions for PartyServer.
// ABOUTME: Covers malformed client epochs that must not bypass room reset enforcement.
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import {
  getAutosaveResetEpochDecision,
  getHeldConnectionMessageDecision,
  readSyncStep1StateVectorSize,
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

function writeVarUint(bytes: number[], value: number): void {
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
}

function syncMessage(syncType: number, payload: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  writeVarUint(bytes, 0);
  writeVarUint(bytes, syncType);
  writeVarUint(bytes, payload.length);
  return Uint8Array.from([...bytes, ...payload]);
}

function docWithHistory(entries: number): Y.Doc {
  const doc = new Y.Doc();
  const map = doc.getMap("play");
  for (let i = 0; i < entries; i += 1) map.set(`key-${i}`, i);
  return doc;
}

describe("readSyncStep1StateVectorSize", () => {
  it("reads an empty state vector from a fresh document", () => {
    const message = syncMessage(0, Y.encodeStateVector(new Y.Doc()));
    expect(readSyncStep1StateVectorSize(message)).toBe(0);
  });

  it("counts clients in a document with history", () => {
    const merged = docWithHistory(3);
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(docWithHistory(200)));
    const message = syncMessage(0, Y.encodeStateVector(merged));
    expect(readSyncStep1StateVectorSize(message)).toBe(2);
  });

  it("ignores other message shapes and truncated input", () => {
    expect(
      readSyncStep1StateVectorSize(
        syncMessage(2, Y.encodeStateAsUpdate(docWithHistory(1)))
      )
    ).toBe(null);
    expect(readSyncStep1StateVectorSize(Uint8Array.from([0, 0, 5, 1]))).toBe(
      null
    );
    expect(readSyncStep1StateVectorSize(new Uint8Array())).toBe(null);
  });
});

describe("getHeldConnectionMessageDecision", () => {
  it("admits a client whose first sync step carries no history", () => {
    const message = syncMessage(0, Y.encodeStateVector(new Y.Doc()));
    expect(getHeldConnectionMessageDecision(message)).toBe("admit");
    expect(getHeldConnectionMessageDecision(message.buffer)).toBe("admit");
  });

  it("rejects a client that carries document history", () => {
    const withHistory = syncMessage(
      0,
      Y.encodeStateVector(docWithHistory(1))
    );
    expect(getHeldConnectionMessageDecision(withHistory)).toBe("reject");
    const update = syncMessage(2, Y.encodeStateAsUpdate(docWithHistory(1)));
    expect(getHeldConnectionMessageDecision(update)).toBe("reject");
    expect(getHeldConnectionMessageDecision(new Uint8Array())).toBe("reject");
  });

  it("waits through awareness and custom string messages", () => {
    expect(getHeldConnectionMessageDecision(Uint8Array.from([1, 0]))).toBe(
      "wait"
    );
    expect(getHeldConnectionMessageDecision("__YPS:{}")).toBe("wait");
  });
});
