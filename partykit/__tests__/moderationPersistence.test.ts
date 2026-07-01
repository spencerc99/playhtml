// ABOUTME: Round-trip test for the moderation-remove persistence path on a real Y.Doc.
// ABOUTME: Mirrors database snapshot extraction, moderation removal, fresh snapshot commit.
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { Buffer } from "node:buffer";
import { createAdminSnapshotFromPlayData } from "../adminMutation";
import {
  jsonToDoc,
  docToJson,
} from "../docUtils";
import {
  extractRecords,
  recordsFromPlay,
  removeRecordsByTargets,
  type RemoveTarget,
} from "../moderation";

// The play shape mirrors real pages: fridge words (can-play.newWords array) and
// a guestbook (can-post.form1 array), so the test exercises multiple arrays.
function samplePlay() {
  return {
    "can-play": {
      newWords: [
        { id: "1", word: "keep", color: "#abc", x: 1, y: 2 },
        { id: "2", word: "remove-me", color: "#def", x: 3, y: 4 },
        { id: "3", word: "also-keep", color: "#fed", x: 5, y: 6 },
      ],
    },
    "can-post": {
      form1: [
        { name: "Alice", message: "hi", timestamp: 10 },
        { name: "Eve", message: "spam", timestamp: 20 },
      ],
    },
  };
}

function targetFor(play: Record<string, unknown>, key: string): RemoveTarget {
  const rec = recordsFromPlay(play).find((r) => r.key === key);
  if (!rec) throw new Error(`no record for ${key}`);
  return { key, contentHash: rec.contentHash };
}

// Performs the exact data mutation handleModerationRemove does, minus network I/O.
// Returns the play data re-extracted from the fresh snapshot that would be saved.
function runRemovalThroughDoc(
  play: Record<string, unknown>,
  targets: RemoveTarget[]
) {
  const doc = jsonToDoc(play);
  const livePlay = docToJson(doc);
  if (!livePlay) throw new Error("doc has no play data");

  const result = removeRecordsByTargets(livePlay, targets);
  if (result.removed === 0) {
    return { result, rePlay: docToJson(doc) };
  }

  const snapshot = createAdminSnapshotFromPlayData(result.play, 1234);
  const reDoc = new Y.Doc();
  Y.applyUpdate(
    reDoc,
    new Uint8Array(Buffer.from(snapshot.base64, "base64"))
  );
  return { result, rePlay: docToJson(reDoc) };
}

describe("moderation removal persistence round-trip", () => {
  it("removes the targeted record and leaves the rest intact in the doc", () => {
    const play = samplePlay();
    const target = targetFor(play, "can-play.newWords#1");

    const { result, rePlay } = runRemovalThroughDoc(play, [target]);

    expect(result.removed).toBe(1);
    expect(result.skipped).toEqual([]);
    const words = (rePlay!["can-play"] as any).newWords.map((r: any) => r.word);
    expect(words).toEqual(["keep", "also-keep"]);
    // The untouched array survives unchanged.
    expect((rePlay!["can-post"] as any).form1.length).toBe(2);
  });

  it("removes across multiple arrays and the re-extracted records match", () => {
    const play = samplePlay();
    const targets = [
      targetFor(play, "can-play.newWords#1"),
      targetFor(play, "can-post.form1#1"),
    ];

    const { result, rePlay } = runRemovalThroughDoc(play, targets);

    expect(result.removed).toBe(2);
    // Re-extract from the persisted doc and confirm the expected remainder.
    // Guestbook text joins message + name, so Alice's row reads "hi — Alice".
    const remainingTexts = extractRecords(rePlay!).map((r) => r.text);
    expect(remainingTexts).toContain("keep");
    expect(remainingTexts).toContain("also-keep");
    expect(remainingTexts.some((t) => t.includes("hi"))).toBe(true); // Alice kept
    expect(remainingTexts).not.toContain("remove-me");
    expect(remainingTexts.some((t) => t.includes("spam"))).toBe(false); // Eve removed
  });

  it("re-extracted keys are stable, so a second removal round still resolves", () => {
    const play = samplePlay();
    const first = runRemovalThroughDoc(play, [
      targetFor(play, "can-play.newWords#0"),
    ]);
    expect(first.result.removed).toBe(1);

    // After removal, indices shift; re-derive a target from the NEW play and
    // confirm a second removal resolves against the persisted doc.
    const second = removeRecordsByTargets(first.rePlay!, [
      targetFor(first.rePlay!, "can-play.newWords#0"),
    ]);
    expect(second.removed).toBe(1);
    const words = (second.play["can-play"] as any).newWords.map(
      (r: any) => r.word
    );
    expect(words).toEqual(["also-keep"]);
  });

  it("a hash-mismatched target is skipped and the doc is left unchanged", () => {
    const play = samplePlay();
    const { result, rePlay } = runRemovalThroughDoc(play, [
      { key: "can-play.newWords#1", contentHash: "deadbeef" },
    ]);

    expect(result.removed).toBe(0);
    expect(result.skipped).toEqual([
      { key: "can-play.newWords#1", reason: "hash-mismatch" },
    ]);
    // Nothing removed -> the doc still has all original records.
    expect((rePlay!["can-play"] as any).newWords.length).toBe(3);
  });
});
