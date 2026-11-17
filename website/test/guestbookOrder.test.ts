// ABOUTME: Tests the event guestbook's newest-first display order.
// ABOUTME: Ensures ordering for display never reverses the shared entry list itself.
import { describe, expect, test } from "bun:test";
import { newestFirst } from "../events/guestbookOrder";

describe("event guestbook order", () => {
  test("shows the newest entry first", () => {
    expect(newestFirst(["first", "second", "third"])).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  test("leaves the shared entries in their saved order across renders", () => {
    const shared = ["first", "second", "third"];
    newestFirst(shared);
    newestFirst(shared);
    expect(shared).toEqual(["first", "second", "third"]);
    expect(newestFirst(shared)[0]).toBe("third");
  });
});
