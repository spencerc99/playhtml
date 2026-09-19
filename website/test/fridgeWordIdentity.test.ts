// ABOUTME: Verifies built-in fridge words keep their historical shared-state IDs.
// ABOUTME: Prevents remounts from rebinding words to different saved positions.

import { describe, expect, test } from "bun:test";
import { getDefaultFridgeWordId } from "../fridgeWordIdentity";

describe("default fridge word identity", () => {
  test("uses the historical selector IDs on every mount", () => {
    const firstMount = Array.from({ length: 56 }, (_, index) =>
      getDefaultFridgeWordId(index),
    );
    const secondMount = Array.from({ length: 56 }, (_, index) =>
      getDefaultFridgeWordId(index),
    );

    expect(secondMount).toEqual(firstMount);
    expect(firstMount[0]).toBe(
      "Y2FuLW1vdmUtI2ZyaWRnZSAuZnJpZGdlV29yZEhvbGRlci0w",
    );
    expect(firstMount[55]).toBe(
      "Y2FuLW1vdmUtI2ZyaWRnZSAuZnJpZGdlV29yZEhvbGRlci01NQ==",
    );
  });
});
