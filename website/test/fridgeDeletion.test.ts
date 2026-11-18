// ABOUTME: Verifies deletion limits for visitors and the fridge owner.
// ABOUTME: Ensures only the owner's public key receives unlimited cleanup access.
import { describe, expect, test } from "bun:test";
import {
  canDeleteFridgeWord,
  deleteSharedFridgeWord,
  removeFridgeWord,
} from "../fridgeDeletion";

const FridgeOwnerPublicKey =
  "pk_04934976d2bc13f0a3a1e62a9124a3edb1e236b2eef64b618c646e25e3ade8ec77d2b56bedb39b78150d141be1b6b41a85b86010930941e02e82e96ce61af35d53";

describe("fridge word deletion", () => {
  test("limits public sessions to three deletions", () => {
    expect(canDeleteFridgeWord(2, "pk_someone_else")).toBe(true);
    expect(canDeleteFridgeWord(3, "pk_someone_else")).toBe(false);
    expect(canDeleteFridgeWord(3, undefined)).toBe(false);
  });

  test("does not limit the fridge owner", () => {
    expect(canDeleteFridgeWord(3, FridgeOwnerPublicKey)).toBe(true);
    expect(canDeleteFridgeWord(10_000, FridgeOwnerPublicKey)).toBe(true);
  });
});

describe("removing a fridge word", () => {
  const makeWords = () => [
    { id: "1", word: "sun", color: "red" },
    { id: "2", word: "moon", color: "blue" },
    { word: "star", color: "gold" },
  ];

  test("removes the word with the matching id from the current list", () => {
    const words = makeWords();
    // Another visitor removed "sun" after this visitor's view rendered.
    words.splice(0, 1);
    expect(
      removeFridgeWord(words, { id: "2", word: "moon", color: "blue" }),
    ).toBe(true);
    expect(words.map((w) => w.word)).toEqual(["star"]);
  });

  test("matches words without an id by text and color", () => {
    const words = makeWords();
    expect(removeFridgeWord(words, { word: "star", color: "gold" })).toBe(true);
    expect(words.map((w) => w.word)).toEqual(["sun", "moon"]);
  });

  test("leaves the list unchanged when the word is already gone", () => {
    const words = makeWords();
    expect(removeFridgeWord(words, { id: "missing", word: "x" })).toBe(false);
    expect(removeFridgeWord(words, { word: "star", color: "red" })).toBe(false);
    expect(words).toHaveLength(3);
  });
});

describe("deleting a fridge word from the shared list", () => {
  // A shared list whose setData runs each mutator against the list as it is
  // when the write lands, like playhtml's mutator form of setData.
  function makeSharedWords<Word>(initial: Word[]) {
    const words = [...initial];
    return {
      words,
      setData: (mutator: (draft: Word[]) => void) => mutator(words),
    };
  }

  test("removes the clicked word when the list changed between click and write", () => {
    const shared = makeSharedWords([
      { id: "1", word: "sun", color: "red" },
      { id: "2", word: "moon", color: "blue" },
      { id: "3", word: "star", color: "gold" },
    ]);
    // The visitor clicks "moon", which sat at index 1 when their view rendered.
    const clicked = { id: "2", word: "moon", color: "blue" };
    // Before the write lands, another visitor removes "sun" and adds "sky" at
    // the front, so index 1 now holds "star".
    shared.words.splice(0, 1);
    shared.words.unshift({ id: "4", word: "sky", color: "green" });

    deleteSharedFridgeWord(shared.setData, clicked);

    expect(shared.words.map((w) => w.word)).toEqual(["sky", "star"]);
  });

  test("leaves the list alone when another visitor already deleted the clicked word", () => {
    const shared = makeSharedWords([
      { id: "1", word: "sun", color: "red" },
      { id: "2", word: "moon", color: "blue" },
    ]);
    const clicked = { id: "2", word: "moon", color: "blue" };
    shared.words.splice(1, 1);

    deleteSharedFridgeWord(shared.setData, clicked);

    expect(shared.words.map((w) => w.word)).toEqual(["sun"]);
  });
});
