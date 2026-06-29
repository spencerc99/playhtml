// ABOUTME: Tests shared inline state editing helpers.
// ABOUTME: Covers primitive parsing and immutable leaf replacement by path.
import { describe, expect, test } from "vitest";
import {
  formatStateLeafValue,
  isEditableStateLeaf,
  parseStateLeafValue,
  replaceStateLeafValue,
} from "../leafEditor";

describe("parseStateLeafValue", () => {
  test("parses JSON primitive leaf values", () => {
    expect(parseStateLeafValue('"hello"')).toEqual({ ok: true, value: "hello" });
    expect(parseStateLeafValue("42")).toEqual({ ok: true, value: 42 });
    expect(parseStateLeafValue("true")).toEqual({ ok: true, value: true });
    expect(parseStateLeafValue("false")).toEqual({ ok: true, value: false });
    expect(parseStateLeafValue("null")).toEqual({ ok: true, value: null });
  });

  test("rejects invalid or non-leaf input", () => {
    expect(parseStateLeafValue("hello")).toEqual({
      ok: false,
      error: "Enter a valid JSON string, number, boolean, or null.",
    });
    expect(parseStateLeafValue("")).toEqual({
      ok: false,
      error: "Enter a JSON string, number, boolean, or null.",
    });
    expect(parseStateLeafValue("{}")).toEqual({
      ok: false,
      error: "Only primitive values can be edited inline.",
    });
    expect(parseStateLeafValue("[1]")).toEqual({
      ok: false,
      error: "Only primitive values can be edited inline.",
    });
  });
});

describe("formatStateLeafValue", () => {
  test("formats editable values as JSON literals", () => {
    expect(formatStateLeafValue("hello")).toBe('"hello"');
    expect(formatStateLeafValue(42)).toBe("42");
    expect(formatStateLeafValue(true)).toBe("true");
    expect(formatStateLeafValue(null)).toBe("null");
  });
});

describe("isEditableStateLeaf", () => {
  test("accepts only primitive leaf values", () => {
    expect(isEditableStateLeaf("hello")).toBe(true);
    expect(isEditableStateLeaf(42)).toBe(true);
    expect(isEditableStateLeaf(false)).toBe(true);
    expect(isEditableStateLeaf(null)).toBe(true);
    expect(isEditableStateLeaf({ value: "hello" })).toBe(false);
    expect(isEditableStateLeaf(["hello"])).toBe(false);
    expect(isEditableStateLeaf(undefined)).toBe(false);
  });
});

describe("replaceStateLeafValue", () => {
  test("replaces an existing object leaf without mutating the original data", () => {
    const data = {
      canPlay: {
        guestbook: {
          entries: [{ id: "a", text: "hello", pinned: false }],
        },
      },
    };

    const result = replaceStateLeafValue(
      data,
      ["canPlay", "guestbook", "entries", 0, "text"],
      "updated",
    );

    expect(result).toEqual({
      ok: true,
      data: {
        canPlay: {
          guestbook: {
            entries: [{ id: "a", text: "updated", pinned: false }],
          },
        },
      },
    });
    expect(data.canPlay.guestbook.entries[0].text).toBe("hello");
  });

  test("replaces an existing array leaf without mutating sibling values", () => {
    const data = { points: [1, 2, 3], label: "score" };

    const result = replaceStateLeafValue(data, ["points", 1], 12);

    expect(result).toEqual({
      ok: true,
      data: { points: [1, 12, 3], label: "score" },
    });
    expect(data.points).toEqual([1, 2, 3]);
  });

  test("rejects missing paths and non-leaf paths", () => {
    const data = { points: [1, 2, 3], nested: { value: "x" } };

    expect(replaceStateLeafValue(data, ["points", 4], 12)).toEqual({
      ok: false,
      error: "State path does not exist.",
    });
    expect(replaceStateLeafValue(data, ["nested"], "changed")).toEqual({
      ok: false,
      error: "Only primitive values can be edited inline.",
    });
    expect(replaceStateLeafValue(data, [], "changed")).toEqual({
      ok: false,
      error: "Choose a value inside the state tree.",
    });
  });
});
