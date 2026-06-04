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
