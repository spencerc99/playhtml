// ABOUTME: Unit tests for moderation record extraction, hashing, and removal.
// ABOUTME: Uses bun:test with fixtures mirroring real playhtml page data shapes.
import { describe, expect, it } from "bun:test";
import { hashRecord } from "../moderation";

describe("hashRecord", () => {
  it("is stable for identical record content", () => {
    const a = { word: "hello", color: "#abc", x: 1, y: 2 };
    const b = { word: "hello", color: "#abc", x: 1, y: 2 };
    expect(hashRecord(a)).toBe(hashRecord(b));
  });

  it("is order-independent across keys", () => {
    const a = { word: "hello", color: "#abc" };
    const b = { color: "#abc", word: "hello" };
    expect(hashRecord(a)).toBe(hashRecord(b));
  });

  it("differs when content differs", () => {
    expect(hashRecord({ word: "hello" })).not.toBe(hashRecord({ word: "world" }));
  });
});

import { recordsFromPlay } from "../moderation";

const FRIDGE = {
  "can-play": {
    newWords: [
      { id: "1", word: "dream", color: "#abc", x: 10, y: 20 },
      { id: "2", word: "ocean", color: "#def", x: 30, y: 40 },
    ],
  },
};

const GUESTBOOK = {
  "can-post": {
    form1: [{ name: "Alice", message: "love it!", timestamp: 111 }],
  },
};

const LIVECHAT = {
  "can-play": {
    chat1: { messages: [{ id: "u1", name: "Bob", text: "hi all", color: "#111" }] },
  },
};

const CANDLE = { "can-play": { customCandle: { on: true } } };

describe("recordsFromPlay", () => {
  it("emits one record per object in a top-level array", () => {
    const recs = recordsFromPlay(FRIDGE);
    expect(recs.length).toBe(2);
    expect(recs[0].path).toBe("can-play.newWords");
    expect(recs[0].index).toBe(0);
    expect(recs[0].key).toBe("can-play.newWords#0");
    expect(recs[1].key).toBe("can-play.newWords#1");
  });

  it("recurses into a nested array inside a wrapper object", () => {
    const recs = recordsFromPlay(LIVECHAT);
    expect(recs.length).toBe(1);
    expect(recs[0].path).toBe("can-play.chat1.messages");
    expect(recs[0].key).toBe("can-play.chat1.messages#0");
  });

  it("captures each record's content and hash", () => {
    const recs = recordsFromPlay(GUESTBOOK);
    expect(recs[0].fields).toEqual({ name: "Alice", message: "love it!", timestamp: 111 });
    expect(typeof recs[0].contentHash).toBe("string");
  });

  it("yields zero records for non-array element data", () => {
    expect(recordsFromPlay(CANDLE).length).toBe(0);
  });

  it("ignores arrays of primitives (only arrays of objects are records)", () => {
    const recs = recordsFromPlay({ "can-play": { tags: ["a", "b", "c"] } });
    expect(recs.length).toBe(0);
  });
});

import { extractRecords } from "../moderation";

describe("extractRecords", () => {
  it("prefers a named text field for display text", () => {
    const recs = extractRecords(FRIDGE);
    expect(recs[0].text).toBe("dream");
  });

  it("joins multiple named text fields in field order", () => {
    const recs = extractRecords(GUESTBOOK);
    expect(recs[0].text).toContain("Alice");
    expect(recs[0].text).toContain("love it!");
  });

  it("classifies hex colors and numbers as metadata, not text", () => {
    const recs = extractRecords(FRIDGE);
    expect(recs[0].metadata).toMatchObject({ color: "#abc", x: 10, y: 20 });
    expect(recs[0].text).not.toContain("#abc");
  });

  it("surfaces the record's own id when present", () => {
    expect(extractRecords(FRIDGE)[0].id).toBe("1");
  });

  it("flags a reportCount field for highlighting", () => {
    const recs = extractRecords({
      "can-play": { w: [{ word: "x", reportCount: 4 }] },
    });
    expect(recs[0].reportCount).toBe(4);
  });

  it("falls back to the longest string when no named text field exists", () => {
    const recs = extractRecords({
      "can-play": { w: [{ a: "hi", b: "a much longer string value" }] },
    });
    expect(recs[0].text).toBe("a much longer string value");
  });
});

import { removeRecordsByTargets } from "../moderation";

function makePlay() {
  return {
    "can-play": {
      newWords: [
        { id: "1", word: "keep" },
        { id: "2", word: "remove-me" },
        { id: "3", word: "also-keep" },
      ],
    },
    "can-post": {
      form1: [{ name: "Eve", message: "spam", timestamp: 9 }],
    },
  };
}

function hashFor(play: any, key: string): string {
  const rec = recordsFromPlay(play).find((r) => r.key === key);
  if (!rec) throw new Error(`no record for ${key}`);
  return rec.contentHash;
}

describe("removeRecordsByTargets", () => {
  it("removes a matching record and reports the count", () => {
    const play = makePlay();
    const key = "can-play.newWords#1";
    const result = removeRecordsByTargets(play, [{ key, contentHash: hashFor(play, key) }]);
    expect(result.removed).toBe(1);
    expect(result.skipped).toEqual([]);
    const words = (result.play["can-play"] as any).newWords.map((r: any) => r.word);
    expect(words).toEqual(["keep", "also-keep"]);
  });

  it("removes across multiple arrays in one call", () => {
    const play = makePlay();
    const k1 = "can-play.newWords#0";
    const k2 = "can-post.form1#0";
    const result = removeRecordsByTargets(play, [
      { key: k1, contentHash: hashFor(play, k1) },
      { key: k2, contentHash: hashFor(play, k2) },
    ]);
    expect(result.removed).toBe(2);
    expect((result.play["can-play"] as any).newWords.length).toBe(2);
    expect((result.play["can-post"] as any).form1.length).toBe(0);
  });

  it("deletes higher indices correctly when removing multiple from one array", () => {
    const play = makePlay();
    const k0 = "can-play.newWords#0";
    const k2 = "can-play.newWords#2";
    const result = removeRecordsByTargets(play, [
      { key: k0, contentHash: hashFor(play, k0) },
      { key: k2, contentHash: hashFor(play, k2) },
    ]);
    expect(result.removed).toBe(2);
    const words = (result.play["can-play"] as any).newWords.map((r: any) => r.word);
    expect(words).toEqual(["remove-me"]);
  });

  it("does not delete a neighboring record when the same target is repeated", () => {
    const play = makePlay();
    const key = "can-play.newWords#1";
    const target = { key, contentHash: hashFor(play, key) };
    const result = removeRecordsByTargets(play, [target, target]);
    expect(result.removed).toBe(1);
    const words = (result.play["can-play"] as any).newWords.map((r: any) => r.word);
    expect(words).toEqual(["keep", "also-keep"]);
  });

  it("skips a target whose hash no longer matches", () => {
    const play = makePlay();
    const key = "can-play.newWords#1";
    const result = removeRecordsByTargets(play, [{ key, contentHash: "deadbeef" }]);
    expect(result.removed).toBe(0);
    expect(result.skipped).toEqual([{ key, reason: "hash-mismatch" }]);
    expect((result.play["can-play"] as any).newWords.length).toBe(3);
  });

  it("skips a target whose key resolves to nothing", () => {
    const play = makePlay();
    const result = removeRecordsByTargets(play, [
      { key: "can-play.newWords#99", contentHash: "abc" },
    ]);
    expect(result.removed).toBe(0);
    expect(result.skipped).toEqual([{ key: "can-play.newWords#99", reason: "not-found" }]);
  });

  it("does not mutate the input play object", () => {
    const play = makePlay();
    const key = "can-play.newWords#1";
    removeRecordsByTargets(play, [{ key, contentHash: hashFor(play, key) }]);
    expect((play["can-play"] as any).newWords.length).toBe(3);
  });
});
